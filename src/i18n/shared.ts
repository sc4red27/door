export type Locale = 'en' | 'ko';
export const LOCALES: Locale[] = ['en', 'ko'];
export const LOCALE_COOKIE = 'locale';

/** fmt('Week {n}', { n: 3 }) -> 'Week 3' */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
