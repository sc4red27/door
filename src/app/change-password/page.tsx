import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { changePassword, signOut } from '@/actions/auth';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { EmailForm } from '@/components/email-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { getSessionUser } from '@/lib/auth';
import { PASSWORD_MIN_LENGTH, hasOwnEmail } from '@/lib/constants';
import { fmt, getDict } from '@/i18n';

export const metadata: Metadata = { title: 'New password' };

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // Voluntary changes live on My account (they also ask for the current password).
  if (!user.mustChangePassword) redirect('/account');
  const t = await getDict();
  const needsEmail = !hasOwnEmail(user.email);

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">{needsEmail ? t.auth.stepEmail : t.auth.stepPassword}</h1>
          <CardDescription>
            {user.fullName} · {user.loginId}
            <br />
            {needsEmail ? t.auth.stepEmailHint : t.auth.changeHint}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {needsEmail ? (
            <EmailForm t={t} autoFocus requirePassword={false} />
          ) : (
          <ActionForm action={changePassword} className="grid gap-4">
            {/* Lets password managers attach the new password to the right account. */}
            <input type="text" name="username" autoComplete="username" defaultValue={user.loginId} readOnly hidden />
            <Field
              label={t.auth.newPassword}
              htmlFor="password"
              hint={fmt(t.auth.passwordRule, { n: PASSWORD_MIN_LENGTH })}
            >
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoFocus
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
            <SubmitButton className="w-full">{t.auth.savePassword}</SubmitButton>
          </ActionForm>
          )}
          <form action={signOut} className="mt-3">
            <Button type="submit" variant="ghost" className="w-full">
              {t.nav.signOut}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
