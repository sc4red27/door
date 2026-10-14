import { createUploadTicket } from '@/actions/teach';
import type { UploadErrorCode } from '@/lib/types';

export class UploadError extends Error {
  constructor(public code: UploadErrorCode) {
    super(code);
    this.name = 'UploadError';
  }
}

/**
 * Uploads one file straight from the browser to Supabase Storage.
 * The server only issues a signed upload URL (after checking the course,
 * the extension and the size); file bytes never pass through the app server.
 * XMLHttpRequest is used because fetch() cannot report upload progress.
 */
export async function uploadFile(
  courseId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ path: string }> {
  const ticket = await createUploadTicket({ courseId, fileName: file.name, size: file.size });
  if ('error' in ticket) throw new UploadError(ticket.error);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.signedUrl);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError('failed')));
    xhr.onerror = () => reject(new UploadError('failed'));
    xhr.onabort = () => reject(new UploadError('failed'));

    // Same wire format as supabase-js `uploadToSignedUrl`.
    const body = new FormData();
    body.append('cacheControl', '31536000');
    body.append('', file);
    xhr.send(body);
  });

  onProgress(1);
  return { path: ticket.path };
}
