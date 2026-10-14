import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isSameOrigin, rateLimit } from '@/lib/rate-limit';
import { BUCKET, ZIP_SIGNED_URL_TTL } from '@/lib/constants';

const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) });

/** Step 2 of a browser-side ZIP: short-lived signed URLs for one small batch of files. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  if (!(await rateLimit(`zip-sign:${userId}`, 300, 60))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  // RLS decides which of the requested ids exist for this user.
  const { data: rows } = await supabase.from('materials').select('id, storage_path').in('id', parsed.data.ids);
  const urls: Record<string, string> = {};
  if (rows && rows.length > 0) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(rows.map((r) => r.storage_path as string), ZIP_SIGNED_URL_TTL);
    const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    for (const row of rows) {
      const url = byPath.get(row.storage_path as string);
      if (url) urls[row.id as string] = url;
    }
  }

  return NextResponse.json({ urls }, { headers: { 'Cache-Control': 'private, no-store' } });
}
