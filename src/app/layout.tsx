import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { getDict, getLocale } from '@/i18n';
import { I18nProvider } from '@/i18n/provider';

export const metadata: Metadata = {
  title: { default: 'D-Share', template: '%s · D-Share' },
  description: 'D-Share: course materials, assignments and notices in one place.',
  applicationName: 'D-Share',
  robots: { index: false, follow: false }, // private portal
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFBFC' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1320' },
  ],
};

// Applies the saved (or system) theme before first paint, so there is no flash.
const themeScript =
  "try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, dict, requestHeaders] = await Promise.all([getLocale(), getDict(), headers()]);
  // Set by the middleware together with the Content-Security-Policy.
  const nonce = requestHeaders.get('x-nonce') ?? undefined;
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Browsers hide nonce values from the DOM, so React would report a mismatch here. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
        >
          {dict.nav.skip}
        </a>
        <I18nProvider dict={dict} locale={locale}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
