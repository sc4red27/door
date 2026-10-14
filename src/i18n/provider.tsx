'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Dict } from './en';
import type { Locale } from './shared';

const I18nContext = createContext<{ t: Dict; locale: Locale } | null>(null);

export function I18nProvider({ dict, locale, children }: { dict: Dict; locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={{ t: dict, locale }}>{children}</I18nContext.Provider>;
}

/** Dictionary for client components. Server components use getDict() instead. */
export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
