'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Upload } from 'lucide-react';
import { importCourses, importEnrollments, importProfessors, importStudents } from '@/actions/import';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Badge, Progress } from '@/components/ui/misc';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/i18n/shared';
import { PASSWORD_MIN_LENGTH } from '@/lib/constants';
import { parseCsv, toCsv } from '@/lib/csv';
import type { ImportKind, ImportRowResult } from '@/lib/types';
import { chunk } from '@/lib/utils';

const SPEC: Record<ImportKind, { columns: string[]; sample: string; password: boolean }> = {
  students: {
    columns: ['student_id', 'name', 'department_code', 'semester'],
    sample: 'student_id,name,department_code,semester\r\n20263001,Kim Minji,CSE,1\r\n20263002,Lee Junho,BUS,3\r\n',
    password: true,
  },
  professors: {
    columns: ['professor_id', 'name', 'email', 'department_code'],
    sample: 'professor_id,name,email,department_code\r\nP2001,Park Sora,sora.park@example.ac.kr,CSE\r\n',
    password: true,
  },
  enrollments: {
    columns: ['student_id', 'course_code'],
    sample: 'student_id,course_code\r\n20263001,BUS201\r\n',
    password: false,
  },
  courses: {
    columns: ['code', 'name', 'department_code', 'semester'],
    sample:
      'code,name,department_code,semester,description\r\n' +
      'CSE301,Operating Systems,CSE,5,Processes and memory\r\n' +
      'CSE302,Databases,CSE,5,\r\n' +
      'CSE401,Computer Networks,CSE,7,\r\n',
    password: false,
  },
};

const ACTIONS = {
  students: importStudents,
  professors: importProfessors,
  enrollments: importEnrollments,
  courses: importCourses,
};
const CHUNK = 40; // rows per server call
const PREVIEW = 200; // result rows rendered; the CSV download has all of them

function saveText(fileName: string, text: string) {
  const href = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export function CsvImporter({ kind }: { kind: ImportKind }) {
  const { t } = useI18n();
  const router = useRouter();
  const spec = SPEC[kind];
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<ImportRowResult[]>([]);

  async function onFile(file: File | undefined) {
    setError(null);
    setResults([]);
    setRows([]);
    if (!file) return;
    const table = parseCsv(await file.text());
    if (!spec.columns.every((column) => table.headers.includes(column))) {
      setError(fmt(t.admin.badHeader, { cols: spec.columns.join(', ') }));
      return;
    }
    if (table.rows.length === 0) {
      setError(t.admin.emptyCsv);
      return;
    }
    setRows(table.rows);
  }

  async function start() {
    if (spec.password && password && password.length < PASSWORD_MIN_LENGTH) {
      setError(fmt(t.errors.weakPassword, { n: PASSWORD_MIN_LENGTH }));
      return;
    }
    setError(null);
    setRunning(true);
    setDone(0);
    setResults([]);
    const collected: ImportRowResult[] = [];
    try {
      let offset = 0;
      for (const part of chunk(rows, CHUNK)) {
        const batch = await ACTIONS[kind](part, spec.password && password ? password : null, offset);
        collected.push(...batch);
        offset += part.length;
        setDone(offset);
        setResults([...collected]);
      }
    } catch {
      setError(t.common.failed);
    } finally {
      setRunning(false);
      router.refresh(); // e.g. new course cards on /teach
    }
  }

  const failures = results.filter((result) => result.status === 'error').length;
  const hasPasswords = results.some((result) => result.password);
  const statusLabel = { created: t.admin.created, updated: t.admin.updated, enrolled: t.admin.enrolled, error: t.admin.error };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{spec.columns.join(', ')}</code>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(spec.sample)}`}
          download={`${kind}-sample.csv`}
          className="inline-flex items-center gap-1 rounded-sm text-primary-ink hover:underline"
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          {t.admin.sample}
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.admin.chooseCsv} htmlFor={`csv-${kind}`}>
          <Input
            id={`csv-${kind}`}
            type="file"
            accept=".csv,text/csv"
            disabled={running}
            className="h-auto py-2 file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-sm"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </Field>
        {spec.password ? (
          <Field label={`${t.admin.tempPassword} (${t.common.optional})`} htmlFor={`pw-${kind}`} hint={t.admin.tempPasswordHint}>
            <Input
              id={`pw-${kind}`}
              type="text"
              value={password}
              disabled={running}
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={start} disabled={running || rows.length === 0}>
          <Upload aria-hidden="true" />
          {fmt(t.admin.startImport, { n: rows.length })}
        </Button>
        {running ? (
          <div className="min-w-48 flex-1" role="status" aria-live="polite">
            <p className="mb-1 text-sm">{fmt(t.admin.importing, { done, total: rows.length })}</p>
            <Progress value={rows.length ? (done / rows.length) * 100 : 0} label={t.admin.importing} />
          </div>
        ) : null}
      </div>

      {results.length > 0 ? (
        <div className="grid gap-3" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium">
              {fmt(t.admin.summary, { ok: results.length - failures, errors: failures })}
            </p>
            {!running ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  saveText(
                    `${kind}-import-results.csv`,
                    toCsv(
                      ['row', 'id', 'status', 'message', 'temporary_password'],
                      results.map((r) => ({ ...r, temporary_password: r.password ?? '' })),
                    ),
                  )
                }
              >
                <FileDown aria-hidden="true" />
                {t.admin.downloadResults}
              </Button>
            ) : null}
          </div>
          {hasPasswords ? <p className="text-sm text-muted-foreground">{t.admin.passwordOnce}</p> : null}
          <div className="max-h-80 overflow-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-xs">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{t.admin.row}</th>
                  <th scope="col" className="px-3 py-2 font-medium">ID</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.admin.status}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t.admin.message}</th>
                  {hasPasswords ? <th scope="col" className="px-3 py-2 font-medium">{t.admin.tempPassword}</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {results.slice(0, PREVIEW).map((result) => (
                  <tr key={result.row}>
                    <td className="px-3 py-1.5 tabular-nums">{result.row}</td>
                    <td className="px-3 py-1.5">{result.id}</td>
                    <td className="px-3 py-1.5">
                      <Badge variant={result.status === 'error' ? 'destructive' : 'default'}>
                        {statusLabel[result.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5">{result.message}</td>
                    {hasPasswords ? <td className="px-3 py-1.5 font-mono text-xs">{result.password}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
