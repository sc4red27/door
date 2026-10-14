'use server';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { isUuid } from '@/lib/utils';

/** Star / unstar a material. RLS only accepts materials of courses the user can read. */
export async function toggleBookmark(materialId: string, marked: boolean): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!isUuid(materialId)) return { ok: false };
  const supabase = await createClient();

  if (marked) {
    const { error } = await supabase
      .from('bookmarks')
      .upsert(
        { student_id: user.id, material_id: materialId },
        { onConflict: 'student_id,material_id', ignoreDuplicates: true },
      );
    return { ok: !error };
  }

  const { error } = await supabase
    .from('bookmarks')
    .delete()
    .eq('student_id', user.id)
    .eq('material_id', materialId);
  return { ok: !error };
}
