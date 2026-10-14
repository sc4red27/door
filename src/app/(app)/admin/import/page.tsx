import type { Metadata } from 'next';
import { CsvImporter } from '@/components/csv-importer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { getDict } from '@/i18n';

export const metadata: Metadata = { title: 'CSV import' };
// Each import call handles one small chunk of rows; allow headroom for account creation.
export const maxDuration = 60;

export default async function ImportPage() {
  await requireUser(['admin']);
  const t = await getDict();

  const sections = [
    { kind: 'students', title: t.admin.importStudents, hint: t.admin.importStudentsHint },
    { kind: 'professors', title: t.admin.importProfessors, hint: t.admin.importProfessorsHint },
    { kind: 'enrollments', title: t.admin.importEnrollments, hint: t.admin.importEnrollmentsHint },
    { kind: 'courses', title: t.teach.importCourses, hint: `${t.teach.importCoursesHint} ${t.teach.importCoursesAdminHint}` },
  ] as const;

  return (
    <>
      <PageHeader title={t.nav.import} />
      <div className="grid gap-4">
        {sections.map((section) => (
          <Card key={section.kind}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>{section.hint}</CardDescription>
            </CardHeader>
            <CardContent>
              <CsvImporter kind={section.kind} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
