import type { Metadata } from 'next';
import { MaterialBrowser } from '@/components/material-browser';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/lib/auth';
import { getMarkedMaterials } from '@/lib/data';
import { getDict } from '@/i18n';

export const metadata: Metadata = { title: 'Marked' };

export default async function MarkedPage() {
  await requireUser();
  const [t, materials] = await Promise.all([getDict(), getMarkedMaterials()]);

  return (
    <>
      <PageHeader title={t.marked.title} subtitle={t.marked.subtitle} />
      {materials.length === 0 ? (
        <EmptyState>{t.marked.empty}</EmptyState>
      ) : (
        <MaterialBrowser
          items={materials}
          initialMarked={materials.map((material) => material.id)}
          groupBy="course"
          zipAll={{ scope: 'marked' }}
          zipAllLabel={t.materials.downloadMarked}
          zipAllName="Marked"
        />
      )}
    </>
  );
}
