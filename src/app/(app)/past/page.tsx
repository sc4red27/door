import type { Metadata } from 'next';
import { CourseCard } from '@/components/course-card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { getMyCourses } from '@/lib/data';
import type { CourseSummary } from '@/lib/types';
import { getDict } from '@/i18n';

export const metadata: Metadata = { title: 'Past semesters' };

/**
 * Enrollment rows are never deleted on promotion, so RLS keeps granting read
 * access to old courses. Students have no write policies at all, which makes
 * these pages read-only by construction.
 */
export default async function PastSemestersPage() {
  await requireUser(['student']);
  const [t, courses] = await Promise.all([getDict(), getMyCourses()]);

  const bySemester = new Map<string, { name: string; start: string; courses: CourseSummary[] }>();
  for (const course of courses) {
    if (course.semester.is_current) continue;
    const group = bySemester.get(course.semester.id) ?? {
      name: course.semester.name,
      start: course.semester.start_date,
      courses: [],
    };
    group.courses.push(course);
    bySemester.set(course.semester.id, group);
  }
  const semesters = [...bySemester.values()].sort((a, b) => b.start.localeCompare(a.start));

  return (
    <>
      <PageHeader title={t.past.title} subtitle={t.past.subtitle} />
      {semesters.length === 0 ? <EmptyState>{t.past.empty}</EmptyState> : null}
      <div className="grid gap-8">
        {semesters.map((semester) => (
          <section key={semester.name} aria-label={semester.name}>
            <h2 className="mb-3 text-lg font-semibold">{semester.name}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {semester.courses.map((course) => (
                <CourseCard key={course.id} course={course} href={`/courses/${course.id}`} t={t} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
