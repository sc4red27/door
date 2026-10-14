import type { ZipManifest, ZipSelector } from '@/lib/zip-paths';

/* -------------------------------------------------------------------------- *
 * Browser-side streaming ZIP.
 *
 *   manifest  -> POST /api/zip/manifest   (RLS-filtered list of paths + sizes)
 *   sign      -> POST /api/zip/sign       (short-lived URLs, 20 files at a time,
 *                                          requested just before they are needed)
 *   bytes     -> fetched straight from Supabase Storage / CDN
 *   archive   -> client-zip (no compression, constant memory) piped to disk
 *
 * Where the File System Access API exists (Chromium) the archive is written
 * to disk while it is produced. Elsewhere it is collected into a Blob; if the
 * set is too big for that, we hand over to the server streaming route.
 * -------------------------------------------------------------------------- */

export type ZipProgress = { loaded: number; total: number; filesDone: number; filesTotal: number };
export type ZipResult = 'done' | 'server' | 'cancelled';
export type ZipErrorCode = 'rate' | 'empty' | 'failed';

export class ZipError extends Error {
  constructor(public code: ZipErrorCode) {
    super(code);
    this.name = 'ZipError';
  }
}

const SIGN_BATCH = 20;
const LOOKAHEAD = 3;
const BLOB_FALLBACK_LIMIT = 300 * 1024 * 1024;

export function localDateStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 429) throw new ZipError('rate');
  if (!res.ok) throw new ZipError('failed');
  return (await res.json()) as T;
}

/** Native browser download of a ZIP assembled by the server (fallback for very large sets). */
function submitServerZip(selector: ZipSelector, date: string) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/zip/stream';
  form.style.display = 'none';
  for (const [name, value] of [['payload', JSON.stringify(selector)], ['date', date]] as const) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

type SaveHandle = { createWritable: () => Promise<WritableStream<Uint8Array>> };

export async function downloadAsZip(options: {
  selector: ZipSelector;
  baseName: string;
  signal: AbortSignal;
  onProgress: (progress: ZipProgress) => void;
}): Promise<ZipResult> {
  const { selector, baseName, signal, onProgress } = options;
  const date = localDateStamp();
  const fileName = `${baseName}_${date}.zip`;

  // Must run first: the save dialog needs the click's user activation.
  let handle: SaveHandle | null = null;
  const host = window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<SaveHandle> };
  if (typeof host.showSaveFilePicker === 'function') {
    try {
      // Called as a method of window on purpose: a detached reference throws "Illegal invocation".
      handle = await host.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled';
      handle = null; // e.g. blocked in an iframe: fall through to the Blob path
    }
  }

  const manifest = await postJson<ZipManifest>('/api/zip/manifest', selector, signal);
  const entries = manifest.entries;
  if (entries.length === 0) throw new ZipError('empty');

  if (!handle && manifest.totalBytes > BLOB_FALLBACK_LIMIT) {
    submitServerZip(selector, date);
    return 'server';
  }

  const progress: ZipProgress = { loaded: 0, total: manifest.totalBytes, filesDone: 0, filesTotal: entries.length };
  onProgress({ ...progress });

  // Signed URLs are requested per batch, right before the batch is needed.
  const batches = new Map<number, Promise<Record<string, string>>>();
  const sign = (ids: string[]) =>
    postJson<{ urls: Record<string, string> }>('/api/zip/sign', { ids }, signal).then((r) => r.urls);
  const urlFor = async (index: number) => {
    const batch = Math.floor(index / SIGN_BATCH);
    if (!batches.has(batch)) {
      const ids = entries.slice(batch * SIGN_BATCH, (batch + 1) * SIGN_BATCH).map((e) => e.id);
      batches.set(batch, sign(ids));
    }
    return (await batches.get(batch)!)[entries[index].id];
  };

  const open = async (index: number): Promise<Response> => {
    let url: string | undefined = await urlFor(index);
    let res = url ? await fetch(url, { signal }) : null;
    if (!res || !res.ok) {
      // URL expired while earlier (large) files were downloading: sign again once.
      url = (await sign([entries[index].id]))[entries[index].id];
      res = url ? await fetch(url, { signal }) : null;
    }
    if (!res || !res.ok || !res.body) throw new ZipError('failed');
    return res;
  };

  // Keep a few requests in flight so many small files do not download one by one.
  const inflight = new Map<number, Promise<Response>>();
  const ensure = (index: number) => {
    if (index < entries.length && !inflight.has(index)) {
      const pending = open(index);
      pending.catch(() => undefined);
      inflight.set(index, pending);
    }
  };

  async function* files() {
    for (let i = 0; i < entries.length; i++) {
      for (let k = 0; k < LOOKAHEAD; k++) ensure(i + k);
      const res = await inflight.get(i)!;
      inflight.delete(i);
      const counted = res.body!.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(part, controller) {
            progress.loaded += part.byteLength;
            onProgress({ ...progress });
            controller.enqueue(part);
          },
          flush() {
            progress.filesDone += 1;
            onProgress({ ...progress });
          },
        }),
      );
      yield { name: entries[i].path, lastModified: new Date(entries[i].modified), input: counted };
    }
  }

  // Loaded on demand: the library never ships with the page.
  const { downloadZip } = await import('client-zip');
  const archive = downloadZip(files());

  if (handle) {
    const writable = await handle.createWritable();
    await archive.body!.pipeTo(writable, { signal });
  } else {
    const blob = await archive.blob();
    if (signal.aborted) return 'cancelled';
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
  return 'done';
}
