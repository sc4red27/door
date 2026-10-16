import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Content-Security-Policy with a fresh nonce per request. Next.js reads the
 * nonce from the request's CSP header and stamps it on its own inline and
 * chunk scripts; the root layout passes it to the theme script. With
 * 'strict-dynamic', only nonce-carrying scripts (and what they load) run.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV !== 'production';
  const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  return [
    "default-src 'self'",
    // React's dev tooling needs eval; production does not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Tailwind ships one stylesheet; inline style *attributes* (progress bar
    // widths) are allowed, inline <style> elements are not (dev needs them).
    `style-src-elem 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Uploads (signed upload URL) and ZIP downloads (signed URLs) talk to Storage directly.
    `connect-src 'self' ${supabase}${dev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/**
 * Runs on every page / API request:
 *  - refreshes the Supabase session cookie,
 *  - sends signed-out visitors to /login,
 *  - forces the first-login password change,
 *  - keeps students out of /teach and /admin (coarse routing only;
 *    the real authorisation is RLS in the database).
 */
export async function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set('Content-Security-Policy', csp);
    return res;
  };

  let response = next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // Keep the refreshed cookies visible to the page rendered for this request.
          requestHeaders.set('cookie', request.cookies.toString());
          response = next();
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Verifies the JWT signature (locally when the project uses asymmetric keys).
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = '';
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return withCsp(redirect);
  };

  if (!claims) {
    if (pathname === '/login') return withCsp(response);
    if (isApi) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return redirectTo('/login');
  }

  const meta = (claims.app_metadata ?? {}) as { role?: string; must_change_password?: boolean };

  if (meta.must_change_password) {
    if (isApi) return NextResponse.json({ error: 'password_change_required' }, { status: 403 });
    return pathname === '/change-password' ? withCsp(response) : redirectTo('/change-password');
  }

  if (pathname === '/login') return redirectTo('/');
  if (pathname.startsWith('/admin') && meta.role !== 'admin') return redirectTo('/');
  if (pathname.startsWith('/teach') && meta.role !== 'professor' && meta.role !== 'admin') return redirectTo('/');

  return withCsp(response);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
