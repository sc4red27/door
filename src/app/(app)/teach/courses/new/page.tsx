import type { Metadata } from 'next';
import { saveCourse } from '@/actions/teach';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { CourseFields } from '@/components/course-fields';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { getDict } from '@/i18n';

export const metadata: Metadata = { title: 'New course' };

export default async function NewCoursePage() {
  const user = await requireUser(['professor', 'admin']);
  const t = await getDict();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.teach.newCourse} />
      <Card>
        <CardContent className="pt-4 sm:pt-5">
          <ActionForm action={saveCourse} className="grid gap-4">
            <CourseFields isAdmin={user.role === 'admin'} />
            <div>
              <SubmitButton>{t.common.create}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
