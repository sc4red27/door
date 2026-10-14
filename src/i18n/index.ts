import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { en, type Dict } from './en';
import { ko } from './ko';
import { LOCALE_COOKIE, type Locale } from './shared';

/** Cookie first, then the browser's Accept-Language, then English. */
export const getLocale = cache(async (): Promise<Locale> => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (stored === 'ko' || stored === 'en') return stored;
  const accept = (await headers()).get('accept-language') ?? '';
  return accept.trim().toLowerCase().startsWith('ko') ? 'ko' : 'en';
});

export const getDict = cache(async (): Promise<Dict> => ((await getLocale()) === 'ko' ? ko : en));

export { fmt } from './shared';
export type { Dict, Locale };
