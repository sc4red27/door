import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSameOrigin, rateLimit } from '@/lib/rate-limit';
import { resolveZip, zipSelectorSchema } from '@/lib/zip-server';
import { isIsoDate } from '@/lib/zip-paths';
import { BUCKET } from '@/lib/constants';
import { chunk } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Fallback for very large sets on browsers that cannot stream to disk.
 * The archive is produced as a stream (store-only, no compression) and piped
 * to the response as it is built: memory stays flat and the browser's own
 * download starts with the first byte.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  let payload: unknown = null;
  try {
    payload = JSON.parse(String(form?.get('payload') ?? ''));
  } catch {
    payload = null;
  }
  const parsed = zipSelectorSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  if (!(await rateLimit(`zip:${userId}`, 10, 60))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  const zip = await resolveZip(supabase, userId, parsed.data);
  if (zip.entries.length === 0) return NextResponse.json({ error: 'empty' }, { status: 404 });

  // Sign everything up front (these URLs never leave the server), so the
  // generator below does not need the request context once streaming started.
  const signedByPath = new Map<string, string>();
  for (const part of chunk([...zip.storagePaths.values()], 100)) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(part, 3600);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
  }

  const entries = zip.entries;
  const storagePaths = zip.storagePaths;

  async function* files() {
    const missing: string[] = [];
    for (const entry of entries) {
      const url = signedByPath.get(storagePaths.get(entry.id) ?? '');
      const res = url ? await fetch(url).catch(() => null) : null;
      if (!res || !res.ok || !res.body) {
        missing.push(entry.path);
        continue;
      }
      yield { name: entry.path, lastModified: new Date(entry.modified), input: res };
    }
    if (missing.length > 0) {
      yield { name: '_missing-files.txt', lastModified: new Date(), input: missing.join('\n') + '\n' };
    }
  }

  const { downloadZip } = await import('client-zip');
  const archive = downloadZip(files());

  const rawDate = form?.get('date');
  const date = isIsoDate(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
  const fileName = `${zip.baseName}_${date}.zip`;

  return new Response(archive.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="materials_${date}.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
