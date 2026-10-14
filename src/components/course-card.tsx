import Link from 'next/link';
import { Badge } from '@/components/ui/misc';
import type { Dict } from '@/i18n/shared-server';
import type { CourseSummary } from '@/lib/types';

/** One course tile. The whole card is a single link (large touch target, one tab stop). */
export function CourseCard({ course, href, t }: { course: CourseSummary; href: string; t: Dict }) {
  return (
    <Link
      href={href}
      className="group flex min-h-32 flex-col justify-between gap-4 rounded-xl border bg-card p-5 shadow-sm transition-[box-shadow,border-color] hover:border-heading/15 hover:shadow-md"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{course.code}</p>
        <h3 className="mt-1 text-base font-semibold leading-snug group-hover:underline group-hover:decoration-heading/30 group-hover:underline-offset-4">{course.name}</h3>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{course.professor ?? t.common.unassigned}</span>
        {course.department ? <Badge variant="outline">{course.department.code}</Badge> : null}
        <Badge variant="outline">{t.common.levels[course.year - 1]}</Badge>
        <Badge variant={course.semester.is_current ? 'default' : 'secondary'}>{course.semester.name}</Badge>
      </div>
    </Link>
  );
}
