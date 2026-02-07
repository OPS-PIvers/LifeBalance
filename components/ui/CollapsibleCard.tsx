import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Card from './Card';
import { cn } from '../../utils/cn';

export interface CollapsibleCardProps {
  id?: string;
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
}

export const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
  id,
  title,
  icon,
  defaultOpen = false,
  isOpen: controlledIsOpen,
  onToggle,
  children,
  className,
  contentClassName,
  headerClassName
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

  const handleToggle = () => {
    const nextState = !isOpen;
    if (!isControlled) {
      setInternalIsOpen(nextState);
    }
    onToggle?.(nextState);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <Card className={cn("overflow-hidden transition-all duration-300", className)}>
      <button
        type="button"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-expanded={isOpen}
        aria-controls={id ? `section-content-${id}` : undefined}
        className={cn(
          "w-full flex items-center justify-between p-5 hover:bg-slate-50/50 transition-all duration-300 group text-left",
          headerClassName
        )}
      >
        <div className="flex items-center gap-4">
          {icon && <div className="text-brand-500 group-hover:text-brand-600 transition-colors">{icon}</div>}
          <h3 id={id ? `section-title-${id}` : undefined} className="text-lg font-semibold tracking-tight text-slate-900 group-hover:text-brand-900 transition-colors">
            {title}
          </h3>
        </div>
        <ChevronDown
          className={cn(
            "w-5 h-5 text-slate-400 transition-transform duration-300 ease-spring",
            isOpen && "rotate-180 text-brand-500"
          )}
        />
      </button>
      <div
        id={id ? `section-content-${id}` : undefined}
        role="region"
        aria-labelledby={id ? `section-title-${id}` : undefined}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out",
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className={cn("p-5 pt-0 border-t border-slate-100/50", contentClassName)}>
            <div className="pt-4">
              {children}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
