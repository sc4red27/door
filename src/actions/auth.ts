'use server';

import { redirect } from 'next/navigation';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { PASSWORD_MIN_LENGTH, STUDENT_EMAIL_DOMAIN } from '@/lib/constants';
import { fmt, getDict } from '@/i18n';
import type { ActionState } from '@/lib/types';

/** Student ID -> internal email. Staff may type their email or their staff ID. */
async function resolveEmail(identifier: string): Promise<string> {
  if (identifier.includes('@')) return identifier.toLowerCase();
  const { data } = await createAdminClient()
    .from('profiles')
    .select('email')
    .eq('login_id', identifier)
    .maybeSingle();
  return data?.email ?? `${identifier.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`;
}

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getDict();
  const identifier = String(formData.get('identifier') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!identifier || !password || identifier.length > 200 || password.length > 200) {
    return { error: t.auth.invalid };
  }

  // 8 attempts per account and 40 per IP address in 5 minutes.
  const ip = await clientIp();
  const [accountOk, ipOk] = await Promise.all([
    rateLimit(`login:id:${identifier.toLowerCase()}`, 8, 300),
    rateLimit(`login:ip:${ip}`, 40, 300),
  ]);
  if (!accountOk || !ipOk) return { error: t.auth.rate };

  const email = await resolveEmail(identifier);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Same message for "no such user" and "wrong password".
  if (error) return { error: t.auth.invalid };

  redirect('/');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getDict();
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 200) {
    return { error: fmt(t.auth.tooShort, { n: PASSWORD_MIN_LENGTH }) };
  }
  if (password !== confirm) return { error: t.auth.mismatch };

  if (!(await rateLimit(`password:${user.id}`, 10, 600))) return { error: t.auth.rate };

  // A voluntary change (My account) must prove the current password, so an
  // unattended signed-in browser cannot be used to take over the account.
  // The first-login change skips this: the user just typed the temporary one.
  if (!user.mustChangePassword) {
    const current = String(formData.get('current') ?? '');
    const { data: profile } = await createAdminClient().from('profiles').select('email').eq('id', user.id).maybeSingle();
    const verifier = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: wrong } = await verifier.auth.signInWithPassword({ email: profile?.email ?? '', password: current });
    if (wrong) return { error: t.auth.wrongCurrent };
    await verifier.auth.signOut({ scope: 'local' });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: t.auth.changeFailed };

  // Clear the first-login flag in both places it lives, then mint a fresh JWT
  // so the middleware stops redirecting.
  const admin = createAdminClient();
  const [meta, profile] = await Promise.all([
    admin.auth.admin.updateUserById(user.id, { app_metadata: { role: user.role, must_change_password: false } }),
    admin.from('profiles').update({ must_change_password: false }).eq('id', user.id),
  ]);
  if (meta.error || profile.error) return { error: t.common.failed };
  await supabase.auth.refreshSession();

  if (!user.mustChangePassword) return { ok: t.auth.passwordChanged };
  redirect('/');
}
