import type { CourseRef, MaterialType } from '@/lib/types';

export type ZipSelector =
  | { scope: 'ids'; ids: string[] }
  | { scope: 'course'; courseId: string }
  | { scope: 'marked' };

export type ZipEntry = { id: string; path: string; size: number; modified: string };
export type ZipManifest = { baseName: string; totalBytes: number; entries: ZipEntry[] };

export type ZipSource = {
  id: string;
  file_name: string;
  size_bytes: number;
  week: number | null;
  type: MaterialType;
  created_at: string;
  course: CourseRef;
};

const TYPE_FOLDERS: Record<MaterialType, string> = {
  lecture: 'Lecture',
  assignment: 'Assignment',
  notice: 'Notice',
  other: 'Other',
};

/** Makes a string safe as a single path segment on Windows, macOS and Linux. */
export function sanitizeSegment(value: string, fallback = 'file'): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  return cleaned || fallback;
}

function splitName(fileName: string): { stem: string; ext: string } {
  const safe = sanitizeSegment(fileName);
  const dot = safe.lastIndexOf('.');
  if (dot <= 0) return { stem: safe.slice(0, 120), ext: '' };
  return { stem: safe.slice(0, dot).slice(0, 120), ext: safe.slice(dot).slice(0, 16) };
}

export function courseFolder(course: CourseRef): string {
  return sanitizeSegment(`${course.code}_${course.name}`, course.code).slice(0, 120);
}

export function groupFolder(week: number | null, type: MaterialType): string {
  return week != null ? `Week ${String(week).padStart(2, '0')}` : TYPE_FOLDERS[type];
}

/**
 * <CourseCode_CourseName>/<Week NN | Type>/<filename>
 * Duplicate names inside one folder become "name (2).ext", "name (3).ext", ...
 * (compared case-insensitively so the archive also extracts cleanly on Windows/macOS).
 */
export function buildZipEntries(sources: ZipSource[]): ZipEntry[] {
  const sorted = [...sources].sort(
    (a, b) =>
      a.course.code.localeCompare(b.course.code) ||
      (a.week ?? 999) - (b.week ?? 999) ||
      a.type.localeCompare(b.type) ||
      a.file_name.localeCompare(b.file_name) ||
      a.created_at.localeCompare(b.created_at),
  );
  const used = new Set<string>();
  return sorted.map((source) => {
    const folder = `${courseFolder(source.course)}/${groupFolder(source.week, source.type)}`;
    const { stem, ext } = splitName(source.file_name);
    let path = `${folder}/${stem}${ext}`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${folder}/${stem} (${n})${ext}`;
    used.add(path.toLowerCase());
    return { id: source.id, path, size: source.size_bytes, modified: source.created_at };
  });
}

/** Base of the archive name; the caller appends _YYYY-MM-DD.zip. */
export function zipBaseName(courses: CourseRef[], scope: ZipSelector['scope']): string {
  if (scope === 'marked') return 'Marked';
  const unique = new Map(courses.map((c) => [c.id, c]));
  if (unique.size === 1) {
    const [only] = unique.values();
    return sanitizeSegment(only.name, only.code).replace(/\s+/g, '_').slice(0, 80);
  }
  return 'Materials';
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
