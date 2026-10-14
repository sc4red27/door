'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/provider';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-xl font-semibold">{t.common.errorTitle}</h1>
      <p className="text-sm text-muted-foreground">{t.common.failed}</p>
      <Button variant="outline" onClick={reset}>
        {t.common.retry}
      </Button>
    </div>
  );
}
