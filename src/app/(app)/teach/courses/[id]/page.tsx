import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Eye, Pin } from 'lucide-react';
import {
  createAssignment, createNotice, deleteAssignment, deleteCourse, deleteNotice, saveCourse,
} from '@/actions/teach';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { CourseFields } from '@/components/course-fields';
import { DateTimeField } from '@/components/datetime-field';
import { MaterialManager } from '@/components/material-manager';
import { Uploader } from '@/components/uploader';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input, Label, Textarea } from '@/components/ui/form';
import { Badge } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { COURSE_SELECT, toCourse } from '@/lib/data';
import { formatDate, formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { AssignmentItem, MaterialItem, NoticeItem } from '@/lib/types';
import { isUuid } from '@/lib/utils';
import { fmt, getDict, getLocale } from '@/i18n';

export const metadata: Metadata = { title: 'Manage course' };

type MaterialRow = Omit<MaterialItem, 'course'>;

export default async function ManageCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(['professor', 'admin']);
  if (!isUuid(id)) notFound();

  // Always fresh here (no cache): the professor must see edits immediately.
  const supabase = await createClient();
  const { data: row } = await supabase.from('courses').select(COURSE_SELECT).eq('id', id).maybeSingle();
  if (!row) notFound();
  const course = toCourse(row);
  if (user.role !== 'admin' && course.professor_id !== user.id) notFound();

  const [t, locale, materialsResult, noticesResult, assignmentsResult, rosterResult] = await Promise.all([
    getDict(),
    getLocale(),
    supabase
      .from('materials')
      .select('id, title, type, week, file_name, size_bytes, mime_type, created_at, assignment_id')
      .eq('course_id', id)
      .order('week', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(2000),
    supabase
      .from('notices')
      .select('id, course_id, title, body, pinned, created_at')
      .eq('course_id', id)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('assignments')
      .select('id, course_id, title, description, due_at')
      .eq('course_id', id)
      .order('due_at', { ascending: true })
      .limit(200),
    supabase.from('enrollments').select('student_id', { count: 'exact', head: true }).eq('course_id', id),
  ]);

  const materials = (materialsResult.data ?? []) as MaterialRow[];
  const notices = (noticesResult.data ?? []) as NoticeItem[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentItem[];
  const general = materials.filter((material) => !material.assignment_id);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">{course.code}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{course.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {course.department ? <Badge variant="outline">{course.department.name}</Badge> : null}
            <Badge variant="outline">{t.common.levels[course.year - 1]}</Badge>
            <Badge variant={course.semester.is_current ? 'default' : 'secondary'}>{course.semester.name}</Badge>
            <span>{fmt(t.teach.students, { n: rosterResult.count ?? 0 })}</span>
          </div>
        </div>
        <Link href={`/courses/${course.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Eye aria-hidden="true" />
          {t.course.studentView}
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t.teach.upload}</CardTitle>
            </CardHeader>
            <CardContent>
              <Uploader courseId={course.id} />
            </CardContent>
          </Card>

          <section aria-labelledby="manage-materials">
            <h2 id="manage-materials" className="mb-3 text-lg font-semibold">
              {t.teach.manageMaterials}
            </h2>
            <MaterialManager courseId={course.id} items={general} />
          </section>

          <section aria-labelledby="manage-assignments" className="grid gap-3">
            <h2 id="manage-assignments" className="text-lg font-semibold">
              {t.course.assignments}
            </h2>
            <Card>
              <CardHeader>
                <CardTitle>{t.teach.newAssignment}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionForm action={createAssignment} resetOnSuccess className="grid gap-3">
                  <input type="hidden" name="course_id" value={course.id} />
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_15rem]">
                    <Field label={t.common.title} htmlFor="assignment-title">
                      <Input id="assignment-title" name="title" required maxLength={200} />
                    </Field>
                    <Field label={t.teach.dueAt} htmlFor="assignment-due">
                      <DateTimeField id="assignment-due" name="due_at" required />
                    </Field>
                  </div>
                  <Field label={`${t.common.description} (${t.common.optional})`} htmlFor="assignment-description">
                    <Textarea id="assignment-description" name="description" maxLength={10000} />
                  </Field>
                  <div>
                    <SubmitButton>{t.common.create}</SubmitButton>
                  </div>
                </ActionForm>
              </CardContent>
            </Card>

            {assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.course.noAssignments}</p>
            ) : (
              assignments.map((assignment) => {
                const files = materials.filter((material) => material.assignment_id === assignment.id);
                return (
                  <Card key={assignment.id}>
                    <CardHeader className="flex-row items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle>{assignment.title}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {fmt(t.dashboard.due, { date: formatDateTime(assignment.due_at, locale) })}
                        </p>
                      </div>
                      <ActionForm action={deleteAssignment}>
                        <input type="hidden" name="id" value={assignment.id} />
                        <SubmitButton variant="ghost" size="sm" className="text-destructive" confirm={t.common.confirmDelete}>
                          {t.common.delete}
                        </SubmitButton>
                      </ActionForm>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      {assignment.description ? (
                        <p className="whitespace-pre-line text-sm">{assignment.description}</p>
                      ) : null}
                      {files.length > 0 ? (
                        <div>
                          <p className="mb-1.5 text-sm font-medium">{t.teach.attachments}</p>
                          <MaterialManager courseId={course.id} items={files} />
                        </div>
                      ) : null}
                      <details className="rounded-md border px-3 py-2">
                        <summary className="cursor-pointer text-sm font-medium">{t.teach.attach}</summary>
                        <div className="pt-3">
                          <Uploader courseId={course.id} assignmentId={assignment.id} fixedType="assignment" />
                        </div>
                      </details>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </section>
        </div>

        <aside className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.teach.newNotice}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={createNotice} resetOnSuccess className="grid gap-3">
                <input type="hidden" name="course_id" value={course.id} />
                <Field label={t.common.title} htmlFor="notice-title">
                  <Input id="notice-title" name="title" required maxLength={200} />
                </Field>
                <Field label={t.teach.noticeBody} htmlFor="notice-body">
                  <Textarea id="notice-body" name="body" maxLength={10000} />
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox id="notice-pinned" name="pinned" />
                  <Label htmlFor="notice-pinned">{t.teach.pin}</Label>
                </div>
                <div>
                  <SubmitButton>{t.teach.post}</SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.course.notices}</CardTitle>
            </CardHeader>
            <CardContent>
              {notices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.course.noNotices}</p>
              ) : (
                <ul className="divide-y">
                  {notices.map((notice) => (
                    <li key={notice.id} className="flex items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {notice.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-mark" aria-label={t.course.pinned} /> : null}
                          <span className="truncate">{notice.title}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{formatDate(notice.created_at, locale)}</p>
                      </div>
                      <ActionForm action={deleteNotice}>
                        <input type="hidden" name="id" value={notice.id} />
                        <SubmitButton variant="ghost" size="sm" className="text-destructive" confirm={t.common.confirmDelete}>
                          {t.common.delete}
                        </SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.teach.courseDetails}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ActionForm action={saveCourse} className="grid gap-4">
                <CourseFields course={course} isAdmin={user.role === 'admin'} compact />
                <div>
                  <SubmitButton>{t.common.save}</SubmitButton>
                </div>
              </ActionForm>
              <ActionForm action={deleteCourse} className="border-t pt-4">
                <input type="hidden" name="id" value={course.id} />
                <SubmitButton variant="destructive" size="sm" confirm={t.teach.deleteCourseConfirm}>
                  {t.teach.deleteCourse}
                </SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
