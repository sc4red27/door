'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { COURSES_TAG } from '@/lib/data';
import { requireUser } from '@/lib/auth';
import { PASSWORD_MIN_LENGTH, STUDENT_EMAIL_DOMAIN } from '@/lib/constants';
import { mapLimit } from '@/lib/utils';
import { fmt, getDict } from '@/i18n';
import type { ImportRowResult, Role } from '@/lib/types';

/* -------------------------------------------------------------------------- *
 * CSV import. The browser parses the file and sends it in chunks of rows, so
 * each call stays far below serverless time limits and the UI shows progress.
 * Everything here runs with the service role *after* the admin check.
 * -------------------------------------------------------------------------- */

const MAX_ROWS_PER_CALL = 50;
type Row = Record<string, string>;
type Rows = Row[];

const tempPassword = () => randomBytes(9).toString('base64url');

function checkInput(rows: unknown, password: string | null): rows is Rows {
  return (
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows.length <= MAX_ROWS_PER_CALL &&
    rows.every((r) => r && typeof r === 'object') &&
    (password === null || (typeof password === 'string' && password.length <= 200))
  );
}

async function lookups(admin: SupabaseClient) {
  const [{ data: departments }, { data: semesters }] = await Promise.all([
    admin.from('departments').select('id, code'),
    admin.from('semesters').select('id, name, is_current'),
  ]);
  return {
    departments: new Map((departments ?? []).map((d) => [String(d.code).toUpperCase(), d.id as string])),
    semesters: new Map((semesters ?? []).map((s) => [String(s.name), s.id as string])),
    currentSemester: (semesters ?? []).find((s) => s.is_current)?.id as string | undefined,
  };
}

async function createAccount(
  admin: SupabaseClient,
  input: { email: string; password: string; role: Role; profile: Record<string, unknown> },
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: { role: input.role, must_change_password: true },
    user_metadata: { full_name: input.profile.full_name },
  });
  if (error || !data.user) return { error: error?.message ?? 'unknown error' };

  const { error: profileError } = await admin.from('profiles').insert({
    id: data.user.id,
    role: input.role,
    email: input.email,
    must_change_password: true,
    ...input.profile,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id); // no orphaned auth users
    return { error: profileError.message };
  }
  return { id: data.user.id };
}

/* ----------------------------------------------------------------- students */

const studentRow = z.object({
  student_id: z.string().regex(/^[A-Za-z0-9_-]{3,32}$/),
  name: z.string().min(1).max(120),
  department_code: z.string().min(1),
  semester: z.coerce.number().int().min(1).max(8), // level: 1st-8th semester
  term: z.string().optional(),
});

/** students: student_id, name, department_code, semester (1-8) [, term] */
export async function importStudents(rows: Rows, password: string | null, offset: number): Promise<ImportRowResult[]> {
  await requireUser(['admin']);
  const t = await getDict();
  if (!checkInput(rows, password)) return [];
  if (password !== null && password.length < PASSWORD_MIN_LENGTH) {
    return rows.map((r, i) => ({
      row: offset + i + 1,
      id: String(r.student_id ?? ''),
      status: 'error' as const,
      message: fmt(t.errors.weakPassword, { n: PASSWORD_MIN_LENGTH }),
    }));
  }

  const admin = createAdminClient();
  const maps = await lookups(admin);
  const ids = rows.map((r) => String(r.student_id ?? '')).filter(Boolean);
  const { data: existingRows } = await admin.from('profiles').select('id, login_id, role').in('login_id', ids);
  const existing = new Map((existingRows ?? []).map((p) => [p.login_id as string, p]));

  return mapLimit(rows, 5, async (raw, i): Promise<ImportRowResult> => {
    const base = { row: offset + i + 1, id: String(raw.student_id ?? '') };
    const fail = (message: string): ImportRowResult => ({ ...base, status: 'error', message });

    const parsed = studentRow.safeParse(raw);
    if (!parsed.success) {
      const levelIssue = parsed.error.issues.some((issue) => issue.path[0] === 'semester');
      return fail(levelIssue ? t.errors.invalidYear : t.errors.invalidRow);
    }
    const v = parsed.data;
    const departmentId = maps.departments.get(v.department_code.toUpperCase());
    if (!departmentId) return fail(fmt(t.errors.unknownDepartment, { v: v.department_code }));
    const semesterId = v.term ? maps.semesters.get(v.term) : maps.currentSemester;
    if (!semesterId) return fail(fmt(t.errors.unknownSemester, { v: v.term ?? '-' }));

    // The `year` column holds the semester level (1-8).
    const profile = { full_name: v.name, department_id: departmentId, year: v.semester, semester_id: semesterId };
    const found = existing.get(v.student_id);
    let studentId: string;
    let issued: string | undefined;

    if (found) {
      if (found.role !== 'student') return fail(t.errors.idInUse);
      const { error } = await admin.from('profiles').update(profile).eq('id', found.id);
      if (error) return fail(error.message);
      studentId = found.id as string;
    } else {
      issued = password ?? tempPassword();
      const created = await createAccount(admin, {
        email: `${v.student_id.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`,
        password: issued,
        role: 'student',
        profile: { ...profile, login_id: v.student_id },
      });
      if ('error' in created) return fail(fmt(t.errors.createFailed, { v: created.error }));
      studentId = created.id;
    }

    // Auto-enroll: every course matching department + semester level + term.
    const { data: count, error } = await admin.rpc('auto_enroll_student', { p_student: studentId });
    if (error) return fail(error.message);

    return {
      ...base,
      status: found ? 'updated' : 'created',
      message: fmt(t.admin.autoEnrolled, { n: Number(count ?? 0) }),
      // Only echo passwords that were generated here; the admin already knows a shared one.
      password: issued && password === null ? issued : undefined,
    };
  });
}

/* --------------------------------------------------------------- professors */

const professorRow = z.object({
  professor_id: z.string().regex(/^[A-Za-z0-9_-]{2,32}$/),
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  department_code: z.string().min(1),
});

/** professors: professor_id, name, email, department_code */
export async function importProfessors(rows: Rows, password: string | null, offset: number): Promise<ImportRowResult[]> {
  await requireUser(['admin']);
  const t = await getDict();
  if (!checkInput(rows, password)) return [];
  if (password !== null && password.length < PASSWORD_MIN_LENGTH) {
    return rows.map((r, i) => ({
      row: offset + i + 1,
      id: String(r.professor_id ?? ''),
      status: 'error' as const,
      message: fmt(t.errors.weakPassword, { n: PASSWORD_MIN_LENGTH }),
    }));
  }

  const admin = createAdminClient();
  const maps = await lookups(admin);
  const ids = rows.map((r) => String(r.professor_id ?? '')).filter(Boolean);
  const { data: existingRows } = await admin.from('profiles').select('id, login_id, role').in('login_id', ids);
  const existing = new Map((existingRows ?? []).map((p) => [p.login_id as string, p]));

  return mapLimit(rows, 5, async (raw, i): Promise<ImportRowResult> => {
    const base = { row: offset + i + 1, id: String(raw.professor_id ?? '') };
    const fail = (message: string): ImportRowResult => ({ ...base, status: 'error', message });

    const parsed = professorRow.safeParse(raw);
    if (!parsed.success) {
      const emailIssue = parsed.error.issues.some((issue) => issue.path[0] === 'email');
      return fail(emailIssue ? t.errors.invalidEmail : t.errors.invalidRow);
    }
    const v = parsed.data;
    const departmentId = maps.departments.get(v.department_code.toUpperCase());
    if (!departmentId) return fail(fmt(t.errors.unknownDepartment, { v: v.department_code }));

    const found = existing.get(v.professor_id);
    if (found) {
      if (found.role !== 'professor') return fail(t.errors.idInUse);
      const { error } = await admin
        .from('profiles')
        .update({ full_name: v.name, department_id: departmentId })
        .eq('id', found.id);
      return error ? fail(error.message) : { ...base, status: 'updated' };
    }

    const issued = password ?? tempPassword();
    const created = await createAccount(admin, {
      email: v.email.toLowerCase(),
      password: issued,
      role: 'professor',
      profile: { full_name: v.name, department_id: departmentId, login_id: v.professor_id },
    });
    if ('error' in created) return fail(fmt(t.errors.createFailed, { v: created.error }));
    return { ...base, status: 'created', password: password === null ? issued : undefined };
  });
}

/* -------------------------------------------------------------- enrollments */

const enrollmentRow = z.object({
  student_id: z.string().min(1).max(32),
  course_code: z.string().min(1).max(20),
  term: z.string().optional(),
});

/** extra enrollments: student_id, course_code [, term] */
export async function importEnrollments(rows: Rows, _password: string | null, offset: number): Promise<ImportRowResult[]> {
  await requireUser(['admin']);
  const t = await getDict();
  if (!checkInput(rows, null)) return [];

  const admin = createAdminClient();
  const maps = await lookups(admin);
  const studentIds = [...new Set(rows.map((r) => String(r.student_id ?? '')).filter(Boolean))];
  const codes = [...new Set(rows.map((r) => String(r.course_code ?? '').toUpperCase()).filter(Boolean))];
  const [{ data: students }, { data: courses }] = await Promise.all([
    admin.from('profiles').select('id, login_id').eq('role', 'student').in('login_id', studentIds),
    admin.from('courses').select('id, code, semester_id').in('code', codes),
  ]);
  const studentMap = new Map((students ?? []).map((s) => [s.login_id as string, s.id as string]));
  const courseMap = new Map((courses ?? []).map((c) => [`${c.semester_id}:${c.code}`, c.id as string]));

  const results: ImportRowResult[] = [];
  const inserts: { student_id: string; course_id: string; source: string }[] = [];

  rows.forEach((raw, i) => {
    const base = { row: offset + i + 1, id: `${raw.student_id ?? ''} / ${raw.course_code ?? ''}` };
    const fail = (message: string) => results.push({ ...base, status: 'error', message });

    const parsed = enrollmentRow.safeParse(raw);
    if (!parsed.success) return fail(t.errors.invalidRow);
    const v = parsed.data;

    const semesterId = v.term ? maps.semesters.get(v.term) : maps.currentSemester;
    if (!semesterId) return fail(fmt(t.errors.unknownSemester, { v: v.term ?? '-' }));
    const studentId = studentMap.get(v.student_id);
    if (!studentId) return fail(fmt(t.errors.unknownStudent, { v: v.student_id }));
    const courseId = courseMap.get(`${semesterId}:${v.course_code.toUpperCase()}`);
    if (!courseId) return fail(fmt(t.errors.unknownCourse, { v: v.course_code }));

    inserts.push({ student_id: studentId, course_id: courseId, source: 'csv' });
    results.push({ ...base, status: 'enrolled' });
  });

  if (inserts.length > 0) {
    // De-duplicate inside the batch: one statement cannot touch the same key twice.
    const unique = [...new Map(inserts.map((e) => [`${e.student_id}:${e.course_id}`, e])).values()];
    const { error } = await admin
      .from('enrollments')
      .upsert(unique, { onConflict: 'student_id,course_id', ignoreDuplicates: true });
    if (error) {
      return results.map((r) => (r.status === 'enrolled' ? { ...r, status: 'error' as const, message: error.message } : r));
    }
  }
  return results;
}

/* ------------------------------------------------------------------ courses */

const courseRow = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,20}$/),
  name: z.string().trim().min(1).max(120),
  department_code: z.string().trim().min(1),
  semester: z.coerce.number().int().min(1).max(8), // level: 1st-8th semester
  description: z.string().max(2000).optional(),
  term: z.string().trim().optional(),
  professor_id: z.string().trim().optional(),
});

/**
 * courses: code, name, department_code, semester (1-8) [, description, term, professor_id]
 * Professors always become the owner; only admins may name another professor.
 * Inserts go through the caller's own client, so RLS still decides what is allowed,
 * and the auto-enroll trigger adds every matching student.
 */
export async function importCourses(rows: Rows, _password: string | null, offset: number): Promise<ImportRowResult[]> {
  const user = await requireUser(['professor', 'admin']);
  const t = await getDict();
  if (!checkInput(rows, null)) return [];

  const admin = createAdminClient();
  const maps = await lookups(admin);
  const professorIds = [...new Set(rows.map((r) => String(r.professor_id ?? '').trim()).filter(Boolean))];
  const { data: professors } =
    user.role === 'admin' && professorIds.length > 0
      ? await admin.from('profiles').select('id, login_id').eq('role', 'professor').in('login_id', professorIds)
      : { data: [] };
  const professorMap = new Map((professors ?? []).map((p) => [p.login_id as string, p.id as string]));

  const supabase = await createClient();
  const results = await mapLimit(rows, 5, async (raw, i): Promise<ImportRowResult> => {
    const base = { row: offset + i + 1, id: String(raw.code ?? '') };
    const fail = (message: string): ImportRowResult => ({ ...base, status: 'error', message });

    const parsed = courseRow.safeParse(raw);
    if (!parsed.success) {
      const levelIssue = parsed.error.issues.some((issue) => issue.path[0] === 'semester');
      return fail(levelIssue ? t.errors.invalidYear : t.errors.invalidRow);
    }
    const v = parsed.data;
    const departmentId = maps.departments.get(v.department_code.toUpperCase());
    if (!departmentId) return fail(fmt(t.errors.unknownDepartment, { v: v.department_code }));
    const semesterId = v.term ? maps.semesters.get(v.term) : maps.currentSemester;
    if (!semesterId) return fail(fmt(t.errors.unknownSemester, { v: v.term ?? '-' }));

    let professorId: string | null = user.id;
    if (user.role === 'admin') {
      professorId = v.professor_id ? (professorMap.get(v.professor_id) ?? null) : null;
      if (v.professor_id && !professorId) return fail(fmt(t.errors.unknownProfessor, { v: v.professor_id }));
    }

    const { data, error } = await supabase
      .from('courses')
      .insert({
        code: v.code.toUpperCase(),
        name: v.name,
        description: v.description?.trim() || null,
        department_id: departmentId,
        semester_id: semesterId,
        year: v.semester, // the `year` column holds the semester level (1-8)
        professor_id: professorId,
      })
      .select('id')
      .maybeSingle();
    if (error) return fail(error.code === '23505' ? t.teach.duplicateCode : t.common.forbidden);
    if (!data) return fail(t.common.forbidden);

    const { count } = await admin.from('enrollments').select('student_id', { count: 'exact', head: true }).eq('course_id', data.id);
    return { ...base, status: 'created', message: fmt(t.teach.studentsShort, { n: count ?? 0 }) };
  });

  revalidateTag(COURSES_TAG);
  revalidatePath('/teach');
  revalidatePath('/admin/courses');
  return results;
}
