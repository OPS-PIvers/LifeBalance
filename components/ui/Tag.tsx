import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface TagProps {
  label: React.ReactNode;
  variant?: 'default' | 'brand' | 'outline' | 'ghost';
  size?: 'sm' | 'md';
  onRemove?: (e: React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  icon?: React.ReactNode;
}

export const Tag: React.FC<TagProps> = ({
  label,
  variant = 'default',
  size = 'sm',
  onRemove,
  onClick,
  className,
  icon
}) => {
  const variants = {
    default: 'bg-white border-brand-200 text-brand-700 hover:bg-brand-50 hover:border-brand-300',
    brand: 'bg-brand-100 border-brand-200 text-brand-800 hover:bg-brand-200',
    outline: 'bg-transparent border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900',
    ghost: 'bg-transparent border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  };

  const sizes = {
    sm: 'text-xs',
    md: 'text-sm',
  };

  const baseStyles = 'inline-flex items-center rounded-full border transition-all shadow-sm font-medium';
  const variantStyles = variants[variant];
  const sizeStyles = sizes[size];

  // If clickable AND removable (split button)
  if (onClick && onRemove) {
    return (
      <div className={cn(baseStyles, variantStyles, sizeStyles, 'group p-0 overflow-hidden', className)}>
        <button
          onClick={onClick}
          className="pl-3 pr-2 py-1 hover:text-brand-900 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 flex items-center gap-1 h-full"
        >
          {icon}
          {label}
        </button>
        <div className="w-px h-3 bg-brand-100 mx-0.5 opacity-50" />
        <button
          type="button"
          onClick={onRemove}
          className="pr-2 pl-1 py-1 text-brand-300 hover:text-red-500 hover:bg-red-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 h-full flex items-center"
          aria-label={`Remove ${label}`}
        >
          <X size={size === 'sm' ? 12 : 14} />
        </button>
      </div>
    );
  }

  // If only removable (chip with X)
  if (onRemove) {
    return (
      <span className={cn(baseStyles, variantStyles, sizeStyles, 'pl-3 pr-1 py-1 group', className)}>
        <span className="flex items-center gap-1">
            {icon}
            {label}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 p-0.5 rounded-full hover:bg-black/10 transition-colors flex items-center justify-center"
          aria-label={`Remove ${label}`}
        >
          <X size={size === 'sm' ? 12 : 14} />
        </button>
      </span>
    );
  }

  // If only clickable (button)
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={cn(baseStyles, variantStyles, sizeStyles, 'px-3 py-1 hover:bg-opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1 flex items-center gap-1', className)}
      >
        {icon}
        {label}
      </button>
    );
  }

  // Just a label (badge-like)
  return (
    <span className={cn(baseStyles, variantStyles, sizeStyles, 'px-3 py-1 flex items-center gap-1', className)}>
      {icon}
      {label}
    </span>
  );
};
