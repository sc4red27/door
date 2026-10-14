import { cn } from '@/lib/utils';

/** D-Share logo: the mark (blue tile, "D", mint share dot) plus the wordmark. */
export function Brand({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-9 w-9' : 'h-7 w-7';
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className={cn(box, 'shrink-0')} aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#4F74FF" />
        <path d="M10.5 9h5.25a7 7 0 0 1 0 14H10.5Z" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
        <circle cx="24" cy="8.5" r="3" fill="#A7E3C9" />
      </svg>
      <span
        className={cn(
          'whitespace-nowrap font-semibold tracking-tight text-heading',
          size === 'lg' ? 'text-xl' : 'text-base',
        )}
      >
        D-Share
      </span>
    </span>
  );
}
