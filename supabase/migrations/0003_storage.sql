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
