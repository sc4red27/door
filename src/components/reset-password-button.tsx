'use client';

import { useState, useTransition } from 'react';
import { resetPassword } from '@/actions/admin';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/i18n/shared';

/** Issues a new temporary password and shows it once, right in the row. */
export function ResetPasswordButton({ userId, name }: { userId: string; name: string }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ password?: string; error?: string } | null>(null);

  if (result?.password) {
    return (
      <span role="status" className="text-xs">
        {t.admin.resetDone} <code className="select-all rounded bg-muted px-1.5 py-0.5 font-mono">{result.password}</code>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`${t.admin.resetPassword}: ${name}`}
        onClick={() => {
          if (!window.confirm(fmt(t.admin.resetConfirm, { name }))) return;
          startTransition(async () => {
            setResult(await resetPassword(userId).catch(() => ({ error: t.common.failed })));
          });
        }}
      >
        {t.admin.resetPassword}
      </Button>
      {result?.error ? (
        <span role="alert" className="text-xs text-destructive">
          {result.error}
        </span>
      ) : null}
    </span>
  );
}
