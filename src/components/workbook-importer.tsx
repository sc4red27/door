'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Upload } from 'lucide-react';
import {
  importCourses, importDepartments, importEnrollments, importProfessors, importStudents, importTerms,
} from '@/actions/import';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Label } from '@/components/ui/form';
import { Badge, Progress } from '@/components/ui/misc';
import { useI18n } from '@/i18n/provider';
import { fmt } from '@/i18n/shared';
import { toCsv } from '@/lib/csv';
import type { ImportRowResult } from '@/lib/types';
import { chunk } from '@/lib/utils';
import { WorkbookError, excelDate, readWorkbook, writeWorkbook } from '@/lib/xlsx';

type Rows = Record<string, string>[];
type Action = (rows: Rows, password: string | null, offset: number, options?: { idAsPassword?: boolean }) => Promise<ImportRowResult[]>;
type Kind = 'departments' | 'terms' | 'professors' | 'courses' | 'students' | 'enrollments';

/** Imported in this order, so later sheets can refer to what earlier ones created. */
const SHEETS: { kind: Kind; names: string[]; required: string[]; columns: string[]; example: string[]; action: Action }[] = [
  {
    kind: 'departments',
    names: ['departments', '학과'],
    required: ['code', 'name'],
    columns: ['code', 'name'],
    example: ['CSE', 'Computer Science & Engineering'],
    action: importDepartments,
  },
  {
    kind: 'terms',
    names: ['terms', 'term', '개설 학기', 'semesters'],
    required: ['name', 'start_date', 'end_date'],
    columns: ['name', 'start_date', 'end_date', 'current'],
    example: ['2027-1', '2027-03-02', '2027-06-18', 'yes'],
    action: importTerms,
  },
  {
    kind: 'professors',
    names: ['professors', '교수'],
    required: ['professor_id', 'name', 'email', 'department_code'],
    columns: ['professor_id', 'name', 'email', 'department_code'],
    example: ['P2001', 'Park Sora', 'sora.park@example.ac.kr', 'CSE'],
    action: importProfessors,
  },
  {
    kind: 'courses',
    names: ['courses', '강의'],
    required: ['code', 'name', 'department_code', 'semester'],
    columns: ['code', 'name', 'department_code', 'semester', 'description', 'term', 'professor_id'],
    example: ['CSE301', 'Operating Systems', 'CSE', '5', 'Processes and memory', '2027-1', 'P2001'],
    action: importCourses,
  },
  {
    kind: 'students',
    names: ['students', '학생'],
    required: ['student_id', 'name', 'department_code', 'semester'],
    columns: ['student_id', 'name', 'department_code', 'semester', 'term'],
    example: ['20271001', 'Kim Minji', 'CSE', '5', '2027-1'],
    action: importStudents,
  },
  {
    kind: 'enrollments',
    names: ['enrollments', '수강'],
    required: ['student_id', 'course_code'],
    columns: ['student_id', 'course_code', 'term'],
    example: ['20271001', 'CSE301', '2027-1'],
    action: importEnrollments,
  },
];

/** Column widths (characters) for the template, by column name. */
const WIDTH: Record<string, number> = {
  code: 12, name: 34, start_date: 14, end_date: 14, current: 10, professor_id: 14, email: 32,
  department_code: 18, semester: 11, description: 34, term: 10, student_id: 14, course_code: 14,
};

/** First sheet of the template. The importer skips it. */
const INSTRUCTIONS_SHEET = 'Instructions';
const INSTRUCTIONS: string[] = [
  'D-Share import template  ·  D-Share 가져오기 템플릿',
  '',
  'HOW TO USE',
  '1. Fill in only the sheets you need. Empty or deleted sheets are skipped.',
  '2. Row 1 of every sheet holds the column names. Do not change or move them.',
  '3. Row 2 is an example. Replace it with your own data or delete it, otherwise it is imported too.',
  '4. One record per row. Write dates as 2027-03-02.',
  '5. Save as .xlsx, then upload it in D-Share: Admin → CSV import → Import everything from one Excel file.',
  '6. Sheets are imported in this order: Departments → Terms → Professors → Courses → Students → Enrollments,',
  '   so courses and students can use departments and terms from the same file.',
  '7. Existing codes and IDs are updated, never duplicated. You can fix the file and upload it again.',
  '',
  'SHEETS AND COLUMNS  (* = required)',
  'Departments:  code* (e.g. CSE) · name*',
  'Terms:  name* (e.g. 2027-1) · start_date* · end_date* · current (yes = make it the current term)',
  'Professors:  professor_id* · name* · email* (they sign in with it) · department_code*',
  'Courses:  code* · name* · department_code* · semester* (1-8) · description · term (default: current term) · professor_id',
  '   Students of that department in that semester are enrolled automatically.',
  'Students:  student_id* · name* · department_code* · semester* (1-8) · term (default: current term)',
  'Enrollments:  student_id* · course_code* · term  (extra courses only, such as electives)',
  '',
  '사용 방법',
  '1. 필요한 시트만 채우세요. 비어 있거나 삭제한 시트는 건너뜁니다.',
  '2. 각 시트의 1행은 열 이름입니다. 바꾸거나 옮기지 마세요.',
  '3. 2행은 예시입니다. 내 데이터로 바꾸거나 삭제하세요. 그대로 두면 함께 가져옵니다.',
  '4. 한 행에 하나씩 입력합니다. 날짜는 2027-03-02 형식으로 입력하세요.',
  '5. .xlsx로 저장한 뒤 D-Share의 관리 → CSV 가져오기 → 엑셀 파일 하나로 모두 가져오기에서 업로드하세요.',
  '6. 학과 → 개설 학기 → 교수 → 강의 → 학생 → 추가 수강 순서로 가져옵니다.',
  '7. 이미 있는 코드와 ID는 중복 없이 갱신됩니다. 파일을 고쳐 다시 올려도 됩니다.',
  '',
  '시트와 열  (* = 필수)',
  '학과(Departments):  code* · name*',
  '개설 학기(Terms):  name* · start_date* · end_date* · current (yes = 현재 개설 학기로 설정)',
  '교수(Professors):  professor_id* · name* · email* (로그인에 사용) · department_code*',
  '강의(Courses):  code* · name* · department_code* · semester* (1~8학기) · description · term · professor_id',
  '학생(Students):  student_id* · name* · department_code* · semester* (1~8학기) · term',
  '추가 수강(Enrollments):  student_id* · course_code* · term  (선택 과목 등 추가 강의만)',
];
const SKIPPED_SHEETS = ['instructions', '안내'];

const CHUNK = 40; // rows per server call
const PREVIEW = 200;

type Found = { kind: Kind; rows: Rows; missing: string[] };
type SheetResult = { kind: Kind; results: ImportRowResult[] };

function save(fileName: string, data: BlobPart, type: string) {
  const href = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** One .xlsx file with a sheet per kind of record: departments, terms, professors, courses, students, enrollments. */
export function WorkbookImporter() {
  const { t } = useI18n();
  const router = useRouter();
  const [found, setFound] = useState<Found[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [idAsPassword, setIdAsPassword] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ kind: Kind; done: number; total: number } | null>(null);
  const [results, setResults] = useState<SheetResult[]>([]);

  const label: Record<Kind, string> = {
    departments: t.nav.departments,
    terms: t.nav.semesters,
    professors: t.admin.professors,
    courses: t.admin.courses,
    students: t.admin.students,
    enrollments: t.admin.importEnrollments,
  };

  function downloadTemplate() {
    const bytes = writeWorkbook([
      { name: INSTRUCTIONS_SHEET, rows: INSTRUCTIONS.map((line) => [line]), widths: [120], header: true },
      ...SHEETS.map((s) => ({
        name: s.names[0][0].toUpperCase() + s.names[0].slice(1),
        rows: [s.columns, s.example],
        widths: s.columns.map((c) => WIDTH[c] ?? 16),
        header: true,
      })),
    ]);
    save('d-share-import-template.xlsx', new Uint8Array(bytes), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  async function onFile(file: File | undefined) {
    setError(null);
    setFound([]);
    setIgnored([]);
    setResults([]);
    if (!file) return;
    try {
      const sheets = readWorkbook(new Uint8Array(await file.arrayBuffer()));
      const used = new Set<string>();
      const list: Found[] = [];
      for (const spec of SHEETS) {
        const name = spec.names.find((n) => sheets[n]);
        if (!name) continue;
        used.add(name);
        const sheet = sheets[name];
        const rows =
          spec.kind === 'terms'
            ? sheet.rows.map((r) => ({ ...r, start_date: excelDate(r.start_date ?? ''), end_date: excelDate(r.end_date ?? '') }))
            : sheet.rows;
        list.push({ kind: spec.kind, rows, missing: spec.required.filter((c) => !sheet.headers.includes(c)) });
      }
      setIgnored(Object.keys(sheets).filter((n) => !used.has(n) && !SKIPPED_SHEETS.includes(n)));
      if (list.length === 0) setError(t.admin.noSheets);
      setFound(list);
    } catch (e) {
      setError(e instanceof WorkbookError && e.message === 'too-large' ? t.admin.workbookTooLarge : t.admin.notXlsx);
    }
  }

  const ready = found.filter((f) => f.missing.length === 0 && f.rows.length > 0);
  const total = ready.reduce((n, f) => n + f.rows.length, 0);

  async function start() {
    setRunning(true);
    setError(null);
    const collected: SheetResult[] = [];
    try {
      for (const sheet of ready) {
        const spec = SHEETS.find((s) => s.kind === sheet.kind)!;
        const entry: SheetResult = { kind: sheet.kind, results: [] };
        collected.push(entry);
        let offset = 0;
        for (const part of chunk(sheet.rows, CHUNK)) {
          setProgress({ kind: sheet.kind, done: offset, total: sheet.rows.length });
          entry.results.push(...(await spec.action(part, null, offset, { idAsPassword })));
          offset += part.length;
          setResults(collected.map((c) => ({ ...c, results: [...c.results] })));
        }
      }
    } catch {
      setError(t.common.failed);
    } finally {
      setProgress(null);
      setRunning(false);
      router.refresh();
    }
  }

  const statusLabel = { created: t.admin.created, updated: t.admin.updated, enrolled: t.admin.enrolled, error: t.admin.error };
  const problems = results.flatMap((r) => r.results.filter((x) => x.status === 'error').map((x) => ({ ...x, kind: r.kind })));
  const hasPasswords = results.some((r) => r.results.some((x) => x.password));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">{SHEETS.map((s) => label[s.kind]).join(' → ')}</span>
        <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 rounded-sm text-primary-ink hover:underline">
          <FileDown className="h-4 w-4" aria-hidden="true" />
          {t.admin.workbookTemplate}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.admin.chooseWorkbook} htmlFor="workbook-file" hint={t.admin.workbookHint}>
          <Input
            id="workbook-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={running}
            className="h-auto py-2 file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-sm"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </Field>
        <div className="grid content-start gap-1.5">
          <div className="flex items-center gap-2">
            <Checkbox id="workbook-id-password" checked={idAsPassword} disabled={running} onChange={(e) => setIdAsPassword(e.target.checked)} />
            <Label htmlFor="workbook-id-password">{t.admin.idAsPassword}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{idAsPassword ? t.admin.idAsPasswordHint : t.admin.tempPasswordHint}</p>
        </div>
      </div>

      {found.length > 0 ? (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {found.map((f) => (
            <li key={f.kind} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="font-medium text-heading">{label[f.kind]}</span>
              {f.missing.length > 0 ? (
                <span className="text-destructive">{fmt(t.admin.sheetMissing, { cols: f.missing.join(', ') })}</span>
              ) : (
                <span className="text-muted-foreground">{fmt(t.admin.sheetRows, { n: f.rows.length })}</span>
              )}
            </li>
          ))}
          {ignored.length > 0 ? (
            <li className="px-4 py-2.5 text-xs text-muted-foreground">{fmt(t.admin.sheetIgnored, { names: ignored.join(', ') })}</li>
          ) : null}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={start} disabled={running || total === 0}>
          <Upload aria-hidden="true" />
          {fmt(t.admin.importAll, { n: total })}
        </Button>
        {progress ? (
          <div className="min-w-48 flex-1" role="status" aria-live="polite">
            <p className="mb-1 text-sm">
              {fmt(t.admin.importingSheet, { sheet: label[progress.kind], done: progress.done, total: progress.total })}
            </p>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} label={label[progress.kind]} />
          </div>
        ) : null}
      </div>

      {results.length > 0 ? (
        <div className="grid gap-3" role="status" aria-live="polite">
          <ul className="grid gap-1 text-sm">
            {results.map((r) => {
              const count = (s: ImportRowResult['status']) => r.results.filter((x) => x.status === s).length;
              return (
                <li key={r.kind}>
                  <span className="font-medium text-heading">{label[r.kind]}</span>{' '}
                  <span className="text-muted-foreground">
                    {fmt(t.admin.sheetSummary, {
                      created: count('created') + count('enrolled'),
                      updated: count('updated'),
                      errors: count('error'),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
          {!running ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  save(
                    'd-share-import-results.csv',
                    '﻿' +
                      toCsv(
                        ['sheet', 'row', 'id', 'status', 'message', 'temporary_password'],
                        results.flatMap((r) => r.results.map((x) => ({ ...x, sheet: r.kind, temporary_password: x.password ?? '' }))),
                      ),
                    'text/csv;charset=utf-8',
                  )
                }
              >
                <FileDown aria-hidden="true" />
                {t.admin.downloadResults}
              </Button>
              {hasPasswords ? <span className="text-sm text-muted-foreground">{t.admin.passwordOnce}</span> : null}
            </div>
          ) : null}
          {problems.length > 0 ? (
            <div className="max-h-80 overflow-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted text-xs">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">{t.admin.sheet}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t.admin.row}</th>
                    <th scope="col" className="px-3 py-2 font-medium">ID</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t.admin.message}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {problems.slice(0, PREVIEW).map((p) => (
                    <tr key={`${p.kind}-${p.row}`}>
                      <td className="px-3 py-1.5">{label[p.kind]}</td>
                      <td className="px-3 py-1.5 tabular-nums">{p.row + 1}</td>
                      <td className="px-3 py-1.5">{p.id}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant="destructive">{statusLabel.error}</Badge> {p.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
