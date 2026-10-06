import { classNames } from './class-names.ts';

/**
 * Loading skeleton (styleguide § 3.16): a block in the shape of the content, decorative (`aria-hidden`; the container
 * that holds it carries `aria-busy` and a text status). The sweep stops with prefers-reduced-motion (§ 2.9).
 */
export function Skeleton({ shape = 'line', className }: { readonly shape?: 'line' | 'field'; readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={classNames(
        'animate-skeleton bg-bg-skeleton rounded-control',
        shape === 'field' ? 'h-control-height-web-md w-full' : 'h-icon-md w-full',
        className,
      )}
    />
  );
}
