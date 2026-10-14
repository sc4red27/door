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
