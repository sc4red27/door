# D-Share

A fast university course-materials portal. Professors upload lecture files, assignments and notices; students sign in with their student ID and see exactly their own courses for the current semester, with single-file, multi-select and whole-course ZIP downloads.

Next.js 15 (App Router, Server Components, TypeScript) · Tailwind CSS + shadcn/ui-style components · Supabase (Postgres, Auth, Storage, Row Level Security) · Vercel.

> **Status:** the code was written without a Node.js toolchain available, so it has not been installed, type-checked, built or run yet. Run `npm install && npm run typecheck && npm run build` first and expect to fix small things (most likely type nits around the Supabase client).

## 1. Architecture

```
Browser ──► Vercel (Next.js)
            ├─ middleware.ts         session refresh, login / first-password redirects
            ├─ Server Components     pages render on the server, RLS-scoped queries
            ├─ Server Actions        every mutation (CSRF-safe by design)
            └─ Route handlers        /api/download, /api/zip/*
                    │
                    ▼
            Supabase
            ├─ Auth      student ID -> <id>@students.local, bcrypt-hashed passwords
            ├─ Postgres  RLS on every table; enrollment rows are the access key
            └─ Storage   private bucket "materials", same rules as the tables, CDN in front

File bytes:  upload    browser ──signed upload URL──► Storage      (never through Vercel)
             download  browser ◄──60 s signed URL──── Storage/CDN  (never through Vercel)
             ZIP       browser fetches signed URLs and zips while streaming to disk
```

**Who can see what** is decided in one place: `can_read_course(course_id)` in the database. A course, its materials, notices, assignments and stored files are readable by students with an enrollment row, the owning professor, and admins. Department, year and semester only decide who gets *enrolled*; the UI never filters by them, so there is nothing to bypass.

### Folder structure

```
supabase/
  migrations/0001_schema.sql    tables, indexes, triggers, auto-enroll, rate limiter
  migrations/0002_rls.sql       helper functions + policies, promote / set-current RPCs
  migrations/0003_storage.sql   private bucket + storage policies
  seed.sql                      departments and semesters
scripts/seed.mjs                demo users, courses, enrollments, sample files
src/
  middleware.ts
  actions/      auth · admin · import · teach · student · prefs   (server actions)
  app/
    login/  change-password/
    (app)/dashboard  courses/[id]  marked  past                    student
    (app)/teach  teach/courses/new  teach/courses/[id]             professor
    (app)/admin  departments  semesters  courses  users  import    admin
    api/download/[id]            302 to a signed URL
    api/zip/manifest | sign | stream
  components/   material-browser · uploader · material-manager · csv-importer · ui/*
  i18n/         en.ts · ko.ts · server helpers · client provider
  lib/          auth · data (caching) · zip-paths · zip-client · zip-server · csv · files · rate-limit
```

## 2. Data model

`departments`, `semesters` (one `is_current`), `profiles` (role, login_id, department, year, semester), `courses` (code, department, semester, target year, professor), `enrollments` (student ↔ course, source `auto`/`manual`/`csv`), `materials` (title, type, week, storage path, size, MIME type, uploader), `notices`, `assignments` (due date; files attach through `materials.assignment_id`), `bookmarks` ("marked" materials), `rate_limits`.

Indexes cover every foreign key, `created_at`, and `(department_id, semester_id, year)` on both `courses` and `profiles`.

**Course visibility**

1. *Enrollment rows* are the only thing RLS trusts.
2. *Auto-enroll:* importing a student calls `auto_enroll_student()`, which enrolls them in every course matching department + semester level (1st–8th, stored in the `year` column) + term. A trigger does the mirror image when a course is created later.
3. *Exceptions:* electives are added one at a time (Admin → Users) or in bulk (extra-enrollments CSV).
4. *Past semesters:* promotion never deletes enrollments, so old courses stay readable. Students have no write policy on anything except their own bookmarks.

**Storage** keys are `<course_id>/<uuid>.<ext>`. Policies parse the first segment and apply the same `can_read_course` / `can_manage_course` check, so guessing a key or a material ID returns nothing, and a signed URL cannot be created for a file you cannot read.

## 3. Local setup

Requirements: Node.js 20.6+, Docker (for the Supabase CLI).

```bash
npm install
```

```bash
npx supabase init
```

```bash
npx supabase start
```

```bash
npx supabase db reset
```

`supabase init` only adds `config.toml`; it keeps the migrations. `db reset` applies the three migrations and `seed.sql`. `supabase start` prints the API URL, the anon key and the service-role key.

Create `.env.local` from `.env.example`, paste those three values, and set `SEED_PASSWORD` to a password of your choice (10+ characters). Then:

```bash
npm run seed
```

```bash
npm run dev
```

Open http://localhost:3000.

### Seed accounts

All use the password you put in `SEED_PASSWORD`.

| Role | Sign in with | Notes |
| --- | --- | --- |
| Admin | `admin@campus.local` | |
| Professor | `kim.prof@campus.local` | CSE courses plus one BUS course (cross-department) |
| Professor | `lee.prof@campus.local` | BUS courses |
| Student | `20243237` | CSE year 2, a BUS elective, one past-semester course |
| Student | `20243238`, `20242101`, `20252102` | CSE year 2, BUS year 2, BUS year 1 |
| Student | `20253001` | Must change password at first sign-in |

Seed data: 2 departments (CSE, BUS), 2 semesters (2026-1 past, 2026-2 current), 8 courses, sample files, notices and assignments.

## 4. Using it

**Admin**

- *Departments / Semesters:* create, rename, delete, switch the current semester.
- *Promote students:* moves everyone from one semester to another, optionally one year up (capped at "highest year"), and auto-enrolls them in the matching courses.
- *CSV import* (UTF-8, header row required):

  ```
  students:     student_id,name,department_code,semester[,term]
  professors:   professor_id,name,email,department_code
  enrollments:  student_id,course_code[,term]
  ```

  `semester` is the student's level, 1 to 8. `term` is a calendar term such as `2026-2`; leave it out to use the current term.

  Leave the temporary password empty to generate one per user (shown once, downloadable as CSV), or type one shared password. Either way the user must change it at first sign-in. Re-importing an existing student ID updates department/year/semester and re-runs auto-enroll.
- *Users:* search, reset a password, add or remove a single enrollment.

**Professor** — create and edit courses (any department, target semester 1st–8th; the term is always the current one), drag-and-drop multi-file upload with per-file progress, set type and week, edit / replace / delete files, post notices, create assignments with due dates and attached files.

**Student** — dashboard with current-semester courses, latest notices and upcoming deadlines; course page with materials grouped by week/type, search and filters; star any material and see all of them under *Marked*; *Past semesters* for older courses.

## 5. Downloads

| What | How |
| --- | --- |
| One file | Plain link to `/api/download/<id>` → RLS lookup → 302 to a 60-second signed URL with the original file name |
| Selected files | Checkboxes, per-group select, "Select all" → ZIP |
| Whole course | "Download all" → ZIP |
| All marked | "Download all marked" → ZIP |

ZIP layout: `<CourseCode_CourseName>/<Week NN or Type>/<filename>`, one top-level folder per course. Archive name: `<CourseName>_<YYYY-MM-DD>.zip` (`Materials_…` for several courses, `Marked_…` for marked items). Duplicate names in a folder become `name (2).ext`.

How a ZIP is built (`src/lib/zip-client.ts`):

1. `POST /api/zip/manifest` returns the RLS-filtered list of archive paths and sizes (rate-limited to 10 per user per minute).
2. Signed URLs are requested 20 files at a time, just before they are needed (5-minute expiry, re-signed once if a URL expires mid-download).
3. Files are fetched directly from Storage, three in flight, and piped through `client-zip` (store-only, constant memory). The library is loaded on demand.
4. In Chromium browsers the archive streams straight to disk through the File System Access API. Elsewhere it is collected into a Blob; above 300 MB the browser instead hands over to `POST /api/zip/stream`, which streams the same archive from the server as a normal browser download.

Progress shows files done, bytes and a percentage, with a cancel button.

## 6. Performance checklist

Targets: Lighthouse 95+, LCP under 1.5 s on 4G. These are design targets; measure them on your deployment with Lighthouse or WebPageTest.

- [x] Server Components everywhere; client JS only for the material browser, uploader, CSV importer and three header buttons.
- [x] `client-zip` is lazy-loaded on first ZIP download.
- [x] No web fonts (system stack with Hangul fallbacks), no images above the fold, one inline SVG icon set tree-shaken through `optimizePackageImports`.
- [x] Streaming with `Suspense` plus skeleton loaders (`loading.tsx`) instead of spinners.
- [x] Course header, material list, notices and assignments are read fresh on every request (one indexed query each). They are deliberately not kept in the Next.js data cache: that cache is per deployment, so uploads made from another environment (local dev, seed script, Supabase dashboard) would stay invisible on the live site for up to an hour.
- [x] Material lists render 60 rows at a time (IntersectionObserver) with `content-visibility: auto`; admin user list is paginated on the server.
- [x] Indexes on all foreign keys, `created_at`, and `(department_id, semester_id, year)`.
- [x] File bytes never pass through the app server for uploads or single downloads.
- [x] Search input uses `useDeferredValue`; ZIP progress repaints at most once per frame.
- [ ] Put the Vercel region next to the Supabase region (see below). This matters more than anything else on the list.

## 7. Security notes

- RLS on every table and on `storage.objects`; anonymous role has no table privileges.
- Role and department are never writable by the user: `profiles` has no self-update policy.
- Upload validation in three places: browser (instant feedback), server action (extension allow-list, 100 MB, stored size re-read from Storage), storage policy + bucket size limit (cannot be bypassed with a direct API call).
- Storage keys contain no user input; original file names live in the database.
- Rate limits (Postgres-backed, works on serverless): login 8 per account and 40 per IP in 5 minutes, ZIP jobs 10 per minute, uploads 300 per 10 minutes.
- Mutations are server actions (origin-checked by Next.js); the JSON/stream routes check `Origin` themselves; auth cookies are `SameSite=Lax`.
- Login returns the same message for unknown ID and wrong password.

Things to know:

- The login rate limit protects this app's login form. Supabase's own Auth endpoint is reachable with the anon key and has its own built-in limits; tighten them under *Auth → Rate Limits*.
- The first-login password change is enforced by the middleware and pages, not by RLS.
- A shared temporary password is weaker than generated ones; prefer leaving the field empty.

## 8. Deployment (Supabase + Vercel)

1. **Supabase project** — create it in the region closest to your users (Seoul: `ap-northeast-2`).
2. **Schema**

   ```bash
   npx supabase link --project-ref <your-project-ref>
   ```

   ```bash
   npx supabase db push
   ```

   Then run `supabase/seed.sql` in the SQL editor if you want the sample departments and semesters.
3. **Auth settings** — disable *Allow new users to sign up* (accounts come only from CSV import), set minimum password length to 10, and enable asymmetric JWT signing keys so sessions are verified without a network call.
4. **Storage** — the migration creates the private `materials` bucket with a 100 MB limit. The project-wide upload limit must also be at least 100 MB (*Storage → Settings*; the Free plan caps it at 50 MB, so either upgrade or lower `MAX_FILE_BYTES` and the bucket limit). Smart CDN caching is on by default on paid plans.
5. **First admin** — create a user in *Auth → Users*, then in the SQL editor:

   ```sql
   insert into public.profiles (id, role, login_id, full_name, email, must_change_password)
   select id, 'admin', 'admin', 'Portal Admin', email, false from auth.users where email = '<admin email>';

   update auth.users
      set raw_app_meta_data = raw_app_meta_data || '{"role":"admin","must_change_password":false}'::jsonb
    where email = '<admin email>';
   ```
6. **Vercel** — import the repository, set the function region next to Supabase (`icn1` for Seoul), and add the environment variables from `.env.example` (`SUPABASE_SERVICE_ROLE_KEY` as a server-only secret; `SEED_PASSWORD` is not needed in production).
7. Deploy, sign in as the admin, create departments and semesters, then import professors and students.

## 9. Assumptions

- One professor owns a course (`courses.professor_id`); a professor can own courses in any department. Co-teaching would need a join table.
- Students sign in with their ID; professors and admins with their email (their staff ID also works).
- Year promotion caps at the "highest year" you enter; graduating students are not removed automatically.
- Dates are displayed in one timezone (`NEXT_PUBLIC_APP_TIMEZONE`, default `Asia/Seoul`).
- ZIPs are store-only (no compression): lecture files are mostly already-compressed PDFs and Office documents, and it keeps memory flat.
- UI language follows a cookie, then the browser language; Korean and English dictionaries live in `src/i18n`.
- UI components are hand-written in the shadcn/ui style on native form controls (no Radix dependency); `components.json` is included so `npx shadcn add …` works if you want more.
