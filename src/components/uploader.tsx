'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Upload, X } from 'lucide-react';
import { registerMaterial } from '@/actions/teach';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';
import { Progress } from '@/components/ui/misc';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/i18n/shared';
import { MATERIAL_TYPES } from '@/lib/constants';
import { ACCEPT_ATTRIBUTE, stripExtension, validateFile } from '@/lib/files';
import { formatBytes } from '@/lib/format';
import type { MaterialType, UploadErrorCode } from '@/lib/types';
import { UploadError, uploadFile } from '@/lib/upload-client';
import { cn } from '@/lib/utils';

type QueueItem = {
  key: number;
  file: File;
  /** Folder path + file name, as picked or dropped ("Week 3/slides.pdf"). */
  path: string;
  title: string;
  type: MaterialType;
  week: string; // '' = no week
  status: 'queued' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
};

const CONCURRENCY = 3;
const MAX_WEEK = 16;
const WEEKS = Array.from({ length: MAX_WEEK }, (_, i) => i + 1);
// OS clutter that shows up when a whole folder is picked.
const IGNORED = /^(\..*|thumbs\.db|desktop\.ini)$/i;
let nextKey = 1;

/**
 * Reads a week number from a folder or file name, nearest first:
 * "Week 3", "week_03", "W3", "wk-3", "3주차", "제3주". Returns '' when none fits.
 */
export function detectWeek(path: string): string {
  const parts = path.split('/').reverse();
  for (const part of parts) {
    const name = part.replace(/\.[A-Za-z0-9]+$/, '');
    const match =
      /(?:^|[^a-z])(?:week|wk|w)[\s._-]*0*(\d{1,2})(?!\d)/i.exec(name) ??
      /(?:^|\D)0*(\d{1,2})\s*주차/.exec(name) ??
      /제\s*0*(\d{1,2})\s*주/.exec(name);
    const n = match ? Number(match[1]) : 0;
    if (n >= 1 && n <= MAX_WEEK) return String(n);
  }
  return '';
}

/** Every file inside dropped folders (Chromium, Firefox, Safari all support entries). */
async function filesFromDrop(items: DataTransferItemList): Promise<{ file: File; path: string }[]> {
  const entries = Array.from(items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  const out: { file: File; path: string }[] = [];

  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns at most ~100 entries per call; keep reading until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  }

  for (const entry of entries) await walk(entry, '');
  return out;
}

/**
 * Drag-and-drop multi-file (and whole-folder) upload with per-file progress,
 * week and type. Files go browser -> Supabase Storage directly (signed upload
 * URL); the server only issues the URL and records the row afterwards.
 */
export function Uploader({
  courseId,
  assignmentId,
  fixedType,
}: {
  courseId: string;
  assignmentId?: string;
  fixedType?: MaterialType;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [type, setType] = useState<MaterialType>(fixedType ?? 'lecture');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const idBase = assignmentId ?? courseId;

  const errorText = (code: UploadErrorCode) =>
    ({
      type: t.teach.errType,
      size: t.teach.errSize,
      forbidden: t.teach.errForbidden,
      rate: t.teach.errRate,
      failed: t.teach.errFailed,
    })[code];

  const patch = (key: number, changes: Partial<QueueItem>) =>
    setQueue((items) => items.map((item) => (item.key === key ? { ...item, ...changes } : item)));

  const patchQueued = (changes: Partial<QueueItem>) =>
    setQueue((items) => items.map((item) => (item.status === 'queued' ? { ...item, ...changes } : item)));

  function addFiles(files: { file: File; path: string }[]) {
    const added = files
      .filter(({ file }) => !IGNORED.test(file.name))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
      .map(({ file, path }): QueueItem => {
        const check = validateFile(file.name, file.size);
        return {
          key: nextKey++,
          file,
          path,
          title: stripExtension(file.name).slice(0, 200),
          type,
          week: detectWeek(path),
          status: check.ok ? 'queued' : 'error',
          progress: 0,
          error: check.ok ? undefined : errorText(check.reason),
        };
      });
    if (added.length > 0) setQueue((items) => [...items, ...added]);
  }

  const fromInput = (list: FileList | null) =>
    addFiles(Array.from(list ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name })));

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const hasEntries = Array.from(event.dataTransfer.items).some((item) => item.webkitGetAsEntry);
    if (hasEntries) addFiles(await filesFromDrop(event.dataTransfer.items));
    else fromInput(event.dataTransfer.files);
  }

  async function start() {
    const pending = queue.filter((item) => item.status === 'queued');
    if (pending.length === 0 || busy) return;
    setBusy(true);

    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        patch(item.key, { status: 'uploading', progress: 0 });
        try {
          const { path } = await uploadFile(courseId, item.file, (fraction) =>
            patch(item.key, { progress: fraction }),
          );
          const result = await registerMaterial({
            courseId,
            path,
            title: item.title.trim() || stripExtension(item.file.name),
            type: fixedType ?? item.type,
            week: item.week ? Number(item.week) : null,
            fileName: item.file.name,
            assignmentId: assignmentId ?? null,
          });
          if ('error' in result) throw new UploadError(result.error);
          patch(item.key, { status: 'done', progress: 1 });
        } catch (error) {
          const code = error instanceof UploadError ? error.code : 'failed';
          patch(item.key, { status: 'error', error: errorText(code) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

    setBusy(false);
    router.refresh(); // the material list below is server-rendered
  }

  const queued = queue.filter((item) => item.status === 'queued').length;
  const finished = queue.some((item) => item.status === 'done' || item.status === 'error');

  return (
    <div className="grid gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => void onDrop(event)}
        className={cn(
          'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border bg-background',
        )}
      >
        <Upload className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm">
          {t.teach.dropHint}{' '}
          <button
            type="button"
            className="rounded-sm font-medium text-primary-ink underline underline-offset-4"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {t.teach.browse}
          </button>{' '}
          {t.teach.or}{' '}
          <button
            type="button"
            className="rounded-sm font-medium text-primary-ink underline underline-offset-4"
            onClick={() => folderRef.current?.click()}
            disabled={busy}
          >
            {t.teach.chooseFolder}
          </button>
        </p>
        <p className="text-xs text-muted-foreground">{t.teach.limits}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            fromInput(event.target.files);
            event.target.value = ''; // allow picking the same file again
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          // Not in React's types; picks a whole folder including subfolders.
          {...{ webkitdirectory: '' }}
          onChange={(event) => {
            fromInput(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {queue.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">{t.teach.weekDetected}</p>
          <div className="flex flex-wrap items-end gap-3">
            {fixedType ? null : (
              <div className="grid gap-1.5">
                <Label htmlFor={`type-${idBase}`}>
                  {t.teach.batchType} · {t.teach.setAll}
                </Label>
                <Select
                  id={`type-${idBase}`}
                  value={type}
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.target.value as MaterialType;
                    setType(value);
                    patchQueued({ type: value });
                  }}
                  className="w-40"
                >
                  {MATERIAL_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {t.types[value]}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor={`week-${idBase}`}>
                {t.teach.batchWeek} · {t.teach.setAll}
              </Label>
              <Select
                id={`week-${idBase}`}
                value="keep"
                disabled={busy}
                onChange={(event) => patchQueued({ week: event.target.value })}
                className="w-36"
              >
                <option value="keep" disabled>
                  —
                </option>
                <option value="">{t.teach.noWeek}</option>
                {WEEKS.map((value) => (
                  <option key={value} value={value}>
                    {fmt(t.common.weekN, { n: value })}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={start} disabled={busy || queued === 0}>
              <Upload aria-hidden="true" />
              {fmt(t.teach.startUpload, { n: queued })}
            </Button>
            {finished && !busy ? (
              <Button
                variant="ghost"
                onClick={() => setQueue((items) => items.filter((item) => item.status === 'queued'))}
              >
                {t.teach.clearFinished}
              </Button>
            ) : null}
          </div>

          <ul className="divide-y rounded-xl border bg-card" aria-live="polite">
            {queue.map((item) => {
              const locked = busy || item.status !== 'queued';
              return (
                <li key={item.key} className="grid gap-1.5 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    <Input
                      value={item.title}
                      disabled={locked}
                      maxLength={200}
                      aria-label={fmt(t.teach.fileTitle, { name: item.file.name })}
                      onChange={(event) => patch(item.key, { title: event.target.value })}
                      className="h-9 min-w-0 flex-1 basis-full sm:basis-auto"
                    />
                    <Select
                      value={item.week}
                      disabled={locked}
                      aria-label={fmt(t.teach.fileWeek, { name: item.file.name })}
                      onChange={(event) => patch(item.key, { week: event.target.value })}
                      className="h-9 w-32 shrink-0"
                    >
                      <option value="">{t.teach.noWeek}</option>
                      {WEEKS.map((value) => (
                        <option key={value} value={value}>
                          {fmt(t.common.weekN, { n: value })}
                        </option>
                      ))}
                    </Select>
                    {fixedType ? null : (
                      <Select
                        value={item.type}
                        disabled={locked}
                        aria-label={fmt(t.teach.fileType, { name: item.file.name })}
                        onChange={(event) => patch(item.key, { type: event.target.value as MaterialType })}
                        className="h-9 w-32 shrink-0"
                      >
                        {MATERIAL_TYPES.map((value) => (
                          <option key={value} value={value}>
                            {t.types[value]}
                          </option>
                        ))}
                      </Select>
                    )}
                    {item.status === 'done' ? (
                      <Check className="h-5 w-5 shrink-0 text-highlight-foreground" aria-hidden="true" />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        disabled={item.status === 'uploading'}
                        aria-label={fmt(t.teach.remove, { name: item.file.name })}
                        onClick={() => setQueue((items) => items.filter((other) => other.key !== item.key))}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span className="truncate">{item.path}</span>
                    <span>{formatBytes(item.file.size)}</span>
                    <span className={item.status === 'error' ? 'font-medium text-destructive' : undefined}>
                      {item.status === 'queued'
                        ? t.teach.queued
                        : item.status === 'uploading'
                          ? `${t.teach.uploading} ${Math.round(item.progress * 100)}%`
                          : item.status === 'done'
                            ? t.teach.uploaded
                            : item.error}
                    </span>
                  </p>
                  {item.status === 'uploading' ? (
                    <Progress value={item.progress * 100} label={`${t.teach.uploading}: ${item.file.name}`} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
