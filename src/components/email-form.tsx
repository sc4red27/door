import { saveEmail } from '@/actions/auth';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Field, Input } from '@/components/ui/form';
import type { Dict } from '@/i18n/shared-server';

/** Add or change the signed-in user's own email (first sign-in step 1, and My account). */
export function EmailForm({ t, current, autoFocus = false }: { t: Dict; current?: string; autoFocus?: boolean }) {
  return (
    <ActionForm action={saveEmail} className="grid gap-4">
      <Field label={t.account.email} htmlFor="email" hint={t.account.emailHint}>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoFocus={autoFocus}
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          maxLength={200}
          defaultValue={current}
        />
      </Field>
      <div>
        <SubmitButton>{t.account.saveEmail}</SubmitButton>
      </div>
    </ActionForm>
  );
}
