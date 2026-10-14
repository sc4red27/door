import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { CourseCard } from '@/components/course-card';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { COURSE_SELECT, toCourse } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { getDict } from '@/i18n';

export const metadata: Metadata = { title: 'My courses' };

export default async function TeachPage() {
  const user = await requireUser(['professor', 'admin']);
  const t = await getDict();

  // A professor's courses may belong to any department; ownership is professor_id.
  const supabase = await createClient();
  const { data } = await supabase.from('courses').select(COURSE_SELECT).eq('professor_id', user.id).limit(500);
  const courses = (data ?? [])
    .map(toCourse)
    .sort(
      (a, b) =>
        Number(b.semester.is_current) - Number(a.semester.is_current) ||
        b.semester.start_date.localeCompare(a.semester.start_date) ||
        a.code.localeCompare(b.code),
    );

  return (
    <>
      <PageHeader title={t.teach.title}>
        <Link href="/teach/courses/new" className={buttonVariants()}>
          <Plus aria-hidden="true" />
          {t.teach.newCourse}
        </Link>
      </PageHeader>
      {courses.length === 0 ? (
        <EmptyState>{t.teach.noCourses}</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} href={`/teach/courses/${course.id}`} t={t} />
          ))}
        </div>
      )}
    </>
  );
}
