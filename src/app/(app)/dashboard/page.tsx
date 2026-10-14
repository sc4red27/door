import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CourseCard } from '@/components/course-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { getLatestNotices, getMyCourses, getSemesters, getUpcomingAssignments } from '@/lib/data';
import { daysUntil, formatDate, formatDateTime } from '@/lib/format';
import { fmt, getDict, getLocale } from '@/i18n';

export const metadata: Metadata = { title: 'Dashboard' };

/** The student's courses for the current semester: no searching or selecting. */
async function currentCourses() {
  return (await getMyCourses()).filter((course) => course.semester.is_current);
}

async function Courses() {
  const [t, courses] = await Promise.all([getDict(), currentCourses()]);
  if (courses.length === 0) return <EmptyState>{t.dashboard.noCourses}</EmptyState>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} href={`/courses/${course.id}`} t={t} />
      ))}
    </div>
  );
}

async function Notices() {
  const [t, locale, courses] = await Promise.all([getDict(), getLocale(), currentCourses()]);
  const notices = await getLatestNotices(courses.map((course) => course.id));
  if (notices.length === 0) return <p className="text-sm text-muted-foreground">{t.dashboard.noNotices}</p>;
  return (
    <ul className="divide-y">
      {notices.map((notice) => (
        <li key={notice.id} className="py-2.5 first:pt-0 last:pb-0">
          <Link href={`/courses/${notice.course_id}#notices`} className="block rounded-sm hover:underline">
            <span className="text-sm font-medium">{notice.title}</span>
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {notice.course?.code} · {formatDate(notice.created_at, locale)}
          </p>
        </li>
      ))}
    </ul>
  );
}

async function Deadlines() {
  const [t, locale, courses] = await Promise.all([getDict(), getLocale(), currentCourses()]);
  const assignments = await getUpcomingAssignments(courses.map((course) => course.id));
  if (assignments.length === 0) return <p className="text-sm text-muted-foreground">{t.dashboard.noDeadlines}</p>;
  return (
    <ul className="divide-y">
      {assignments.map((assignment) => {
        const days = daysUntil(assignment.due_at);
        return (
          <li key={assignment.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <Link href={`/courses/${assignment.course_id}#assignments`} className="block rounded-sm hover:underline">
                <span className="text-sm font-medium">{assignment.title}</span>
              </Link>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {assignment.course?.code} · {fmt(t.dashboard.due, { date: formatDateTime(assignment.due_at, locale) })}
              </p>
            </div>
            <Badge variant={days <= 2 ? 'destructive' : days <= 7 ? 'warning' : 'secondary'} className="shrink-0">
              {days <= 1 ? t.dashboard.dueToday : fmt(t.dashboard.daysLeft, { n: days })}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser(['student']);
  const [t, semesters] = await Promise.all([getDict(), getSemesters()]);
  const current = semesters.find((semester) => semester.is_current);

  return (
    <>
      <PageHeader
        title={fmt(t.dashboard.greeting, { name: user.fullName })}
        subtitle={current ? fmt(t.dashboard.subtitle, { semester: current.name }) : t.dashboard.noSemester}
      />

      <section aria-labelledby="courses-heading" className="mb-8">
        <h2 id="courses-heading" className="mb-3 text-lg font-semibold">
          {t.dashboard.courses}
        </h2>
        <Suspense
          fallback={
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          }
        >
          <Courses />
        </Suspense>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.deadlines}</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ListSkeleton />}>
              <Deadlines />
            </Suspense>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.notices}</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<ListSkeleton />}>
              <Notices />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
