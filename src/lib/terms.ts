import { APP_TIMEZONE } from '@/lib/constants';

/*
 * Term series for a two-semester year: "<year>-1" (spring, from March) and
 * "<year>-2" (fall, from September). From the first term, every next term is
 * the previous one moved 6 months forward, up to the latest term that has
 * already started. Shared by the preview (browser) and the action (server).
 */

export type PlannedTerm = { name: string; start_date: string; end_date: string };
export type PlanError = 'name' | 'dates' | 'future' | 'length' | 'tooMany';

export const TERM_NAME = /^(\d{4})-([12])$/;
const MAX_TERMS = 40; // 20 years

/** Today's date (YYYY-MM-DD) where the university is. */
export function todayInAppZone(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** YYYY-MM-DD plus whole months, clamped to the month's last day (Aug 31 + 6 -> Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12; // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** A real calendar date: Date.parse rolls 2024-02-30 over to March, so round-trip it. */
const isDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
};

export function planTerms(first: PlannedTerm, today: string): { terms: PlannedTerm[] } | { error: PlanError } {
  const match = TERM_NAME.exec(first.name.trim());
  if (!match) return { error: 'name' };
  if (!isDate(first.start_date) || !isDate(first.end_date) || first.end_date <= first.start_date) return { error: 'dates' };
  // Terms 6 months apart must not overlap.
  if (first.end_date >= addMonths(first.start_date, 6)) return { error: 'length' };
  if (first.start_date > today) return { error: 'future' };

  let year = Number(match[1]);
  let half = Number(match[2]);
  const terms: PlannedTerm[] = [];
  for (let i = 0; i < MAX_TERMS; i++) {
    const start = addMonths(first.start_date, 6 * i);
    if (start > today) return { terms };
    terms.push({ name: `${year}-${half}`, start_date: start, end_date: addMonths(first.end_date, 6 * i) });
    if (half === 1) half = 2;
    else {
      half = 1;
      year += 1;
    }
  }
  // Still not at today after MAX_TERMS: refuse instead of silently stopping short.
  return addMonths(first.start_date, 6 * MAX_TERMS) > today ? { terms } : { error: 'tooMany' };
}
