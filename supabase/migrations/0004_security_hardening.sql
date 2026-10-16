-- =============================================================================
-- 0004_security_hardening.sql   (REVIEW ONLY - not yet applied to production)
--
-- L5  Uploads: stop accepting html / js / sh (files a browser or shell would
--     run directly). Mirrors ALLOWED_EXTENSIONS in src/lib/constants.ts.
-- L3  Profiles: students can no longer read professors' profile rows through
--     the database API (email, login ID, first-login flag). Course pages get
--     professor *names* from the server instead (src/lib/data.ts getMyCourses).
--
-- Runs in one transaction: either everything applies or nothing does.
-- Safe to run more than once.
-- =============================================================================

begin;

-- ------------------------------------------------------------------ L5 uploads
-- Only affects NEW uploads and replacements (the insert/update storage
-- policies call this function). Existing files are untouched and stay
-- downloadable; find them with the query at the end of this file.
create or replace function public.is_allowed_extension(p_name text)
returns boolean language sql immutable as $$
  select lower(substring(p_name from '\.([A-Za-z0-9]+)$')) = any (array[
    'pdf','ppt','pptx','doc','docx','xls','xlsx','hwp','hwpx','txt','md','csv',
    'zip','png','jpg','jpeg','gif','webp',
    'c','h','cpp','hpp','java','py','jsx','ts','tsx','json','css','sql',
    'ipynb','r','m','go','rs','kt','swift','yaml','yml','xml'
  ]);
$$;

-- ----------------------------------------------------------------- L3 profiles
-- Before: you, admins, and anyone who could read a course could read that
--         course's professor row (all columns).
-- After:  you and admins only. Policies and helper functions that look at
--         profiles are SECURITY DEFINER and are not affected.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (
    id = (select auth.uid())
    or public.is_admin()
  );

commit;

-- =============================================================================
-- Rollback (restores the previous behaviour exactly):
--
-- begin;
-- create or replace function public.is_allowed_extension(p_name text)
-- returns boolean language sql immutable as $$
--   select lower(substring(p_name from '\.([A-Za-z0-9]+)$')) = any (array[
--     'pdf','ppt','pptx','doc','docx','xls','xlsx','hwp','hwpx','txt','md','csv',
--     'zip','png','jpg','jpeg','gif','webp',
--     'c','h','cpp','hpp','java','py','js','jsx','ts','tsx','json','html','css','sql',
--     'ipynb','r','m','go','rs','kt','swift','sh','yaml','yml','xml'
--   ]);
-- $$;
-- drop policy if exists profiles_select on public.profiles;
-- create policy profiles_select on public.profiles
--   for select to authenticated using (
--     id = (select auth.uid())
--     or public.is_admin()
--     or exists (select 1 from public.courses c
--                where c.professor_id = profiles.id and public.can_read_course(c.id))
--   );
-- commit;
--
-- Existing files with the removed extensions (read-only check, run any time):
--
-- select m.id, c.code, m.file_name
-- from public.materials m join public.courses c on c.id = m.course_id
-- where lower(substring(m.storage_path from '\.([A-Za-z0-9]+)$')) in ('html', 'js', 'sh');
-- =============================================================================
