import type { Metadata } from 'next';
import Link from 'next/link';
import { manualEnrollment } from '@/actions/admin';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { ResetPasswordButton } from '@/components/reset-password-button';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Label, Select } from '@/components/ui/form';
import { Badge, EmptyState, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { getSemesters } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/types';
import { fmt, getDict } from '@/i18n';

export const metadata: Metadata = { title: 'Users' };

const PAGE_SIZE = 50;
const ROLES: Role[] = ['student', 'professor', 'admin'];

type UserRow = {
  id: string;
  login_id: string;
  full_name: string;
  email: string;
  role: Role;
  year: number | null;
  must_change_password: boolean;
  department: { code: string } | null;
  semester: { name: string } | null;
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; page?: string }>;
}) {
  await requireUser(['admin']);
  const [params, t, semesters] = await Promise.all([searchParams, getDict(), getSemesters()]);

  // Strip characters that have a meaning in PostgREST filter syntax.
  const q = (params.q ?? '').replace(/[%,()"\\*:]/g, ' ').trim().slice(0, 60);
  const role = ROLES.find((value) => value === params.role);
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const supabase = await createClient();
  let query = supabase
    .from('profiles')
    .select(
      'id, login_id, full_name, email, role, year, must_change_password, department:departments(code), semester:semesters(name)',
      { count: 'exact' },
    )
    .order('login_id')
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1); // server-side pagination
  if (role) query = query.eq('role', role);
  if (q) query = query.or(`login_id.ilike.%${q}%,full_name.ilike.%${q}%`);
  const { data, count } = await query;
  const users = (data ?? []) as unknown as UserRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (q) search.set('q', q);
    if (role) search.set('role', role);
    if (target > 1) search.set('page', String(target));
    const text = search.toString();
    return text ? `/admin/users?${text}` : '/admin/users';
  };

  return (
    <>
      <PageHeader title={t.nav.users} subtitle={fmt(t.admin.total, { n: total })} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label={t.nav.users} className="min-w-0">
          <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2">
            <div className="grid min-w-48 flex-1 gap-1.5">
              <Label htmlFor="user-search">{t.admin.searchUsers}</Label>
              <Input id="user-search" name="q" type="search" defaultValue={q} maxLength={60} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="user-role">{t.common.type}</Label>
              <Select id="user-role" name="role" defaultValue={role ?? ''} className="w-36">
                <option value="">{t.admin.allRoles}</option>
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {t.roles[value]}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline">
              {t.common.search}
            </Button>
          </form>

          {users.length === 0 ? (
            <EmptyState>{t.admin.none}</EmptyState>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {users.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium">
                      {user.full_name} <span className="font-normal text-muted-foreground">· {user.login_id}</span>
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant={user.role === 'student' ? 'secondary' : 'default'}>{t.roles[user.role]}</Badge>
                      {user.department ? <span>{user.department.code}</span> : null}
                      {user.year ? <span>{t.common.levels[user.year - 1]}</span> : null}
                      {user.semester ? <span>{user.semester.name}</span> : null}
                      {user.role === 'student' ? null : <span className="truncate">{user.email}</span>}
                      {user.must_change_password ? <Badge variant="warning">{t.admin.mustChange}</Badge> : null}
                    </p>
                  </div>
                  <ResetPasswordButton userId={user.id} name={user.full_name} />
                </li>
              ))}
            </ul>
          )}

          {pages > 1 ? (
            <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  {t.common.previous}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm tabular-nums text-muted-foreground">
                {page} / {pages}
              </span>
              {page < pages ? (
                <Link href={pageHref(page + 1)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  {t.common.next}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </section>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t.admin.enrollTitle}</CardTitle>
            <CardDescription>{t.admin.enrollHint}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={manualEnrollment} className="grid gap-3">
              <Field label={t.admin.studentId} htmlFor="enroll-student">
                <Input id="enroll-student" name="student_id" required maxLength={40} spellCheck={false} />
              </Field>
              <Field label={t.admin.courseCode} htmlFor="enroll-course">
                <Input id="enroll-course" name="course_code" required maxLength={20} spellCheck={false} className="uppercase" />
              </Field>
              <Field label={t.common.semester} htmlFor="enroll-semester">
                <Select
                  id="enroll-semester"
                  name="semester_id"
                  required
                  defaultValue={semesters.find((semester) => semester.is_current)?.id}
                >
                  {semesters.map((semester) => (
                    <option key={semester.id} value={semester.id}>
                      {semester.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-wrap gap-2">
                <SubmitButton name="intent" value="add">
                  {t.admin.enroll}
                </SubmitButton>
                <SubmitButton name="intent" value="remove" variant="outline">
                  {t.admin.unenroll}
                </SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
