import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Consistent lucide icon for react-hot-toast's `icon` slot. Toasts render on
 * the dark brand-800 surface (see the Toaster config in App.tsx), so the
 * default tint is the light accent. Emoji toast icons are off-spec — always
 * use this instead.
 */
export const toastIcon = (Icon: LucideIcon, className = 'text-accent-300'): React.ReactElement => (
  <Icon size={18} className={`shrink-0 ${className}`} aria-hidden="true" />
);
