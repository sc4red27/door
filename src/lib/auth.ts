import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/types';

export type SessionUser = {
  id: string;
  role: Role;
  loginId: string;
  fullName: string;
  departmentId: string | null;
  year: number | null;
  semesterId: string | null;
  mustChangePassword: boolean;
};

export function homeFor(role: Role): string {
  return role === 'admin' ? '/admin' : role === 'professor' ? '/teach' : '/dashboard';
}

/**
 * The signed-in user, deduplicated per request. The JWT is verified by
 * getClaims(); the role comes from the profiles row (read through RLS), never
 * from anything the browser can edit.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, login_id, full_name, department_id, year, semester_id, must_change_password')
    .eq('id', userId)
    .maybeSingle();
  if (!profile) return null;

  return {
    id: profile.id,
    role: profile.role as Role,
    loginId: profile.login_id,
    fullName: profile.full_name,
    departmentId: profile.department_id,
    year: profile.year,
    semesterId: profile.semester_id,
    mustChangePassword: profile.must_change_password,
  };
});

/** For pages and server actions: redirects instead of returning null. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');
  if (roles && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}
