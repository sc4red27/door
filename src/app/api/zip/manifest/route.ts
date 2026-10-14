import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSameOrigin, rateLimit } from '@/lib/rate-limit';
import { resolveZip, zipSelectorSchema } from '@/lib/zip-server';
import type { ZipManifest } from '@/lib/zip-paths';

/** Step 1 of a browser-side ZIP: which files, under which archive paths. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = zipSelectorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  // 10 ZIP jobs per user per minute (shared with the server streaming route).
  if (!(await rateLimit(`zip:${userId}`, 10, 60))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  const zip = await resolveZip(supabase, userId, parsed.data);
  const manifest: ZipManifest = { baseName: zip.baseName, totalBytes: zip.totalBytes, entries: zip.entries };
  return NextResponse.json(manifest, { headers: { 'Cache-Control': 'private, no-store' } });
}
