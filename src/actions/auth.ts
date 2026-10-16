'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { PASSWORD_MIN_LENGTH, STUDENT_EMAIL_DOMAIN, hasOwnEmail } from '@/lib/constants';
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

type UserClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Confirms with the Auth server (not just the JWT signature) that this
 * session still exists. A revoked session keeps a valid-looking access token
 * until it expires, so sensitive account changes must not rely on the JWT alone.
 */
async function hasLiveSession(supabase: UserClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  return !error && data.user?.id === userId;
}

/**
 * Re-authentication: checks the current password against Supabase Auth on the
 * server with a throwaway client, then revokes that verification session.
 * The password is never logged or returned.
 */
async function isCurrentPassword(userId: string, password: string): Promise<boolean> {
  if (!password || password.length > 200) return false;
  const { data: profile } = await createAdminClient().from('profiles').select('email').eq('id', userId).maybeSingle();
  if (!profile?.email) return false;
  const verifier = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await verifier.auth.signInWithPassword({ email: profile.email, password });
  if (error || data.user?.id !== userId) return false;
  await verifier.auth.signOut({ scope: 'local' }); // revoke the verification session itself
  return true;
}

/**
 * Revokes every other session of the signed-in user and keeps this one.
 * Calls the Auth API directly: the convenience signOut() swallows 401/403/404,
 * which would let a failed revocation look like success.
 */
async function signOutOtherSessions(supabase: UserClient): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  const { error } = await supabase.auth.admin.signOut(token, 'others');
  return !error;
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
  // An email comes first, so the account has a real address before it gets a real password.
  if (!hasOwnEmail(user.email)) return { error: t.account.emailFirst };
  if (password.toLowerCase() === user.loginId.toLowerCase()) return { error: t.auth.notId };

  if (!(await rateLimit(`reauth:${user.id}`, 10, 600))) return { error: t.auth.rate };

  const supabase = await createClient();
  if (!(await hasLiveSession(supabase, user.id))) return { error: t.auth.sessionExpired };

  // A voluntary change (My account) must prove the current password, so an
  // unattended signed-in browser cannot be used to take over the account.
  // The first-login change skips this: the user just signed in with the temporary one.
  if (!user.mustChangePassword && !(await isCurrentPassword(user.id, String(formData.get('current') ?? '')))) {
    return { error: t.auth.wrongCurrent };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: t.auth.changeFailed };

  // Anyone else holding a session for this account (another device, or
  // someone who knew the old password) is signed out now. If that fails, the
  // change is not reported as complete and the first-login flag stays set.
  if (!(await signOutOtherSessions(supabase))) return { error: t.auth.revokeFailed };

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

/**
 * Adds or changes the user's own email. It becomes the account's sign-in
 * address too (signing in with the student ID keeps working, because the
 * login form looks the email up by ID).
 *
 * Re-authentication is required for every change except the very first email
 * added during first sign-in (the user has just signed in with the temporary
 * password and the account has no own address yet).
 */
export async function saveEmail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getDict();
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const parsed = z.string().trim().toLowerCase().email().max(200).safeParse(formData.get('email'));
  if (!parsed.success || !hasOwnEmail(parsed.data)) return { error: t.account.invalidEmail };
  const email = parsed.data;
  if (email === user.email.toLowerCase()) return { ok: t.account.emailSaved };

  if (!(await rateLimit(`reauth:${user.id}`, 10, 600))) return { error: t.auth.rate };

  const supabase = await createClient();
  if (!(await hasLiveSession(supabase, user.id))) return { error: t.auth.sessionExpired };

  const firstEmailAtFirstSignIn = user.mustChangePassword && !hasOwnEmail(user.email);
  if (!firstEmailAtFirstSignIn && !(await isCurrentPassword(user.id, String(formData.get('current') ?? '')))) {
    return { error: t.auth.wrongCurrent };
  }

  const admin = createAdminClient();
  const { data: taken } = await admin.from('profiles').select('id').eq('email', email).neq('id', user.id).maybeSingle();
  if (taken) return { error: t.account.emailTaken };

  // Admin API: no confirmation mail (the project has no mail service set up).
  const { error } = await admin.auth.admin.updateUserById(user.id, { email, email_confirm: true });
  if (error) return { error: /already|registered|exists/i.test(error.message) ? t.account.emailTaken : t.common.failed };
  const { error: profileError } = await admin.from('profiles').update({ email }).eq('id', user.id);
  if (profileError) {
    await admin.auth.admin.updateUserById(user.id, { email: user.email, email_confirm: true }); // keep both in step
    return { error: t.common.failed };
  }

  revalidatePath('/account');
  revalidatePath('/change-password');
  return { ok: t.account.emailSaved };
}
