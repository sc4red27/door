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
