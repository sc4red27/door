import Link from 'next/link';
import { LogOut, UserRound } from 'lucide-react';
import { signOut } from '@/actions/auth';
import { Brand } from '@/components/brand';
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
    <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="mr-4 rounded-md" aria-label={t.app.name}>
          <Brand />
        </Link>
        <nav aria-label={t.nav.main} className="hidden items-center gap-1 md:flex">
          {nav}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/account"
            title={`${t.nav.account} · ${user.loginId}`}
            aria-label={t.nav.account}
            className="inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-heading"
          >
            <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden max-w-40 truncate lg:inline">{user.fullName}</span>
          </Link>
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
