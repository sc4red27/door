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

export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');
