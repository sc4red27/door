'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { COURSES_TAG, courseTag } from '@/lib/data';
import { BUCKET, MATERIAL_TYPES, MAX_FILE_BYTES } from '@/lib/constants';
import { isActiveContent, sameExtension, validateFile } from '@/lib/files';
import { chunk, formObject, isUuid } from '@/lib/utils';
import { getDict } from '@/i18n';
import type { ActionState, UploadErrorCode } from '@/lib/types';

const STAFF = ['professor', 'admin'] as const;

function refreshCourse(courseId: string) {
  revalidateTag(courseTag(courseId));
  revalidatePath(`/teach/courses/${courseId}`);
}

/* ------------------------------------------------------------------ courses */

const courseSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().regex(/^[A-Za-z0-9_-]{2,20}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  department_id: z.string().uuid(),
  semester_id: z.string().uuid(),
  year: z.coerce.number().int().min(1).max(8),
  professor_id: z.string().uuid().optional(),
});

export async function saveCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser([...STAFF]);
  const t = await getDict();
  const parsed = courseSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: t.common.invalid };
  const v = parsed.data;

  const row = {
    code: v.code.toUpperCase(),
    name: v.name,
    description: v.description ?? null,
    department_id: v.department_id,
    semester_id: v.semester_id,
    year: v.year,
    // Professors can only ever own their own courses; admins may assign anyone.
    professor_id: user.role === 'admin' ? (v.professor_id ?? null) : user.id,
  };

  const supabase = await createClient();
  const query = v.id
    ? supabase.from('courses').update(row).eq('id', v.id).select('id').maybeSingle()
    : supabase.from('courses').insert(row).select('id').maybeSingle();
  const { data, error } = await query;

  if (error) return { error: error.code === '23505' ? t.teach.duplicateCode : t.common.failed };
  if (!data) return { error: t.common.forbidden };

  revalidateTag(COURSES_TAG);
  refreshCourse(data.id);
  revalidatePath('/teach');
  if (!v.id) redirect(`/teach/courses/${data.id}`);
  return { ok: t.common.saved };
}

export async function deleteCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser([...STAFF]);
  const t = await getDict();
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) return { error: t.common.invalid };

  const supabase = await createClient();
  const { data: files } = await supabase.from('materials').select('storage_path').eq('course_id', id);
  const { data: deleted, error } = await supabase.from('courses').delete().eq('id', id).select('id');
  if (error || !deleted?.length) return { error: t.common.forbidden };

  // Rows are gone (cascade); now drop the stored files.
  for (const part of chunk((files ?? []).map((f) => f.storage_path as string), 100)) {
    await supabase.storage.from(BUCKET).remove(part);
  }

  revalidateTag(COURSES_TAG);
  revalidateTag(courseTag(id));
  redirect(user.role === 'admin' ? '/admin/courses' : '/teach');
}

/* ---------------------------------------------------------------- materials */

/**
 * Step 1 of an upload: validates the request and returns a one-time signed
 * upload URL. The browser then PUTs the bytes directly to Supabase Storage.
 */
export async function createUploadTicket(input: {
  courseId: string;
  fileName: string;
  size: number;
}): Promise<{ path: string; signedUrl: string } | { error: UploadErrorCode }> {
  const user = await requireUser([...STAFF]);
  if (!isUuid(input.courseId) || typeof input.fileName !== 'string') return { error: 'forbidden' };

  const check = validateFile(input.fileName, Number(input.size));
  if (!check.ok) return { error: check.reason };
  if (!(await rateLimit(`upload:${user.id}`, 300, 600))) return { error: 'rate' };

  // The storage key never contains user input: <course>/<uuid>.<ext>
  const path = `${input.courseId}/${randomUUID()}.${check.ext}`;
  const supabase = await createClient();
  // Storage RLS rejects this unless the caller teaches the course (or is admin).
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: 'forbidden' };
  return { path, signedUrl: data.signedUrl };
}

const pathSchema = z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/);

/** Size and MIME type as stored, not as claimed by the browser. */
async function storedObject(supabase: Awaited<ReturnType<typeof createClient>>, path: string) {
  const [folder, name] = path.split('/');
  const { data } = await supabase.storage.from(BUCKET).list(folder, { search: name, limit: 1 });
  const object = data?.find((o) => o.name === name);
  if (!object) return null;
  const size = Number(object.metadata?.size ?? 0);
  const mime = String(object.metadata?.mimetype ?? 'application/octet-stream');
  return { size, mime };
}

const materialSchema = z.object({
  courseId: z.string().uuid(),
  path: pathSchema,
  title: z.string().trim().min(1).max(200),
  type: z.enum(MATERIAL_TYPES),
  week: z.number().int().min(1).max(30).nullable(),
  fileName: z.string().min(1).max(255),
  assignmentId: z.string().uuid().nullable().optional(),
});

/** Step 2 of an upload: records the file that now sits in storage. */
export async function registerMaterial(
  input: z.input<typeof materialSchema>,
): Promise<{ ok: true } | { error: UploadErrorCode }> {
  const user = await requireUser([...STAFF]);
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return { error: 'failed' };
  const v = parsed.data;
  if (!v.path.startsWith(`${v.courseId}/`)) return { error: 'forbidden' };
  if (!validateFile(v.fileName, 1).ok || !sameExtension(v.path, v.fileName)) return { error: 'type' };

  const supabase = await createClient();
  const object = await storedObject(supabase, v.path);
  if (!object) return { error: 'failed' };
  if (object.size <= 0 || object.size > MAX_FILE_BYTES) {
    await supabase.storage.from(BUCKET).remove([v.path]);
    return { error: 'size' };
  }
  if (isActiveContent(object.mime)) {
    await supabase.storage.from(BUCKET).remove([v.path]);
    return { error: 'type' };
  }

  const { error } = await supabase.from('materials').insert({
    course_id: v.courseId,
    assignment_id: v.assignmentId ?? null,
    title: v.title,
    type: v.type,
    week: v.week,
    storage_path: v.path,
    file_name: v.fileName,
    size_bytes: object.size,
    mime_type: object.mime,
    uploaded_by: user.id,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([v.path]);
    return { error: 'forbidden' };
  }

  refreshCourse(v.courseId);
  return { ok: true };
}

const materialEditSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  type: z.enum(MATERIAL_TYPES),
  week: z.number().int().min(1).max(30).nullable(),
});

export async function updateMaterial(input: z.input<typeof materialEditSchema>): Promise<{ ok: boolean }> {
  await requireUser([...STAFF]);
  const parsed = materialEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const { id, ...changes } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.from('materials').update(changes).eq('id', id).select('course_id').maybeSingle();
  if (error || !data) return { ok: false };
  refreshCourse(data.course_id);
  return { ok: true };
}

const replaceSchema = z.object({ id: z.string().uuid(), path: pathSchema, fileName: z.string().min(1).max(255) });

/** Points an existing material at a freshly uploaded file and removes the old one. */
export async function replaceMaterialFile(input: z.input<typeof replaceSchema>): Promise<{ ok: boolean }> {
  await requireUser([...STAFF]);
  const parsed = replaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: current } = await supabase
    .from('materials')
    .select('course_id, storage_path')
    .eq('id', v.id)
    .maybeSingle();
  const object = current && v.path.startsWith(`${current.course_id}/`) ? await storedObject(supabase, v.path) : null;
  if (
    !current ||
    !object ||
    !validateFile(v.fileName, object.size).ok ||
    !sameExtension(v.path, v.fileName) ||
    isActiveContent(object.mime)
  ) {
    if (current && v.path.startsWith(`${current.course_id}/`)) await supabase.storage.from(BUCKET).remove([v.path]);
    return { ok: false };
  }

  const { data: updated, error } = await supabase
    .from('materials')
    .update({ storage_path: v.path, file_name: v.fileName, size_bytes: object.size, mime_type: object.mime })
    .eq('id', v.id)
    .select('id');
  if (error || !updated?.length) {
    await supabase.storage.from(BUCKET).remove([v.path]);
    return { ok: false };
  }

  await supabase.storage.from(BUCKET).remove([current.storage_path]);
  refreshCourse(current.course_id);
  return { ok: true };
}

export async function deleteMaterial(id: string): Promise<{ ok: boolean }> {
  await requireUser([...STAFF]);
  if (!isUuid(id)) return { ok: false };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('materials')
    .delete()
    .eq('id', id)
    .select('course_id, storage_path')
    .maybeSingle();
  if (error || !data) return { ok: false };

  await supabase.storage.from(BUCKET).remove([data.storage_path]);
  refreshCourse(data.course_id);
  return { ok: true };
}

/* ------------------------------------------------------------------ notices */

const noticeSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional(),
  pinned: z.string().optional(),
});

export async function createNotice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser([...STAFF]);
  const t = await getDict();
  const parsed = noticeSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: t.common.invalid };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from('notices').insert({
    course_id: v.course_id,
    title: v.title,
    body: v.body ?? '',
    pinned: v.pinned === 'on',
    author_id: user.id,
  });
  if (error) return { error: t.common.forbidden };
  refreshCourse(v.course_id);
  return { ok: t.common.saved };
}

export async function deleteNotice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser([...STAFF]);
  const t = await getDict();
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) return { error: t.common.invalid };

  const supabase = await createClient();
  const { data, error } = await supabase.from('notices').delete().eq('id', id).select('course_id').maybeSingle();
  if (error || !data) return { error: t.common.forbidden };
  refreshCourse(data.course_id);
  return null;
}

/* -------------------------------------------------------------- assignments */

const assignmentSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  due_at: z.string().datetime(),
});

export async function createAssignment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser([...STAFF]);
  const t = await getDict();
  const parsed = assignmentSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: t.common.invalid };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from('assignments').insert({
    course_id: v.course_id,
    title: v.title,
    description: v.description ?? null,
    due_at: v.due_at,
    created_by: user.id,
  });
  if (error) return { error: t.common.forbidden };
  refreshCourse(v.course_id);
  return { ok: t.common.saved };
}

export async function deleteAssignment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser([...STAFF]);
  const t = await getDict();
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) return { error: t.common.invalid };

  const supabase = await createClient();
  const { data, error } = await supabase.from('assignments').delete().eq('id', id).select('course_id').maybeSingle();
  if (error || !data) return { error: t.common.forbidden };
  refreshCourse(data.course_id);
  return null;
}
