import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/auth';
import { isUuid } from '@/lib/utils';
import type {
  AssignmentItem, CourseDetail, CourseSummary, Department, MaterialItem, NoticeItem, Semester,
} from '@/lib/types';

/* -------------------------------------------------------------------------- *
 * Data access
 *
 *   1. Authorisation is checked on every request with the user's own client
 *      (RLS): assertCourseAccess(). This is one indexed primary-key lookup.
 *   2. The course-level data everyone in the course shares (details, material
 *      list, notices, assignments) is then read with the service role.
 *
 * Nothing here is kept in the Next.js data cache: that cache is per
 * deployment, so a change made anywhere else (local dev, the seed script, the
 * Supabase dashboard) would stay invisible on the live site for up to an hour.
 * Each read is one indexed query, so fresh reads are cheap.
 * -------------------------------------------------------------------------- */

export const courseTag = (courseId: string) => `course:${courseId}`;
export const COURSES_TAG = 'courses';

const COURSE_SELECT =
  'id, code, name, description, year, professor_id, department_id, ' +
  'semester:semesters(id, name, is_current, start_date), ' +
  'department:departments(code, name), ' +
  'professor:profiles!courses_professor_id_fkey(full_name)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCourse(row: any): CourseDetail {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    year: row.year,
    professor_id: row.professor_id ?? null,
    department_id: row.department_id,
    semester: row.semester,
    department: row.department ?? null,
    professor: row.professor?.full_name ?? null,
  };
}

/** 404s unless the signed-in user can see the course (enrolled, teaching, or admin). */
export async function assertCourseAccess(courseId: string): Promise<void> {
  if (!isUuid(courseId)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from('courses').select('id').eq('id', courseId).maybeSingle();
  if (!data) notFound();
}

export async function getCourse(courseId: string): Promise<CourseDetail | null> {
  const { data } = await createAdminClient().from('courses').select(COURSE_SELECT).eq('id', courseId).maybeSingle();
  return data ? toCourse(data) : null;
}

export async function getCourseMaterials(courseId: string): Promise<Omit<MaterialItem, 'course'>[]> {
  const { data, error } = await createAdminClient()
    .from('materials')
    .select('id, title, type, week, file_name, size_bytes, mime_type, created_at, assignment_id')
    .eq('course_id', courseId)
    .order('week', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Omit<MaterialItem, 'course'>[];
}

export async function getCourseNotices(courseId: string): Promise<NoticeItem[]> {
  const { data, error } = await createAdminClient()
    .from('notices')
    .select('id, course_id, title, body, pinned, created_at')
    .eq('course_id', courseId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as NoticeItem[];
}

export async function getCourseAssignments(courseId: string): Promise<AssignmentItem[]> {
  const { data, error } = await createAdminClient()
    .from('assignments')
    .select('id, course_id, title, description, due_at')
    .eq('course_id', courseId)
    .order('due_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssignmentItem[];
}

/* ------------------------------------------------------------ per-user (RLS) */

/** Every course the student is enrolled in, all semesters. Deduplicated per request. */
export const getMyCourses = cache(async (): Promise<CourseSummary[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('enrollments')
    .select(
      'course:courses!inner(id, code, name, year, ' +
        'semester:semesters!inner(id, name, is_current, start_date), ' +
        'department:departments(code, name), ' +
        'professor:profiles!courses_professor_id_fkey(full_name))',
    )
    .eq('student_id', user.id);
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .map((row) => row.course)
    .filter(Boolean)
    .map(
      (c): CourseSummary => ({
        id: c.id,
        code: c.code,
        name: c.name,
        year: c.year,
        semester: c.semester,
        department: c.department ?? null,
        professor: c.professor?.full_name ?? null,
      }),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
});

export async function getLatestNotices(courseIds: string[], limit = 6): Promise<NoticeItem[]> {
  if (courseIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('notices')
    .select('id, course_id, title, body, pinned, created_at, course:courses(id, code, name)')
    .in('course_id', courseIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as NoticeItem[];
}

export async function getUpcomingAssignments(courseIds: string[], limit = 6): Promise<AssignmentItem[]> {
  if (courseIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('assignments')
    .select('id, course_id, title, description, due_at, course:courses(id, code, name)')
    .in('course_id', courseIds)
    .gte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(limit);
  return (data ?? []) as unknown as AssignmentItem[];
}

export async function getBookmarkIds(): Promise<string[]> {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase.from('bookmarks').select('material_id').eq('student_id', user.id).limit(5000);
  return (data ?? []).map((row) => row.material_id as string);
}

export async function getMarkedMaterials(): Promise<MaterialItem[]> {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookmarks')
    .select(
      'created_at, material:materials!inner(id, title, type, week, file_name, size_bytes, mime_type, created_at, ' +
        'assignment_id, course:courses!inner(id, code, name))',
    )
    .eq('student_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((row) => row.material as MaterialItem);
}

/* ------------------------------------------------------------- reference data */

export const getDepartments = cache(async (): Promise<Department[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('departments').select('id, code, name').order('code');
  return (data ?? []) as Department[];
});

export const getSemesters = cache(async (): Promise<Semester[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('semesters')
    .select('id, name, start_date, end_date, is_current')
    .order('start_date', { ascending: false });
  return (data ?? []) as Semester[];
});

export { toCourse, COURSE_SELECT };
