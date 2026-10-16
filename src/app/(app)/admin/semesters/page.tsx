import type { Metadata } from 'next';
import {
  deleteSemester, promoteStudents, saveSemester, setCurrentSemester,
} from '@/actions/admin';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { TermGenerator } from '@/components/term-generator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input, Label, Select } from '@/components/ui/form';
import { Badge, EmptyState, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { getSemesters } from '@/lib/data';
import { todayInAppZone } from '@/lib/terms';
import { getDict } from '@/i18n';

export const metadata: Metadata = { title: 'Semesters' };

export default async function SemestersPage() {
  await requireUser(['admin']);
  const [t, semesters] = await Promise.all([getDict(), getSemesters()]);
  const current = semesters.find((semester) => semester.is_current);
  // Sensible default for promotion: current semester -> the next one by date.
  const next = current
    ? [...semesters].reverse().find((semester) => semester.start_date > current.start_date)
    : undefined;

  return (
    <>
      <PageHeader title={t.nav.semesters} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label={t.nav.semesters} className="grid content-start gap-2">
          {semesters.length === 0 ? <EmptyState>{t.admin.none}</EmptyState> : null}
          {semesters.map((semester) => (
            <div key={semester.id} className="grid gap-2 rounded-xl border bg-card p-3">
              <ActionForm action={saveSemester} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={semester.id} />
                <Input
                  name="name"
                  defaultValue={semester.name}
                  required
                  maxLength={40}
                  aria-label={`${t.common.name}: ${semester.name}`}
                  className="w-32"
                />
                <Input
                  name="start_date"
                  type="date"
                  defaultValue={semester.start_date}
                  required
                  aria-label={`${t.admin.startDate}: ${semester.name}`}
                  className="w-40"
                />
                <Input
                  name="end_date"
                  type="date"
                  defaultValue={semester.end_date}
                  required
                  aria-label={`${t.admin.endDate}: ${semester.name}`}
                  className="w-40"
                />
                <SubmitButton variant="outline">{t.common.save}</SubmitButton>
              </ActionForm>
              <div className="flex flex-wrap items-center gap-2">
                {semester.is_current ? (
                  <Badge>{t.common.current}</Badge>
                ) : (
                  <ActionForm action={setCurrentSemester}>
                    <input type="hidden" name="id" value={semester.id} />
                    <SubmitButton variant="secondary" size="sm">
                      {t.admin.setCurrent}
                    </SubmitButton>
                  </ActionForm>
                )}
                {semester.is_current ? null : (
                  <ActionForm action={deleteSemester}>
                    <input type="hidden" name="id" value={semester.id} />
                    <SubmitButton variant="ghost" size="sm" className="text-destructive" confirm={t.common.confirmDelete}>
                      {t.common.delete}
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
          ))}
        </section>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.admin.generateTitle}</CardTitle>
              <CardDescription>{t.admin.generateHint}</CardDescription>
            </CardHeader>
            <CardContent>
              <TermGenerator existing={semesters.map((semester) => semester.name)} today={todayInAppZone()} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.admin.semAdd}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={saveSemester} resetOnSuccess className="grid gap-3">
                <Field label={t.common.name} htmlFor="new-sem-name" hint={t.admin.semNameHint}>
                  <Input id="new-sem-name" name="name" required maxLength={40} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.admin.startDate} htmlFor="new-sem-start">
                    <Input id="new-sem-start" name="start_date" type="date" required />
                  </Field>
                  <Field label={t.admin.endDate} htmlFor="new-sem-end">
                    <Input id="new-sem-end" name="end_date" type="date" required />
                  </Field>
                </div>
                <div>
                  <SubmitButton>{t.common.add}</SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.admin.promoteTitle}</CardTitle>
              <CardDescription>{t.admin.promoteHint}</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={promoteStudents} className="grid gap-3">
                <Field label={t.admin.from} htmlFor="promote-from">
                  <Select id="promote-from" name="from" required defaultValue={current?.id}>
                    {semesters.map((semester) => (
                      <option key={semester.id} value={semester.id}>
                        {semester.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t.admin.to} htmlFor="promote-to">
                  <Select id="promote-to" name="to" required defaultValue={next?.id}>
                    {semesters.map((semester) => (
                      <option key={semester.id} value={semester.id}>
                        {semester.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox id="promote-year" name="increment_year" defaultChecked />
                  <Label htmlFor="promote-year">{t.admin.incrementYear}</Label>
                </div>
                <Field label={t.admin.maxYear} htmlFor="promote-max">
                  <Input id="promote-max" name="max_year" type="number" min={1} max={8} defaultValue={8} required className="w-24" />
                </Field>
                <div>
                  <SubmitButton confirm={t.admin.promoteConfirm}>{t.admin.promote}</SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
