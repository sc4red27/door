import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { getDepartments, getSemesters } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import type { CourseDetail } from '@/lib/types';
import { getDict } from '@/i18n';

/** Server-rendered inputs for creating / editing a course. Wrap in <ActionForm action={saveCourse}>. */
export async function CourseFields({
  course,
  isAdmin,
  compact = false,
}: {
  course?: CourseDetail;
  isAdmin: boolean;
  /** Single column, for narrow side panels. */
  compact?: boolean;
}) {
  const [t, departments, semesters] = await Promise.all([getDict(), getDepartments(), getSemesters()]);

  // Only admins may assign a course to someone else.
  let professors: { id: string; full_name: string; login_id: string }[] = [];
  if (isAdmin) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, login_id')
      .eq('role', 'professor')
      .order('full_name')
      .limit(1000);
    professors = data ?? [];
  }

  const currentSemester = semesters.find((semester) => semester.is_current)?.id;
  const term = course?.semester.id ?? currentSemester;
  // Professors never pick the term: courses go into the current one (or keep theirs).
  // The picker only appears for admins, or if no current term has been set yet.
  const showTermPicker = isAdmin || !term;

  return (
    <>
      {course ? <input type="hidden" name="id" value={course.id} /> : null}
      <div className={compact ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
        <Field label={t.common.code} htmlFor="course-code" hint={t.teach.codeHint}>
          <Input
            id="course-code"
            name="code"
            required
            defaultValue={course?.code}
            pattern="[A-Za-z0-9_\-]{2,20}"
            maxLength={20}
            autoCapitalize="characters"
            spellCheck={false}
          />
        </Field>
        <Field label={t.common.name} htmlFor="course-name">
          <Input id="course-name" name="name" required defaultValue={course?.name} maxLength={120} />
        </Field>
        <Field label={t.common.department} htmlFor="course-department">
          <Select id="course-department" name="department_id" required defaultValue={course?.department_id}>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.code} · {department.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.teach.targetLevel} htmlFor="course-level" hint={t.teach.levelHint}>
          <Select id="course-level" name="year" required defaultValue={String(course?.year ?? 1)}>
            {t.common.levels.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {showTermPicker ? (
          <Field label={t.common.semester} htmlFor="course-semester">
            <Select id="course-semester" name="semester_id" required defaultValue={term}>
              {semesters.map((semester) => (
                <option key={semester.id} value={semester.id}>
                  {semester.name}
                  {semester.is_current ? ` (${t.common.current})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="semester_id" value={term} />
        )}
        {isAdmin ? (
          <Field label={t.common.professor} htmlFor="course-professor">
            <Select id="course-professor" name="professor_id" defaultValue={course?.professor_id ?? ''}>
              <option value="">{t.common.unassigned}</option>
              {professors.map((professor) => (
                <option key={professor.id} value={professor.id}>
                  {professor.full_name} ({professor.login_id})
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <Field label={`${t.common.description} (${t.common.optional})`} htmlFor="course-description">
        <Textarea id="course-description" name="description" defaultValue={course?.description ?? ''} maxLength={2000} />
      </Field>
    </>
  );
}
