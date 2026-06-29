import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface SectionActionLinkProps {
  /** Route path to navigate to. */
  to: string;
  /** The link label (rendered before the trailing arrow). */
  children: React.ReactNode;
  className?: string;
}

/**
 * The "View all →" / "Details →" action link rendered in a `Section` header
 * (its `action` slot). Consolidates the byte-identical Link + trailing
 * `ArrowRight` markup duplicated across the dashboard widgets.
 */
const SectionActionLink: React.FC<SectionActionLinkProps> = ({
  to,
  children,
  className,
}) => (
  <Link
    to={to}
    className={cn(
      'text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-accent-700 dark:hover:text-accent-300 flex items-center gap-1 transition-colors',
      className
    )}
  >
    {children} <ArrowRight size={12} />
  </Link>
);

export default SectionActionLink;
