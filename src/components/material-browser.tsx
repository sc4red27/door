'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Download, FolderDown, Search, Star, X } from 'lucide-react';
import { toggleBookmark } from '@/actions/student';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Badge, EmptyState, Progress } from '@/components/ui/misc';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/i18n/shared';
import { MATERIAL_TYPES } from '@/lib/constants';
import { formatBytes, formatDate } from '@/lib/format';
import type { MaterialItem, MaterialType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { downloadAsZip, ZipError, type ZipProgress } from '@/lib/zip-client';
import { zipBaseName, type ZipSelector } from '@/lib/zip-paths';

type Props = {
  items: MaterialItem[];
  initialMarked: string[];
  /** Course page groups by week/type; the "Marked" page groups by course. */
  groupBy: 'week' | 'course';
  /** What "Download all" means on this page, its label and archive name. */
  zipAll: ZipSelector;
  zipAllLabel: string;
  zipAllName: string;
};

type Download =
  | { phase: 'idle' }
  | { phase: 'preparing' }
  | { phase: 'running'; progress: ZipProgress }
  | { phase: 'message'; tone: 'ok' | 'error'; text: string };

const PAGE = 60; // rows rendered per step; more are added as the user scrolls
const TYPE_ORDER: Record<MaterialType, number> = { lecture: 0, assignment: 1, notice: 2, other: 3 };

function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
  id?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="h-5 w-5 shrink-0 rounded border-input accent-primary"
    />
  );
}

export function MaterialBrowser({ items, initialMarked, groupBy, zipAll, zipAllLabel, zipAllName }: Props) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [type, setType] = useState<'all' | MaterialType>('all');
  const [week, setWeek] = useState('all');
  const [markedOnly, setMarkedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [marked, setMarked] = useState<Set<string>>(() => new Set(initialMarked));
  const [visible, setVisible] = useState(PAGE);
  const [download, setDownload] = useState<Download>({ phase: 'idle' });
  const [, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const frameRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) =>
        groupBy === 'course'
          ? a.course.code.localeCompare(b.course.code) || (a.week ?? 999) - (b.week ?? 999) || a.title.localeCompare(b.title)
          : (a.week ?? 999) - (b.week ?? 999) ||
            (a.week == null ? TYPE_ORDER[a.type] - TYPE_ORDER[b.type] : 0) ||
            TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
            a.title.localeCompare(b.title),
      ),
    [items, groupBy],
  );

  const weeks = useMemo(
    () => [...new Set(items.map((m) => m.week).filter((w): w is number => w != null))].sort((a, b) => a - b),
    [items],
  );

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return sorted.filter(
      (m) =>
        (type === 'all' || m.type === type) &&
        (week === 'all' || (week === 'none' ? m.week == null : m.week === Number(week))) &&
        (!markedOnly || marked.has(m.id)) &&
        (!needle || m.title.toLowerCase().includes(needle) || m.file_name.toLowerCase().includes(needle)),
    );
  }, [sorted, deferredQuery, type, week, markedOnly, marked]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: MaterialItem[] }>();
    for (const m of filtered.slice(0, visible)) {
      const key = groupBy === 'course' ? m.course.id : m.week != null ? `w${m.week}` : `t${m.type}`;
      let group = map.get(key);
      if (!group) {
        const label =
          groupBy === 'course'
            ? `${m.course.code} · ${m.course.name}`
            : m.week != null
              ? fmt(t.common.weekN, { n: m.week })
              : t.types[m.type];
        group = { key, label, items: [] };
        map.set(key, group);
      }
      group.items.push(m);
    }
    return [...map.values()];
  }, [filtered, visible, groupBy, t]);

  // Incremental rendering: long lists mount in steps as the sentinel nears the viewport.
  const hasMore = filtered.length > visible;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!hasMore || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible((count) => count + PAGE);
      },
      { rootMargin: '800px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, visible]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const resetWindow = () => setVisible(PAGE);
  const selectedInView = filtered.filter((m) => selected.has(m.id)).length;
  const allSelected = filtered.length > 0 && selectedInView === filtered.length;
  const busy = download.phase === 'preparing' || download.phase === 'running';

  function toggleMany(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleMark(id: string) {
    const on = !marked.has(id);
    const apply = (value: boolean) =>
      setMarked((prev) => {
        const next = new Set(prev);
        if (value) next.add(id);
        else next.delete(id);
        return next;
      });
    apply(on); // optimistic
    startTransition(async () => {
      const result = await toggleBookmark(id, on).catch(() => ({ ok: false }));
      if (!result.ok) apply(!on);
    });
  }

  async function runZip(selector: ZipSelector, baseName: string) {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setDownload({ phase: 'preparing' });

    // Progress arrives per network chunk; paint at most once per frame.
    let latest: ZipProgress | null = null;
    const onProgress = (progress: ZipProgress) => {
      latest = progress;
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        if (latest && !controller.signal.aborted) setDownload({ phase: 'running', progress: latest });
      });
    };
    const stopPainting = () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };

    try {
      const result = await downloadAsZip({ selector, baseName, signal: controller.signal, onProgress });
      stopPainting();
      const text =
        result === 'done' ? t.materials.done : result === 'server' ? t.materials.server : t.materials.cancelled;
      setDownload({ phase: 'message', tone: 'ok', text });
    } catch (error) {
      stopPainting();
      if (controller.signal.aborted) {
        setDownload({ phase: 'message', tone: 'ok', text: t.materials.cancelled });
        return;
      }
      const code = error instanceof ZipError ? error.code : 'failed';
      const text =
        code === 'rate' ? t.materials.errorRate : code === 'empty' ? t.materials.errorEmpty : t.materials.errorFailed;
      setDownload({ phase: 'message', tone: 'error', text });
    }
  }

  function downloadSelected() {
    const chosen = items.filter((m) => selected.has(m.id));
    if (chosen.length === 0) return;
    void runZip({ scope: 'ids', ids: chosen.map((m) => m.id) }, zipBaseName(chosen.map((m) => m.course), 'ids'));
  }

  if (items.length === 0) {
    return <EmptyState>{t.materials.empty}</EmptyState>;
  }

  const percent =
    download.phase === 'running' && download.progress.total > 0
      ? Math.min(100, Math.round((download.progress.loaded / download.progress.total) * 100))
      : 0;

  return (
    <div className={cn(selected.size > 0 || download.phase !== 'idle' ? 'pb-28' : undefined)}>
      {/* Search and filters */}
      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              resetWindow();
            }}
            placeholder={t.materials.search}
            aria-label={t.materials.search}
            className="pl-9"
          />
        </div>
        <Select
          value={type}
          aria-label={t.materials.filterType}
          onChange={(event) => {
            setType(event.target.value as 'all' | MaterialType);
            resetWindow();
          }}
        >
          <option value="all">{t.materials.allTypes}</option>
          {MATERIAL_TYPES.map((value) => (
            <option key={value} value={value}>
              {t.types[value]}
            </option>
          ))}
        </Select>
        {weeks.length > 0 ? (
          <Select
            value={week}
            aria-label={t.materials.filterWeek}
            onChange={(event) => {
              setWeek(event.target.value);
              resetWindow();
            }}
          >
            <option value="all">{t.materials.allWeeks}</option>
            {weeks.map((value) => (
              <option key={value} value={value}>
                {fmt(t.common.weekN, { n: value })}
              </option>
            ))}
            <option value="none">{t.teach.noWeek}</option>
          </Select>
        ) : null}
        <Button
          variant={markedOnly ? 'secondary' : 'outline'}
          aria-pressed={markedOnly}
          onClick={() => {
            setMarkedOnly((value) => !value);
            resetWindow();
          }}
        >
          <Star className={cn(markedOnly && 'fill-mark text-mark')} aria-hidden="true" />
          {t.materials.markedOnly}
        </Button>
      </div>

      {/* Select all + download all */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 sm:px-4">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
          <TriCheckbox
            checked={allSelected}
            indeterminate={selectedInView > 0 && !allSelected}
            onChange={() => toggleMany(filtered.map((m) => m.id), !allSelected)}
            label={t.materials.selectAll}
          />
          <span>{t.materials.selectAll}</span>
          <span className="font-normal text-muted-foreground">{fmt(t.materials.count, { n: filtered.length })}</span>
        </label>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void runZip(zipAll, zipAllName)}>
          <FolderDown aria-hidden="true" />
          {zipAllLabel}
        </Button>
      </div>

      {filtered.length === 0 ? <EmptyState>{t.materials.noMatch}</EmptyState> : null}

      <div className="grid gap-4">
        {groups.map((group) => {
          const ids = group.items.map((m) => m.id);
          const chosen = ids.filter((id) => selected.has(id)).length;
          return (
            <section
              key={group.key}
              aria-label={group.label}
              className="overflow-hidden rounded-lg border bg-card [contain-intrinsic-size:auto_320px] [content-visibility:auto]"
            >
              <div className="flex items-center gap-3 border-b bg-muted/50 px-3 py-2 sm:px-4">
                <TriCheckbox
                  checked={chosen === ids.length}
                  indeterminate={chosen > 0 && chosen < ids.length}
                  onChange={() => toggleMany(ids, chosen !== ids.length)}
                  label={fmt(t.materials.selectGroup, { name: group.label })}
                />
                <h3 className="text-sm font-semibold">{group.label}</h3>
                <span className="text-xs text-muted-foreground">{fmt(t.materials.count, { n: ids.length })}</span>
              </div>
              <ul className="divide-y">
                {group.items.map((m) => {
                  const isMarked = marked.has(m.id);
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-3 py-2 sm:px-4">
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={(event) => toggleMany([m.id], event.target.checked)}
                        aria-label={fmt(t.materials.selectItem, { name: m.title })}
                        className="h-5 w-5 shrink-0 rounded border-input accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <span className="truncate">{m.title}</span>
                          {groupBy === 'course' || m.week != null ? (
                            <Badge variant="secondary" className="shrink-0">
                              {groupBy === 'course' && m.week != null
                                ? fmt(t.common.weekN, { n: m.week })
                                : t.types[m.type]}
                            </Badge>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.file_name} · {formatBytes(m.size_bytes)} · {formatDate(m.created_at, locale)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleMark(m.id)}
                        aria-pressed={isMarked}
                        aria-label={fmt(isMarked ? t.materials.unmark : t.materials.mark, { name: m.title })}
                        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'shrink-0')}
                      >
                        <Star
                          className={cn(isMarked ? 'fill-mark text-mark' : 'text-muted-foreground')}
                          aria-hidden="true"
                        />
                      </button>
                      {/* Plain link: the route answers with a redirect to a 60-second signed URL. */}
                      <a
                        href={`/api/download/${m.id}`}
                        aria-label={fmt(t.materials.download, { name: m.title })}
                        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'shrink-0')}
                      >
                        <Download aria-hidden="true" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {hasMore ? <div ref={sentinelRef} className="h-10" aria-hidden="true" /> : null}

      {/* Selection + download status bar */}
      {selected.size > 0 || download.phase !== 'idle' ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div role="status" aria-live="polite" className="text-sm">
              {download.phase === 'preparing' ? <p>{t.materials.preparing}</p> : null}
              {download.phase === 'running' ? (
                <div className="grid gap-1.5">
                  <p>
                    {fmt(t.materials.progress, {
                      done: download.progress.filesDone,
                      total: download.progress.filesTotal,
                      percent,
                    })}
                    <span className="text-muted-foreground">
                      {' '}
                      · {formatBytes(download.progress.loaded)} / {formatBytes(download.progress.total)}
                    </span>
                  </p>
                  <Progress value={percent} label={t.materials.preparing} />
                </div>
              ) : null}
              {download.phase === 'message' ? (
                <p className={download.tone === 'error' ? 'text-destructive' : undefined}>{download.text}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selected.size > 0 ? (
                <>
                  <span className="text-sm font-medium">{fmt(t.materials.selected, { n: selected.size })}</span>
                  <Button size="sm" disabled={busy} onClick={downloadSelected}>
                    <Download aria-hidden="true" />
                    {t.materials.downloadSelected}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>
                    {t.materials.clear}
                  </Button>
                </>
              ) : null}
              <span className="ml-auto" />
              {busy ? (
                <Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
                  <X aria-hidden="true" />
                  {t.materials.cancel}
                </Button>
              ) : null}
              {download.phase === 'message' ? (
                <Button size="sm" variant="ghost" onClick={() => setDownload({ phase: 'idle' })}>
                  {t.materials.dismiss}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
