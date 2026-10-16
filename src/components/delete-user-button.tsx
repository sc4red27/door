'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteUser } from '@/actions/admin';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/i18n/shared';

/** Deletes one account after a confirmation naming the person and their ID. */
export function DeleteUserButton({ userId, name, loginId }: { userId: string; name: string; loginId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={pending}
        aria-label={`${t.admin.deleteUser}: ${name}`}
        onClick={() => {
          if (!window.confirm(fmt(t.admin.deleteUserConfirm, { name, id: loginId }))) return;
          setError(null);
          startTransition(async () => {
            const result = await deleteUser(userId).catch(() => ({ error: t.common.failed }));
            if ('error' in result) setError(result.error);
            else router.refresh();
          });
        }}
      >
        <Trash2 aria-hidden="true" />
        {t.common.delete}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
