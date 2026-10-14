import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { signOut } from '@/actions/auth';
import { LocaleSwitch, NavLink, ThemeToggle } from '@/components/header-controls';
import { Button } from '@/components/ui/button';
import { getDict } from '@/i18n';
import type { SessionUser } from '@/lib/auth';

type NavItem = { href: string; label: string; exact?: boolean };

export async function SiteHeader({ user }: { user: SessionUser }) {
  const t = await getDict();

  const links: NavItem[] =
    user.role === 'student'
      ? [
          { href: '/dashboard', label: t.nav.dashboard },
          { href: '/marked', label: t.nav.marked },
          { href: '/past', label: t.nav.past },
        ]
      : user.role === 'professor'
        ? [
            { href: '/teach', label: t.nav.teach },
            { href: '/marked', label: t.nav.marked },
          ]
        : [
            { href: '/admin', label: t.nav.overview, exact: true },
            { href: '/admin/departments', label: t.nav.departments },
            { href: '/admin/semesters', label: t.nav.semesters },
            { href: '/admin/courses', label: t.nav.courses },
            { href: '/admin/users', label: t.nav.users },
            { href: '/admin/import', label: t.nav.import },
          ];

  const nav = links.map((link) => (
    <NavLink key={link.href} href={link.href} exact={link.exact}>
      {link.label}
    </NavLink>
  ));

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <Link href="/" className="mr-2 whitespace-nowrap text-base font-semibold tracking-tight">
          {t.app.name}
        </Link>
        <nav aria-label={t.nav.main} className="hidden items-center gap-1 md:flex">
          {nav}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <span className="hidden max-w-40 truncate text-sm text-muted-foreground lg:inline" title={user.loginId}>
            {user.fullName}
          </span>
          <LocaleSwitch />
          <ThemeToggle />
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="icon" aria-label={t.nav.signOut} title={t.nav.signOut}>
              <LogOut aria-hidden="true" />
            </Button>
          </form>
        </div>
      </div>
      {/* Small screens: the same links as a horizontally scrollable row. */}
      <nav aria-label={t.nav.main} className="flex gap-1 overflow-x-auto border-t px-3 py-1.5 md:hidden">
        {nav}
      </nav>
    </header>
  );
}
