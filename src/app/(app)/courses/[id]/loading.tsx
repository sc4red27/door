import { Skeleton } from '@/components/ui/misc';

export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-4 w-20" />
      <Skeleton className="mb-3 h-8 w-72 max-w-full" />
      <Skeleton className="mb-6 h-5 w-56" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-11" />
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <div className="grid content-start gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}
