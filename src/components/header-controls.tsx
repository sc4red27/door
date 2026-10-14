'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Languages, Moon, Sun } from 'lucide-react';
import { setLocale } from '@/actions/prefs';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
        active ? 'bg-primary/10 text-primary-ink' : 'text-muted-foreground hover:text-heading',
      )}
    >
      {children}
    </Link>
  );
}

export function ThemeToggle() {
  const { t } = useI18n();
  function toggle() {
    const dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // private mode: the choice simply lasts for this page view
    }
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={t.nav.theme} title={t.nav.theme}>
      <Sun className="hidden dark:block" aria-hidden="true" />
      <Moon className="dark:hidden" aria-hidden="true" />
    </Button>
  );
}

export function LocaleSwitch() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = locale === 'ko' ? 'en' : 'ko';
  return (
    <Button
      variant="ghost"
      size="sm"
      lang={next}
      disabled={pending}
      aria-label={t.nav.switchLanguage}
      onClick={() =>
        startTransition(async () => {
          await setLocale(next);
          router.refresh();
        })
      }
    >
      <Languages aria-hidden="true" />
      <span className="hidden sm:inline">{t.nav.languageShort}</span>
    </Button>
  );
}
