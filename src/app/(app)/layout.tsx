import { SiteHeader } from '@/components/site-header';
import { requireUser } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <SiteHeader user={user} />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
        {children}
      </main>
    </>
  );
}
