-- All-in-one setup: paste this whole file into Supabase SQL Editor and click Run.
-- Generated from supabase/migrations/* and supabase/seed.sql.

-- ===== supabase\migrations\0001_schema.sql =====
-- =============================================================================
-- 0001_schema.sql  Tables, indexes, triggers and business functions
-- =============================================================================

create type public.user_role as enum ('admin', 'professor', 'student');
create type public.material_type as enum ('lecture', 'assignment', 'notice', 'other');

-- ---------------------------------------------------------------- departments
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{2,16}$'),
  name        text not null check (length(name) between 1 and 120),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ semesters
create table public.semesters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(name) between 1 and 40),  -- e.g. "2026-2"
  start_date  date not null,
  end_date    date not null,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  check (end_date > start_date)
);
-- At most one current semester.
create unique index semesters_one_current on public.semesters (is_current) where is_current;
create index semesters_start_date_idx on public.semesters (start_date desc);

-- ------------------------------------------------------------------- profiles
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  role                  public.user_role not null default 'student',
  login_id              text not null unique,           -- student ID / professor ID
  full_name             text not null,
  email                 text not null unique,           -- internal email for students
  department_id         uuid references public.departments (id) on delete set null,
  year                  smallint check (year between 1 and 8),
  semester_id           uuid references public.semesters (id) on delete set null,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role);
create index profiles_department_semester_idx on public.profiles (department_id, semester_id, year);
create index profiles_semester_idx on public.profiles (semester_id);
create index profiles_created_at_idx on public.profiles (created_at desc);

-- -------------------------------------------------------------------- courses
create table public.courses (
  id             uuid primary key default gen_random_uuid(),
  code           text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name           text not null check (length(name) between 1 and 120),
  description    text,
  department_id  uuid not null references public.departments (id) on delete restrict,
  semester_id    uuid not null references public.semesters (id) on delete restrict,
  year           smallint not null check (year between 1 and 8),   -- target year/level
  professor_id   uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (semester_id, code)
);
create index courses_department_semester_idx on public.courses (department_id, semester_id, year);
create index courses_professor_idx on public.courses (professor_id);
create index courses_created_at_idx on public.courses (created_at desc);

-- ---------------------------------------------------------------- enrollments
create table public.enrollments (
  student_id  uuid not null references public.profiles (id) on delete cascade,
  course_id   uuid not null references public.courses (id) on delete cascade,
  source      text not null default 'manual' check (source in ('auto', 'manual', 'csv')),
  created_at  timestamptz not null default now(),
  primary key (student_id, course_id)
);
create index enrollments_course_idx on public.enrollments (course_id);

-- ---------------------------------------------------------------- assignments
create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id) on delete cascade,
  title        text not null check (length(title) between 1 and 200),
  description  text,
  due_at       timestamptz not null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index assignments_course_due_idx on public.assignments (course_id, due_at);
create index assignments_due_idx on public.assignments (due_at);
create index assignments_created_by_idx on public.assignments (created_by);

-- ------------------------------------------------------------------ materials
create table public.materials (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.courses (id) on delete cascade,
  assignment_id  uuid references public.assignments (id) on delete set null,
  title          text not null check (length(title) between 1 and 200),
  type           public.material_type not null default 'lecture',
  week           smallint check (week between 1 and 30),
  storage_path   text not null unique,                 -- <course_id>/<uuid>.<ext> in bucket "materials"
  file_name      text not null,                        -- original name shown to users / used in ZIPs
  size_bytes     bigint not null check (size_bytes between 0 and 104857600),
  mime_type      text not null default 'application/octet-stream',
  uploaded_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index materials_course_week_idx on public.materials (course_id, week, created_at desc);
create index materials_assignment_idx on public.materials (assignment_id);
create index materials_uploaded_by_idx on public.materials (uploaded_by);
create index materials_created_at_idx on public.materials (created_at desc);

-- -------------------------------------------------------------------- notices
create table public.notices (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  title       text not null check (length(title) between 1 and 200),
  body        text not null default '',
  pinned      boolean not null default false,
  author_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index notices_course_created_idx on public.notices (course_id, created_at desc);
create index notices_created_at_idx on public.notices (created_at desc);
create index notices_author_idx on public.notices (author_id);

-- ------------------------------------------------------------------ bookmarks
create table public.bookmarks (
  student_id   uuid not null references public.profiles (id) on delete cascade,
  material_id  uuid not null references public.materials (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (student_id, material_id)
);
create index bookmarks_material_idx on public.bookmarks (material_id);
create index bookmarks_student_created_idx on public.bookmarks (student_id, created_at desc);

-- ---------------------------------------------------------------- rate limits
-- Fixed-window counters used for login and ZIP generation. Works on serverless
-- without Redis. Only the service role can touch it.
create table public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null default now(),
  count         integer not null default 0
);

-- ================================================================== triggers
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_updated_at  before update on public.profiles
  for each row execute function public.tg_set_updated_at();
create trigger courses_updated_at   before update on public.courses
  for each row execute function public.tg_set_updated_at();
create trigger materials_updated_at before update on public.materials
  for each row execute function public.tg_set_updated_at();

-- A new course immediately picks up every student matching department + year + semester.
create or replace function public.tg_course_auto_enroll()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.enrollments (student_id, course_id, source)
  select p.id, new.id, 'auto'
  from public.profiles p
  where p.role = 'student'
    and p.department_id = new.department_id
    and p.semester_id = new.semester_id
    and p.year = new.year
  on conflict do nothing;
  return new;
end $$;

create trigger courses_auto_enroll after insert on public.courses
  for each row execute function public.tg_course_auto_enroll();

-- ======================================================== business functions
-- Enroll one student in every course matching department + year + semester.
create or replace function public.auto_enroll_student(p_student uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  insert into public.enrollments (student_id, course_id, source)
  select p.id, c.id, 'auto'
  from public.profiles p
  join public.courses c
    on c.department_id = p.department_id
   and c.semester_id = p.semester_id
   and c.year = p.year
  where p.id = p_student and p.role = 'student'
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                 then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                        then now() else r.window_start end
  returning r.count into v_count;
  return v_count <= p_max;
end $$;

revoke all on function public.auto_enroll_student(uuid) from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.auto_enroll_student(uuid) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;


-- ===== supabase\migrations\0002_rls.sql =====
-- =============================================================================
-- 0002_rls.sql  Row Level Security
--
-- Rule of thumb: a course (and everything hanging off it) is readable by
--   * students with an enrollment row for it,
--   * the professor who owns it,
--   * admins.
-- Department / year / semester only decide who gets *enrolled*; the enrollment
-- row is the single thing RLS trusts.
-- =============================================================================

-- Helper functions are SECURITY DEFINER so policies can consult other tables
-- without recursive RLS evaluation. They only ever answer about auth.uid().
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create or replace function public.is_professor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'professor');
$$;

create or replace function public.is_enrolled(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e
                 where e.course_id = p_course and e.student_id = (select auth.uid()));
$$;

create or replace function public.can_manage_course(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_course is not null and (
    exists (select 1 from public.courses c where c.id = p_course and c.professor_id = (select auth.uid()))
    or public.is_admin()
  );
$$;

create or replace function public.can_read_course(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_course is not null and (
    exists (select 1 from public.enrollments e
            where e.course_id = p_course and e.student_id = (select auth.uid()))
    or public.can_manage_course(p_course)
  );
$$;

-- Admin-only operations exposed over RPC (they check the caller themselves).
create or replace function public.set_current_semester(p_semester uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.semesters where id = p_semester) then
    raise exception 'semester not found';
  end if;
  update public.semesters set is_current = false where is_current and id <> p_semester;
  update public.semesters set is_current = true where id = p_semester;
end $$;

-- Move every student of one semester to another, optionally bumping the year,
-- then auto-enroll them in the matching courses of the target semester.
create or replace function public.promote_students(
  p_from uuid, p_to uuid, p_increment_year boolean default false, p_max_year integer default 4
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from = p_to then
    raise exception 'source and target semester must differ';
  end if;

  update public.profiles
     set semester_id = p_to,
         year = case when p_increment_year and year is not null
                     then least(year + 1, p_max_year)::smallint else year end
   where role = 'student' and semester_id = p_from;
  get diagnostics v_count = row_count;

  insert into public.enrollments (student_id, course_id, source)
  select p.id, c.id, 'auto'
  from public.profiles p
  join public.courses c
    on c.department_id = p.department_id
   and c.semester_id = p.semester_id
   and c.year = p.year
  where p.role = 'student' and p.semester_id = p_to
  on conflict do nothing;

  return v_count;
end $$;

revoke all on function public.set_current_semester(uuid) from public, anon;
revoke all on function public.promote_students(uuid, uuid, boolean, integer) from public, anon;
grant execute on function public.set_current_semester(uuid) to authenticated;
grant execute on function public.promote_students(uuid, uuid, boolean, integer) to authenticated;

-- ------------------------------------------------------------- enable RLS
alter table public.departments enable row level security;
alter table public.semesters   enable row level security;
alter table public.profiles    enable row level security;
alter table public.courses     enable row level security;
alter table public.enrollments enable row level security;
alter table public.assignments enable row level security;
alter table public.materials   enable row level security;
alter table public.notices     enable row level security;
alter table public.bookmarks   enable row level security;
alter table public.rate_limits enable row level security;   -- no policies: service role only

-- Explicit grants (newer projects may not expose new tables automatically).
-- RLS above still decides which rows each signed-in user can touch.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Signed-out visitors get nothing at all.
revoke all on all tables in schema public from anon;
revoke all on public.rate_limits from authenticated;

-- ------------------------------------------------------------ departments
create policy departments_select on public.departments
  for select to authenticated using (true);
create policy departments_admin_write on public.departments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------- semesters
create policy semesters_select on public.semesters
  for select to authenticated using (true);
create policy semesters_admin_write on public.semesters
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------- profiles
-- You can read yourself, admins read everyone, and anyone can read the
-- professor of a course they are allowed to see (for "taught by ..." labels).
create policy profiles_select on public.profiles
  for select to authenticated using (
    id = (select auth.uid())
    or public.is_admin()
    or exists (select 1 from public.courses c
               where c.professor_id = profiles.id and public.can_read_course(c.id))
  );
-- No self-service updates: role, department, year are admin-controlled.
create policy profiles_admin_write on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- courses
-- Written against the row's own columns (not can_read_course) so that
-- INSERT ... RETURNING can see the row it has just created.
create policy courses_select on public.courses
  for select to authenticated using (
    professor_id = (select auth.uid())
    or public.is_admin()
    or public.is_enrolled(id)
  );
create policy courses_insert on public.courses
  for insert to authenticated with check (
    public.is_admin() or (public.is_professor() and professor_id = (select auth.uid()))
  );
create policy courses_update on public.courses
  for update to authenticated
  using (public.is_admin() or (public.is_professor() and professor_id = (select auth.uid())))
  with check (public.is_admin() or (public.is_professor() and professor_id = (select auth.uid())));
create policy courses_delete on public.courses
  for delete to authenticated using (
    public.is_admin() or (public.is_professor() and professor_id = (select auth.uid()))
  );

-- ------------------------------------------------------------ enrollments
-- Students see their own rows; professors see the roster of their courses.
-- Only admins (or the service role during CSV import) can change enrollments,
-- so a student can never enroll themselves into another department's course.
create policy enrollments_select on public.enrollments
  for select to authenticated using (
    student_id = (select auth.uid()) or public.can_manage_course(course_id)
  );
create policy enrollments_admin_write on public.enrollments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------- materials / notices / assignments
create policy materials_select on public.materials
  for select to authenticated using (public.can_read_course(course_id));
create policy materials_write on public.materials
  for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

create policy notices_select on public.notices
  for select to authenticated using (public.can_read_course(course_id));
create policy notices_write on public.notices
  for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

create policy assignments_select on public.assignments
  for select to authenticated using (public.can_read_course(course_id));
create policy assignments_write on public.assignments
  for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

-- -------------------------------------------------------------- bookmarks
create policy bookmarks_select on public.bookmarks
  for select to authenticated using (student_id = (select auth.uid()));
create policy bookmarks_insert on public.bookmarks
  for insert to authenticated with check (
    student_id = (select auth.uid())
    and exists (select 1 from public.materials m
                where m.id = material_id and public.can_read_course(m.course_id))
  );
create policy bookmarks_delete on public.bookmarks
  for delete to authenticated using (student_id = (select auth.uid()));


-- ===== supabase\migrations\0003_storage.sql =====
-- =============================================================================
-- 0003_storage.sql  Private bucket + policies mirroring the table rules
--
-- Object keys are always  <course_id>/<random uuid>.<ext>
-- so the first path segment tells us which course a file belongs to and the
-- same can_read_course / can_manage_course checks apply. Guessing a key is
-- useless: without an enrollment the object is invisible and cannot be signed.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', false, 104857600)        -- 100 MB
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- First path segment as a uuid, or null when the key is malformed.
create or replace function public.path_course_id(p_name text)
returns uuid language sql immutable as $$
  select case
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- Keep in sync with ALLOWED_EXTENSIONS in src/lib/constants.ts
create or replace function public.is_allowed_extension(p_name text)
returns boolean language sql immutable as $$
  select lower(substring(p_name from '\.([A-Za-z0-9]+)$')) = any (array[
    'pdf','ppt','pptx','doc','docx','xls','xlsx','hwp','hwpx','txt','md','csv',
    'zip','png','jpg','jpeg','gif','webp',
    'c','h','cpp','hpp','java','py','js','jsx','ts','tsx','json','html','css','sql',
    'ipynb','r','m','go','rs','kt','swift','sh','yaml','yml','xml'
  ]);
$$;

create policy materials_objects_select on storage.objects
  for select to authenticated using (
    bucket_id = 'materials' and public.can_read_course(public.path_course_id(name))
  );

create policy materials_objects_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'materials'
    and public.can_manage_course(public.path_course_id(name))
    and public.is_allowed_extension(name)
  );

create policy materials_objects_update on storage.objects
  for update to authenticated
  using (bucket_id = 'materials' and public.can_manage_course(public.path_course_id(name)))
  with check (
    bucket_id = 'materials'
    and public.can_manage_course(public.path_course_id(name))
    and public.is_allowed_extension(name)
  );

create policy materials_objects_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'materials' and public.can_manage_course(public.path_course_id(name))
  );


-- ===== supabase\seed.sql =====
-- Reference data that does not depend on auth users.
-- Users, courses, enrollments and sample files are created by `npm run seed`
-- (scripts/seed.mjs) because auth users must go through the Auth admin API.

insert into public.departments (code, name) values
  ('CSE', 'Computer Science & Engineering'),
  ('BUS', 'Business Administration')
on conflict (code) do nothing;

insert into public.semesters (name, start_date, end_date, is_current) values
  ('2026-1', '2026-03-02', '2026-06-19', false),
  ('2026-2', '2026-08-31', '2026-12-18', true)
on conflict (name) do nothing;


-- Make the new tables visible to the API immediately.
notify pgrst, 'reload schema';
