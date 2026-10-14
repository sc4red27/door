import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BUCKET, SIGNED_URL_TTL } from '@/lib/constants';
import { isUuid } from '@/lib/utils';

/**
 * Single-file download: look the material up through RLS, then redirect to a
 * 60-second signed URL. The bytes go from Supabase Storage / CDN straight to
 * the browser and never touch this server.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Not enrolled -> RLS returns no row -> 404 (same answer as "does not exist").
  const { data: material } = await supabase
    .from('materials')
    .select('storage_path, file_name')
    .eq('id', id)
    .maybeSingle();
  if (!material) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // No `download` option here: storage-js encodes the name twice (URLSearchParams,
  // then encodeURI), so "Chapter+1.pdf" would arrive as "Chapter%2B1.pdf".
  // Append it ourselves, encoded exactly once.
  const { data: signed, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(material.storage_path, SIGNED_URL_TTL);
  if (error || !signed) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const url = `${signed.signedUrl}&download=${encodeURIComponent(material.file_name)}`;
  const response = NextResponse.redirect(url, 302);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
