'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE, type Locale } from '@/i18n/shared';

export async function setLocale(locale: Locale): Promise<void> {
  if (locale !== 'en' && locale !== 'ko') return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}
