'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { deleteMaterial, replaceMaterialFile, updateMaterial } from '@/actions/teach';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/i18n/shared';
import { MATERIAL_TYPES } from '@/lib/constants';
import { ACCEPT_ATTRIBUTE, validateFile } from '@/lib/files';
import { formatBytes, formatDate } from '@/lib/format';
import type { MaterialItem, MaterialType } from '@/lib/types';
import { uploadFile } from '@/lib/upload-client';
import { cn } from '@/lib/utils';

type Row = Omit<MaterialItem, 'course'>;

/** Professor view of a course's files: edit metadata, replace the file, delete. */
export function MaterialManager({ courseId, items }: { courseId: string; items: Row[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; type: MaterialType; week: string }>({
    title: '',
    type: 'lecture',
    week: '',
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<{ id: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  if (items.length === 0) return <EmptyState>{t.teach.noMaterials}</EmptyState>;

  async function run(id: string, task: () => Promise<{ ok: boolean }>) {
    setBusyId(id);
    setError(null);
    try {
      const result = await task();
      if (!result.ok) setError(t.common.failed);
      else router.refresh();
      return result.ok;
    } catch {
      setError(t.common.failed);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(row: Row) {
    setEditing(row.id);
    setDraft({ title: row.title, type: row.type, week: row.week ? String(row.week) : '' });
  }

  async function saveEdit(id: string) {
    const ok = await run(id, () =>
      updateMaterial({ id, title: draft.title, type: draft.type, week: draft.week ? Number(draft.week) : null }),
    );
    if (ok) setEditing(null);
  }

  async function onReplaceFile(file: File | undefined) {
    const id = replaceTarget.current;
    if (!file || !id) return;
    const check = validateFile(file.name, file.size);
    if (!check.ok) {
      setError(check.reason === 'type' ? t.teach.errType : t.teach.errSize);
      return;
    }
    await run(id, async () => {
      setReplacing({ id, percent: 0 });
      try {
        const { path } = await uploadFile(courseId, file, (fraction) =>
          setReplacing({ id, percent: Math.round(fraction * 100) }),
        );
        return await replaceMaterialFile({ id, path, fileName: file.name });
      } finally {
        setReplacing(null);
      }
    });
  }

  return (
    <div className="grid gap-2">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void onReplaceFile(file);
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((row) => {
          const busy = busyId === row.id;
          const isEditing = editing === row.id;
          return (
            <li key={row.id} className="grid gap-2 px-3 py-2.5 sm:px-4">
              {isEditing ? (
                <form
                  className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_auto_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveEdit(row.id);
                  }}
                >
                  <Input
                    value={draft.title}
                    required
                    maxLength={200}
                    autoFocus
                    aria-label={t.common.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                  <Select
                    value={draft.type}
                    aria-label={t.common.type}
                    onChange={(event) => setDraft({ ...draft, type: event.target.value as MaterialType })}
                  >
                    {MATERIAL_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {t.types[value]}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={draft.week}
                    aria-label={t.common.week}
                    onChange={(event) => setDraft({ ...draft, week: event.target.value })}
                  >
                    <option value="">{t.teach.noWeek}</option>
                    {Array.from({ length: 16 }, (_, i) => i + 1).map((value) => (
                      <option key={value} value={value}>
                        {fmt(t.common.weekN, { n: value })}
                      </option>
                    ))}
                  </Select>
                  <Button type="submit" disabled={busy}>
                    {t.common.save}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                    {t.common.cancel}
                  </Button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{row.title}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {t.types[row.type]}
                      </Badge>
                      {row.week ? (
                        <Badge variant="outline" className="shrink-0">
                          {fmt(t.common.weekN, { n: row.week })}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {replacing?.id === row.id
                        ? fmt(t.teach.replacing, { percent: replacing.percent })
                        : `${row.file_name} · ${formatBytes(row.size_bytes)} · ${formatDate(row.created_at, locale)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <a
                      href={`/api/download/${row.id}`}
                      aria-label={fmt(t.materials.download, { name: row.title })}
                      title={fmt(t.materials.download, { name: row.title })}
                      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
                    >
                      <Download aria-hidden="true" />
                    </a>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={`${t.common.edit}: ${row.title}`}
                      title={t.common.edit}
                      onClick={() => startEdit(row)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={`${t.teach.replace}: ${row.title}`}
                      title={t.teach.replace}
                      onClick={() => {
                        replaceTarget.current = row.id;
                        fileRef.current?.click();
                      }}
                    >
                      <RefreshCw aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={`${t.common.delete}: ${row.title}`}
                      title={t.common.delete}
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (window.confirm(t.common.confirmDelete)) void run(row.id, () => deleteMaterial(row.id));
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
