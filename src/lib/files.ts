import { ALLOWED_EXTENSIONS, MAX_FILE_BYTES } from '@/lib/constants';

export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return match ? match[1].toLowerCase() : '';
}

export function stripExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]+$/, '') || name;
}

export type FileCheck = { ok: true; ext: string } | { ok: false; reason: 'type' | 'size' };

/** Shared by the browser (instant feedback) and the server (the check that counts). */
export function validateFile(name: string, size: number): FileCheck {
  const ext = fileExtension(name);
  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) return { ok: false, reason: 'type' };
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, ext };
}

/**
 * Content types a browser would render or run instead of downloading. Upload
 * requests declare their own type, so a renamed page.html -> page.txt could
 * still be stored as text/html; the server rejects those after upload.
 */
const ACTIVE_CONTENT = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/javascript|application\/(x-)?javascript|application\/ecmascript|text\/ecmascript|application\/x-sh|text\/x-sh)(\s*;|\s*$)/i;

export function isActiveContent(mime: string): boolean {
  return ACTIVE_CONTENT.test(mime.trim());
}

/** The stored key (<course>/<uuid>.<ext>) must carry the same extension as the declared file name. */
export function sameExtension(path: string, fileName: string): boolean {
  const ext = fileExtension(fileName);
  return ext !== '' && fileExtension(path) === ext;
}

export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');
