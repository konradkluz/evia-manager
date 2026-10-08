import type { LinkComponent } from '@evia/ui-web';
import { Link } from '@tanstack/react-router';
import type { WORK_ORDERS_PATH } from '../paths.ts';

/**
 * Router link for the UI library (rows of tables, breadcrumbs, links in cards). The typed paths of the router are a closed
 * set; the addresses come from `paths.ts` (identifiers encoded), so the cast only tells the compiler what is already true.
 */
export const RouterLink: LinkComponent = ({ href, children, ...rest }) => (
  <Link to={href as typeof WORK_ORDERS_PATH} {...rest}>
    {children}
  </Link>
);
