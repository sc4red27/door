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
