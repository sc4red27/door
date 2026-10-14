import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { getDict } from '@/i18n';

export default async function NotFound() {
  const t = await getDict();
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">{t.common.notFoundTitle}</h1>
      <p className="text-sm text-muted-foreground">{t.common.notFoundBody}</p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>
        {t.common.home}
      </Link>
    </main>
  );
}
