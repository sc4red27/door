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
  title: string;
  status: 'queued' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
};

const CONCURRENCY = 3;
let nextKey = 1;

/**
 * Drag-and-drop multi-file upload with per-file progress.
 * Files go browser -> Supabase Storage directly (signed upload URL); the
 * server only issues the URL and records the row afterwards.
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
  const [week, setWeek] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const added = Array.from(files).map((file): QueueItem => {
      const check = validateFile(file.name, file.size);
      return {
        key: nextKey++,
        file,
        title: stripExtension(file.name).slice(0, 200),
        status: check.ok ? 'queued' : 'error',
        progress: 0,
        error: check.ok ? undefined : errorText(check.reason),
      };
    });
    setQueue((items) => [...items, ...added]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) addFiles(event.dataTransfer.files);
  }

  async function start() {
    const pending = queue.filter((item) => item.status === 'queued');
    if (pending.length === 0 || busy) return;
    setBusy(true);
    const weekNumber = week ? Number(week) : null;

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
            type,
            week: weekNumber,
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
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-input',
        )}
      >
        <Upload className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm">
          {t.teach.dropHint}{' '}
          <button
            type="button"
            className="rounded-sm font-medium text-primary underline underline-offset-4"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {t.teach.browse}
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
            addFiles(event.target.files);
            event.target.value = ''; // allow picking the same file again
          }}
        />
      </div>

      {queue.length > 0 ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            {fixedType ? null : (
              <div className="grid gap-1.5">
                <Label htmlFor={`type-${idBase}`}>{t.teach.batchType}</Label>
                <Select
                  id={`type-${idBase}`}
                  value={type}
                  disabled={busy}
                  onChange={(event) => setType(event.target.value as MaterialType)}
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
              <Label htmlFor={`week-${idBase}`}>{t.teach.batchWeek}</Label>
              <Select
                id={`week-${idBase}`}
                value={week}
                disabled={busy}
                onChange={(event) => setWeek(event.target.value)}
                className="w-36"
              >
                <option value="">{t.teach.noWeek}</option>
                {Array.from({ length: 16 }, (_, i) => i + 1).map((value) => (
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

          <ul className="divide-y rounded-lg border bg-card" aria-live="polite">
            {queue.map((item) => (
              <li key={item.key} className="grid gap-1.5 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Input
                    value={item.title}
                    disabled={busy || item.status !== 'queued'}
                    maxLength={200}
                    aria-label={fmt(t.teach.fileTitle, { name: item.file.name })}
                    onChange={(event) => patch(item.key, { title: event.target.value })}
                    className="h-9"
                  />
                  {item.status === 'done' ? (
                    <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      disabled={item.status === 'uploading'}
                      aria-label={fmt(t.teach.remove, { name: item.file.name })}
                      onClick={() => setQueue((items) => items.filter((other) => other.key !== item.key))}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  )}
                </div>
                <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span className="truncate">{item.file.name}</span>
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
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
