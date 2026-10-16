import type { Metadata } from 'next';
import { changePassword } from '@/actions/auth';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { EmailForm } from '@/components/email-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { PASSWORD_MIN_LENGTH, hasOwnEmail } from '@/lib/constants';
import { getDepartments, getSemesters } from '@/lib/data';
import { fmt, getDict } from '@/i18n';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  const user = await requireUser();
  const [t, departments, semesters] = await Promise.all([getDict(), getDepartments(), getSemesters()]);
  const department = departments.find((d) => d.id === user.departmentId);
  const term = semesters.find((s) => s.id === user.semesterId);
  const ownEmail = hasOwnEmail(user.email) ? user.email : null;

  const rows: [string, string][] = [
    [t.common.name, user.fullName],
    [t.account.loginId, user.loginId],
    [t.account.role, t.roles[user.role]],
    [t.account.email, ownEmail ?? t.account.emailNotSet],
  ];
  if (department) rows.push([t.common.department, `${department.code} · ${department.name}`]);
  if (user.role === 'student' && user.year) rows.push([t.common.level, t.common.levels[user.year - 1]]);
  if (user.role === 'student' && term) rows.push([t.common.semester, term.name]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.account.title} />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t.account.details}</CardTitle>
            <CardDescription>{t.account.idHint}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5 first:pt-0 last:pb-0">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium text-heading">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.account.email}</CardTitle>
            {ownEmail ? null : <CardDescription>{t.account.emailFirst}</CardDescription>}
          </CardHeader>
          <CardContent>
            <EmailForm
              t={t}
              current={ownEmail ?? undefined}
              requirePassword={!(user.mustChangePassword && !ownEmail)}
            />
          </CardContent>
        </Card>

        <Card className={ownEmail ? undefined : 'opacity-60'}>
          <CardHeader>
            <CardTitle>{t.account.changePassword}</CardTitle>
            {ownEmail ? null : <CardDescription>{t.account.emailFirst}</CardDescription>}
          </CardHeader>
          <CardContent>
            {ownEmail ? (
            <ActionForm action={changePassword} resetOnSuccess className="grid gap-4">
              {/* Lets password managers attach the new password to the right account. */}
              <input type="text" name="username" autoComplete="username" defaultValue={user.loginId} readOnly hidden />
              <Field label={t.auth.currentPassword} htmlFor="current">
                <Input id="current" name="current" type="password" required maxLength={200} autoComplete="current-password" />
              </Field>
              <Field label={t.auth.newPassword} htmlFor="password" hint={fmt(t.auth.passwordRule, { n: PASSWORD_MIN_LENGTH })}>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={200}
                  autoComplete="new-password"
                />
              </Field>
              <Field label={t.auth.confirmPassword} htmlFor="confirm">
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={200}
                  autoComplete="new-password"
                />
              </Field>
              <div>
                <SubmitButton>{t.auth.savePassword}</SubmitButton>
              </div>
            </ActionForm>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
