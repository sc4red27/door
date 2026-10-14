import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { getSemesters } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { getDict } from '@/i18n';

export const metadata: Metadata = { title: 'Admin' };

export default async function AdminPage() {
  await requireUser(['admin']);
  const supabase = await createClient();
  const count = (table: string, role?: string) => {
    const query = supabase.from(table).select('id', { count: 'exact', head: true });
    return role ? query.eq('role', role) : query;
  };

  const [t, semesters, students, professors, courses, departments] = await Promise.all([
    getDict(),
    getSemesters(),
    count('profiles', 'student'),
    count('profiles', 'professor'),
    count('courses'),
    count('departments'),
  ]);
  const current = semesters.find((semester) => semester.is_current);

  const tiles = [
    { href: '/admin/semesters', label: t.admin.currentSemester, value: current?.name ?? t.admin.none },
    { href: '/admin/users?role=student', label: t.admin.students, value: String(students.count ?? 0) },
    { href: '/admin/users?role=professor', label: t.admin.professors, value: String(professors.count ?? 0) },
    { href: '/admin/courses', label: t.admin.courses, value: String(courses.count ?? 0) },
    { href: '/admin/departments', label: t.nav.departments, value: String(departments.count ?? 0) },
    { href: '/admin/import', label: t.nav.import, value: 'CSV' },
  ];

  return (
    <>
      <PageHeader title={t.admin.title} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <li key={tile.href}>
            <Link
              href={tile.href}
              className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/60 hover:bg-accent/40"
            >
              <span className="text-sm text-muted-foreground">{tile.label}</span>
              <span className="text-2xl font-semibold tabular-nums">{tile.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
