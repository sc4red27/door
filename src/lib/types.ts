import type { MATERIAL_TYPES } from '@/lib/constants';

export type Role = 'admin' | 'professor' | 'student';
export type MaterialType = (typeof MATERIAL_TYPES)[number];

/** Result of a form server action, rendered by <ActionForm>. */
export type ActionState = { error?: string; ok?: string } | null;

export type CourseRef = { id: string; code: string; name: string };

export type CourseSummary = CourseRef & {
  year: number;
  semester: { id: string; name: string; is_current: boolean; start_date: string };
  department: { code: string; name: string } | null;
  professor: string | null;
};

export type CourseDetail = CourseSummary & {
  description: string | null;
  professor_id: string | null;
  department_id: string;
};

export type MaterialItem = {
  id: string;
  title: string;
  type: MaterialType;
  week: number | null;
  file_name: string;
  size_bytes: number;
  mime_type: string;
  created_at: string;
  assignment_id: string | null;
  course: CourseRef;
};

export type NoticeItem = {
  id: string;
  course_id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
  course?: CourseRef;
};

export type AssignmentItem = {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  due_at: string;
  course?: CourseRef;
};

export type Department = { id: string; code: string; name: string };
export type Semester = { id: string; name: string; start_date: string; end_date: string; is_current: boolean };

export type ImportKind = 'students' | 'professors' | 'enrollments' | 'courses';
export type ImportRowResult = {
  row: number;
  id: string;
  status: 'created' | 'updated' | 'enrolled' | 'error';
  message?: string;
  password?: string;
};

export type UploadErrorCode = 'type' | 'size' | 'forbidden' | 'rate' | 'failed';
