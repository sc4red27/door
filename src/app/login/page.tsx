import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { login } from '@/actions/auth';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Brand } from '@/components/brand';
import { LocaleSwitch, ThemeToggle } from '@/components/header-controls';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { getSessionUser, homeFor } from '@/lib/auth';
import { getDict } from '@/i18n';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.mustChangePassword ? '/change-password' : homeFor(user.role));
  const t = await getDict();

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div className="flex items-center justify-between">
        <Brand size="lg" />
        <div className="flex items-center gap-1">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </div>
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">{t.auth.title}</h1>
          <CardDescription>{t.app.tagline}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={login} className="grid gap-4">
            <Field label={t.auth.identifier} htmlFor="identifier" hint={t.auth.identifierHint}>
              <Input
                id="identifier"
                name="identifier"
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={200}
              />
            </Field>
            <Field label={t.auth.password} htmlFor="password">
              <Input id="password" name="password" type="password" required autoComplete="current-password" maxLength={200} />
            </Field>
            <SubmitButton className="w-full">{t.auth.submit}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </main>
  );
}
