import 'server-only';
import { z } from 'zod';
import type { createClient } from '@/lib/supabase/server';
import { MAX_ZIP_FILES } from '@/lib/constants';

type UserClient = Awaited<ReturnType<typeof createClient>>;
import { chunk } from '@/lib/utils';
import { buildZipEntries, zipBaseName, type ZipEntry, type ZipSelector, type ZipSource } from '@/lib/zip-paths';

export const zipSelectorSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('ids'), ids: z.array(z.string().uuid()).min(1).max(MAX_ZIP_FILES) }),
  z.object({ scope: z.literal('course'), courseId: z.string().uuid() }),
  z.object({ scope: z.literal('marked') }),
]);

const SELECT =
  'id, file_name, size_bytes, week, type, created_at, storage_path, course:courses!inner(id, code, name)';

type Row = ZipSource & { storage_path: string };

export type ResolvedZip = {
  baseName: string;
  totalBytes: number;
  entries: ZipEntry[];
  /** material id -> storage key. Never sent to the browser. */
  storagePaths: Map<string, string>;
};

/**
 * Turns a selector into the list of files the *current user* may download.
 * `supabase` must be the user's client: RLS silently drops anything they
 * cannot read, so forged ids simply do not appear in the result.
 */
export async function resolveZip(supabase: UserClient, userId: string, selector: ZipSelector): Promise<ResolvedZip> {
  let rows: Row[] = [];

  if (selector.scope === 'ids') {
    const unique = [...new Set(selector.ids)];
    for (const part of chunk(unique, 100)) {
      const { data, error } = await supabase.from('materials').select(SELECT).in('id', part);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as Row[]));
    }
  } else if (selector.scope === 'course') {
    const { data, error } = await supabase
      .from('materials')
      .select(SELECT)
      .eq('course_id', selector.courseId)
      .limit(MAX_ZIP_FILES);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as unknown as Row[];
  } else {
    const { data, error } = await supabase
      .from('bookmarks')
      .select(`material:materials!inner(${SELECT})`)
      .eq('student_id', userId)
      .limit(MAX_ZIP_FILES);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows = ((data ?? []) as any[]).map((r) => r.material as Row);
  }

  return {
    baseName: zipBaseName(rows.map((r) => r.course), selector.scope),
    totalBytes: rows.reduce((sum, r) => sum + Number(r.size_bytes), 0),
    entries: buildZipEntries(rows),
    storagePaths: new Map(rows.map((r) => [r.id, r.storage_path])),
  };
}
