'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { COURSES_TAG } from '@/lib/data';
import { planTerms, todayInAppZone } from '@/lib/terms';
import { formObject, isUuid } from '@/lib/utils';
import { fmt, getDict } from '@/i18n';
import type { ActionState } from '@/lib/types';

/* -------------------------------------------------------------- departments */

const departmentSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().regex(/^[A-Za-z0-9_-]{2,16}$/),
  name: z.string().min(1).max(120),
});

export async function saveDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(['admin']);
  const t = await getDict();
  const parsed = departmentSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: t.common.invalid };
  const { id, code, name } = parsed.data;
  const row = { code: code.toUpperCase(), name };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from('departments').update(row).eq('id', id)
    : await supabase.from('departments').insert(row);
  if (error) return { error: error.code === '23505' ? t.admin.duplicate : t.common.failed };

  revalidateTag(COURSES_TAG);
  revalidatePath('/admin/departments');
  return { ok: t.common.saved };
}

export async function deleteDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(['admin']);
  const t = await getDict();
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) return { error: t.common.invalid };

  const supabase = await createClient();
  const { error } = await supabase.from('departments').delete().eq('id', id);
  if (error) return { error: error.code === '23503' ? t.admin.deptInUse : t.common.failed };
  revalidatePath('/admin/departments');
  return null;
}

/* ---------------------------------------------------------------- semesters */

const semesterSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(40),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => v.end_date > v.start_date);

export async function saveSemester(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(['admin']);
  const t = await getDict();
  const parsed = semesterSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: t.common.invalid };
  const { id, ...row } = parsed.data;

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from('semesters').update(row).eq('id', id)
    : await supabase.from('semesters').insert(row);
  if (error) return { error: error.code === '23505' ? t.admin.duplicate : t.common.failed };

  revalidateTag(COURSES_TAG);
  revalidatePath('/admin/semesters');
  return { ok: t.common.saved };
}

export async function deleteSemester(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(['admin']);
  const t = await getDict();
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) return { error: t.common.invalid };

  const supabase = await createClient();
  const { error } = await supabase.from('semesters').delete().eq('id', id);
  if (error) return { error: error.code === '23503' ? t.admin.semInUse : t.common.failed };
  revalidatePath('/admin/semesters');
  return null;
}

export async function setCurrentSemester(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(['admin']);
  const t = await getDict();
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) return { error: t.common.invalid };

  // The function re-checks is_admin() inside the database.
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_current_semester', { p_semester: id });
  if (error) return { error: t.common.failed };

  revalidateTag(COURSES_TAG); // cached course headers carry the "current" flag
  revalidatePath('/admin', 'layout');
  return { ok: t.common.saved };
}

const promoteSchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid(),
  increment_year: z.string().optional(),
  max_year: z.coerce.number().int().min(1).max(8).default(8),
});

export async function promoteStudents(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(['admin']);
  const t = await getDict();
  const parsed = promoteSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: t.common.invalid };
  const v = parsed.data;
  if (v.from === v.to) return { error: t.admin.sameSemester };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('promote_students', {
    p_from: v.from,
    p_to: v.to,
    p_increment_year: v.increment_year === 'on',
    p_max_year: v.max_year,
  });
  if (error) return { error: t.common.failed };

  revalidatePath('/admin', 'layout');
  return { ok: fmt(t.admin.promoted, { n: Number(data ?? 0) }) };
}

/* -------------------------------------------------------------------- users */

/**
 * Sets a new temporary password and forces a change at next sign-in.
 * Students go back to their student ID; staff get a random one.
 */
export async function resetPassword(userId: string): Promise<{ password: string; isId: boolean } | { error: string }> {
  await requireUser(['admin']);
  const t = await getDict();
  if (!isUuid(userId)) return { error: t.common.invalid };

  const admin = createAdminClient();
  const { data: profile } = await admin.from('profiles').select('role, login_id').eq('id', userId).maybeSingle();
  if (!profile) return { error: t.common.invalid };

  const isId = profile.role === 'student';
  const password = isId ? (profile.login_id as string) : randomBytes(9).toString('base64url');
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password,
    app_metadata: { role: profile.role, must_change_password: true },
  });
  if (error) return { error: isId && /password/i.test(error.message) ? t.errors.idTooShort : t.common.failed };
  await admin.from('profiles').update({ must_change_password: true }).eq('id', userId);

  revalidatePath('/admin/users');
  return { password, isId };
}

const enrollSchema = z.object({
  student_id: z.string().min(1).max(40),
  course_code: z.string().min(1).max(20),
  semester_id: z.string().uuid(),
  intent: z.enum(['add', 'remove']),
});

/** Manual exception: add or remove one course for one student (electives etc.). */
export async function manualEnrollment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(['admin']);
  const t = await getDict();
  const parsed = enrollSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: t.common.invalid };
  const v = parsed.data;

  const supabase = await createClient();
  const [{ data: student }, { data: course }] = await Promise.all([
    supabase.from('profiles').select('id').eq('login_id', v.student_id).eq('role', 'student').maybeSingle(),
    supabase
      .from('courses')
      .select('id')
      .eq('code', v.course_code.toUpperCase())
      .eq('semester_id', v.semester_id)
      .maybeSingle(),
  ]);
  if (!student) return { error: fmt(t.errors.unknownStudent, { v: v.student_id }) };
  if (!course) return { error: fmt(t.errors.unknownCourse, { v: v.course_code }) };

  if (v.intent === 'add') {
    const { error } = await supabase
      .from('enrollments')
      .upsert(
        { student_id: student.id, course_id: course.id, source: 'manual' },
        { onConflict: 'student_id,course_id', ignoreDuplicates: true },
      );
    return error ? { error: t.common.failed } : { ok: t.admin.enrolledOk };
  }

  const { error } = await supabase
    .from('enrollments')
    .delete()
    .eq('student_id', student.id)
    .eq('course_id', course.id);
  return error ? { error: t.common.failed } : { ok: t.admin.unenrolledOk };
}

/**
 * Permanently deletes an account. Profile, enrollments and bookmarks go with
 * it (ON DELETE CASCADE); courses a professor taught stay, unassigned.
 * Admins cannot delete themselves or the last remaining admin.
 */
export async function deleteUser(userId: string): Promise<{ ok: true } | { error: string }> {
  const me = await requireUser(['admin']);
  const t = await getDict();
  if (!isUuid(userId)) return { error: t.common.invalid };
  if (userId === me.id) return { error: t.admin.cannotDeleteSelf };

  const admin = createAdminClient();
  const { data: target } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (!target) return { error: t.common.invalid };
  if (target.role === 'admin') {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
    if ((count ?? 0) <= 1) return { error: t.admin.cannotDeleteLastAdmin };
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: t.common.failed };

  revalidatePath('/admin', 'layout');
  return { ok: true };
}

/**
 * Creates every term from the given first term up to the term running today
 * (spring "<year>-1" / fall "<year>-2", 6 months apart). Existing terms are
 * kept as they are; optionally the latest one becomes the current term.
 */
export async function generateTerms(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser(['admin']);
  const t = await getDict();
  const first = {
    name: String(formData.get('name') ?? '').trim(),
    start_date: String(formData.get('start_date') ?? ''),
    end_date: String(formData.get('end_date') ?? ''),
  };
  const plan = planTerms(first, todayInAppZone());
  if ('error' in plan) return { error: t.admin.termPlanErrors[plan.error] };

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase.from('semesters').select('name');
  if (readError) return { error: t.common.failed };
  const taken = new Set((existing ?? []).map((s) => s.name as string));
  const missing = plan.terms.filter((term) => !taken.has(term.name));

  if (missing.length > 0) {
    const { error } = await supabase.from('semesters').insert(missing);
    if (error) return { error: error.code === '23505' ? t.admin.duplicate : t.common.failed };
  }

  const latest = plan.terms[plan.terms.length - 1];
  if (formData.get('set_current') === 'on') {
    const { data: row } = await supabase.from('semesters').select('id').eq('name', latest.name).single();
    const { error } = row ? await supabase.rpc('set_current_semester', { p_semester: row.id }) : { error: true };
    if (error) return { error: t.common.failed };
  }

  revalidateTag(COURSES_TAG);
  revalidatePath('/admin', 'layout');
  return {
    ok: fmt(t.admin.termsGenerated, {
      created: missing.length,
      kept: plan.terms.length - missing.length,
      latest: latest.name,
    }),
  };
}
