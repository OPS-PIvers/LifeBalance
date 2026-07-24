import { Skeleton, SkeletonText, SkeletonCard } from 'lifebalance';

export const Shapes = () => (
  <div style={{ display: 'grid', gap: 12, width: 300 }}>
    <Skeleton className="h-8 w-40 rounded-md" />
    <Skeleton className="h-4 w-full rounded-md" />
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Skeleton className="h-10 w-10 rounded-full" />
      <Skeleton className="h-4 flex-1 rounded-md" />
    </div>
  </div>
);

export const TextLines = () => (
  <div style={{ width: 300 }}>
    <SkeletonText lines={4} />
  </div>
);

export const LoadingWidget = () => (
  <div style={{ width: 320 }}>
    <SkeletonCard />
  </div>
);
