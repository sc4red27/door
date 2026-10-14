import type { Metadata } from 'next';
import { deleteDepartment, saveDepartment } from '@/actions/admin';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { getDepartments } from '@/lib/data';
import { getDict } from '@/i18n';

export const metadata: Metadata = { title: 'Departments' };

export default async function DepartmentsPage() {
  await requireUser(['admin']);
  const [t, departments] = await Promise.all([getDict(), getDepartments()]);

  return (
    <>
      <PageHeader title={t.nav.departments} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label={t.nav.departments} className="grid content-start gap-2">
          {departments.length === 0 ? <EmptyState>{t.admin.none}</EmptyState> : null}
          {departments.map((department) => (
            <div key={department.id} className="flex flex-wrap items-start gap-2 rounded-xl border bg-card p-3">
              <ActionForm action={saveDepartment} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={department.id} />
                <Input
                  name="code"
                  defaultValue={department.code}
                  required
                  maxLength={16}
                  aria-label={`${t.common.code}: ${department.code}`}
                  className="w-28 uppercase"
                />
                <Input
                  name="name"
                  defaultValue={department.name}
                  required
                  maxLength={120}
                  aria-label={`${t.common.name}: ${department.code}`}
                  className="min-w-40 flex-1"
                />
                <SubmitButton variant="outline">{t.common.save}</SubmitButton>
              </ActionForm>
              <ActionForm action={deleteDepartment}>
                <input type="hidden" name="id" value={department.id} />
                <SubmitButton variant="ghost" className="text-destructive" confirm={t.common.confirmDelete}>
                  {t.common.delete}
                </SubmitButton>
              </ActionForm>
            </div>
          ))}
        </section>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t.admin.deptAdd}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveDepartment} resetOnSuccess className="grid gap-3">
              <Field label={t.common.code} htmlFor="new-dept-code" hint={t.admin.deptCodeHint}>
                <Input id="new-dept-code" name="code" required maxLength={16} className="uppercase" />
              </Field>
              <Field label={t.common.name} htmlFor="new-dept-name">
                <Input id="new-dept-name" name="name" required maxLength={120} />
              </Field>
              <div>
                <SubmitButton>{t.common.add}</SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
