import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/form';
import { Badge, EmptyState, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { COURSE_SELECT, getSemesters, toCourse } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/utils';
import { fmt, getDict } from '@/i18n';

export const metadata: Metadata = { title: 'Courses' };

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string }>;
}) {
  await requireUser(['admin']);
  const [{ semester: requested }, t, semesters] = await Promise.all([searchParams, getDict(), getSemesters()]);
  const semesterId = isUuid(requested)
    ? requested
    : (semesters.find((semester) => semester.is_current)?.id ?? semesters[0]?.id);

  const supabase = await createClient();
  const { data } = semesterId
    ? await supabase
        .from('courses')
        .select(COURSE_SELECT)
        .eq('semester_id', semesterId) // uses the (department_id, semester_id) / unique(semester_id, code) indexes
        .order('code')
        .limit(1000)
    : { data: [] };
  const courses = (data ?? []).map(toCourse);

  return (
    <>
      <PageHeader title={t.admin.courses} subtitle={fmt(t.admin.total, { n: courses.length })}>
        <Link href="/teach/courses/new" className={buttonVariants()}>
          <Plus aria-hidden="true" />
          {t.teach.newCourse}
        </Link>
      </PageHeader>

      {/* Plain GET form: filtering works without any client JavaScript. */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="semester-filter">{t.common.semester}</Label>
          <Select id="semester-filter" name="semester" defaultValue={semesterId} className="w-44">
            {semesters.map((semester) => (
              <option key={semester.id} value={semester.id}>
                {semester.name}
                {semester.is_current ? ` (${t.common.current})` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          {t.common.search}
        </Button>
      </form>

      {courses.length === 0 ? (
        <EmptyState>{t.admin.none}</EmptyState>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {courses.map((course) => (
            <li key={course.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate text-sm font-medium">
                  <span className="text-primary">{course.code}</span> · {course.name}
                </p>
                <p className="text-xs text-muted-foreground">{course.professor ?? t.common.unassigned}</p>
              </div>
              {course.department ? <Badge variant="outline">{course.department.code}</Badge> : null}
              <Badge variant="outline">{t.common.levels[course.year - 1]}</Badge>
              <Link
                href={`/teach/courses/${course.id}`}
                aria-label={`${t.admin.manage}: ${course.code}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {t.admin.manage}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
