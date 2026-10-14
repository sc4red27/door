import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, Pin, Settings } from 'lucide-react';
import { MaterialBrowser } from '@/components/material-browser';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import {
  assertCourseAccess, getBookmarkIds, getCourse, getCourseAssignments, getCourseMaterials, getCourseNotices,
} from '@/lib/data';
import { formatDate, formatDateTime } from '@/lib/format';
import type { MaterialItem } from '@/lib/types';
import { zipBaseName } from '@/lib/zip-paths';
import { fmt, getDict, getLocale } from '@/i18n';

export const metadata: Metadata = { title: 'Course' };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  // 1) Authorisation through RLS on every request. 2) Shared data from the cache.
  await assertCourseAccess(id);
  const [t, locale, course, rawMaterials, notices, assignments, marked] = await Promise.all([
    getDict(),
    getLocale(),
    getCourse(id),
    getCourseMaterials(id),
    getCourseNotices(id),
    getCourseAssignments(id),
    getBookmarkIds(),
  ]);
  if (!course) notFound();

  const courseRef = { id: course.id, code: course.code, name: course.name };
  const materials: MaterialItem[] = rawMaterials.map((material) => ({ ...material, course: courseRef }));
  const canManage = user.role === 'admin' || course.professor_id === user.id;
  const now = Date.now();

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">{course.code}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{course.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{course.professor ?? t.common.unassigned}</span>
            {course.department ? <Badge variant="outline">{course.department.name}</Badge> : null}
            <Badge variant="outline">{t.common.levels[course.year - 1]}</Badge>
            <Badge variant={course.semester.is_current ? 'default' : 'secondary'}>{course.semester.name}</Badge>
            {course.semester.is_current ? null : <Badge variant="warning">{t.course.pastBadge}</Badge>}
          </div>
          {course.description ? <p className="mt-3 max-w-prose text-sm">{course.description}</p> : null}
        </div>
        {canManage ? (
          <Link href={`/teach/courses/${course.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Settings aria-hidden="true" />
            {t.course.manage}
          </Link>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="materials-heading" className="min-w-0">
          <h2 id="materials-heading" className="mb-3 text-lg font-semibold">
            {t.course.materials}
          </h2>
          <MaterialBrowser
            items={materials}
            initialMarked={marked}
            groupBy="week"
            zipAll={{ scope: 'course', courseId: course.id }}
            zipAllLabel={t.materials.downloadAll}
            zipAllName={zipBaseName([courseRef], 'course')}
          />
        </section>

        <aside className="grid content-start gap-4">
          <Card id="assignments" className="scroll-mt-32">
            <CardHeader>
              <CardTitle>{t.course.assignments}</CardTitle>
            </CardHeader>
            <CardContent>
              {assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.course.noAssignments}</p>
              ) : (
                <ul className="divide-y">
                  {assignments.map((assignment) => {
                    const files = materials.filter((material) => material.assignment_id === assignment.id);
                    const closed = new Date(assignment.due_at).getTime() < now;
                    return (
                      <li key={assignment.id} className="py-3 first:pt-0 last:pb-0">
                        <p className="text-sm font-medium">{assignment.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {fmt(t.dashboard.due, { date: formatDateTime(assignment.due_at, locale) })}
                          {closed ? <Badge variant="secondary">{t.course.closed}</Badge> : null}
                        </p>
                        {assignment.description ? (
                          <p className="mt-1.5 whitespace-pre-line text-sm">{assignment.description}</p>
                        ) : null}
                        {files.length > 0 ? (
                          <ul className="mt-2 grid gap-1" aria-label={t.teach.attachments}>
                            {files.map((file) => (
                              <li key={file.id}>
                                <a
                                  href={`/api/download/${file.id}`}
                                  className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm text-primary hover:underline"
                                >
                                  <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span className="truncate">{file.file_name}</span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card id="notices" className="scroll-mt-32">
            <CardHeader>
              <CardTitle>{t.course.notices}</CardTitle>
            </CardHeader>
            <CardContent>
              {notices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.course.noNotices}</p>
              ) : (
                <ul className="divide-y">
                  {notices.map((notice) => (
                    <li key={notice.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {notice.pinned ? (
                          <>
                            <Pin className="h-3.5 w-3.5 shrink-0 text-mark" aria-hidden="true" />
                            <span className="sr-only">{t.course.pinned}: </span>
                          </>
                        ) : null}
                        {notice.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(notice.created_at, locale)}</p>
                      {notice.body ? <p className="mt-1.5 whitespace-pre-line text-sm">{notice.body}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
