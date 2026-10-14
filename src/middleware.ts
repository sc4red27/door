import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Runs on every page / API request:
 *  - refreshes the Supabase session cookie,
 *  - sends signed-out visitors to /login,
 *  - forces the first-login password change,
 *  - keeps students out of /teach and /admin (coarse routing only;
 *    the real authorisation is RLS in the database).
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
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
    return redirect;
  };

  if (!claims) {
    if (pathname === '/login') return response;
    if (isApi) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return redirectTo('/login');
  }

  const meta = (claims.app_metadata ?? {}) as { role?: string; must_change_password?: boolean };

  if (meta.must_change_password) {
    if (isApi) return NextResponse.json({ error: 'password_change_required' }, { status: 403 });
    return pathname === '/change-password' ? response : redirectTo('/change-password');
  }

  if (pathname === '/login') return redirectTo('/');
  if (pathname.startsWith('/admin') && meta.role !== 'admin') return redirectTo('/');
  if (pathname.startsWith('/teach') && meta.role !== 'professor' && meta.role !== 'admin') return redirectTo('/');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
