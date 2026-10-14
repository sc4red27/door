import Link from 'next/link';
import { Badge } from '@/components/ui/misc';
import type { Dict } from '@/i18n/shared-server';
import type { CourseSummary } from '@/lib/types';

/** One course tile. The whole card is a single link (large touch target, one tab stop). */
export function CourseCard({ course, href, t }: { course: CourseSummary; href: string; t: Dict }) {
  return (
    <Link
      href={href}
      className="group flex min-h-28 flex-col justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/60 hover:bg-accent/40"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{course.code}</p>
        <h3 className="mt-0.5 text-base font-semibold leading-snug group-hover:underline">{course.name}</h3>
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
