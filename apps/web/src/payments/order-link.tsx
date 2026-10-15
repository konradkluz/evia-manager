import type { LinkComponent } from '@evia/ui-web';
import { Link } from '@tanstack/react-router';

/** Router link to W-06 for the unpaid list (the paths of the panel are typed: the identifier is part of the address). */
export const OrderLink: LinkComponent = ({ href, children, ...rest }) => (
  <Link to={href as '/work-orders'} {...rest}>
    {children}
  </Link>
);

/** The look of a link in a cell or a tile (`color.text.link`, underlined, focus ring — styleguide § 3.17). */
export const ORDER_LINK_CLASSES = 'break-words underline text-text-link focus-visible:focus-ring';
