import React, { useState, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import Card from './Card';
import { cn } from '@/utils/cn';

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
  id: providedId,
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
  const generatedId = useId();
  const id = providedId || generatedId;
  const contentId = `section-content-${id}`;
  const headerId = `section-title-${id}`;

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
        aria-controls={contentId}
        className={cn(
          "w-full flex items-center justify-between p-5 hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-base) ease-(--ease-standard) group text-left",
          headerClassName
        )}
      >
        <div className="flex items-center gap-4">
          {icon && <div className="text-accent-600 group-hover:text-accent-700 transition-colors dark:text-accent-400 dark:group-hover:text-accent-300">{icon}</div>}
          <h3 id={headerId} className="font-display text-lg font-semibold tracking-tight text-brand-900 dark:text-brand-100 group-hover:text-accent-700 dark:group-hover:text-accent-300 transition-colors">
            {title}
          </h3>
        </div>
        <ChevronDown
          className={cn(
            "w-5 h-5 text-brand-400 dark:text-brand-500 transition-transform duration-(--duration-base) ease-spring",
            isOpen && "rotate-180 text-accent-600 dark:text-accent-400"
          )}
        />
      </button>
      <div
        id={contentId}
        role="region"
        aria-labelledby={headerId}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out",
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className={cn("p-5 pt-0 border-t border-brand-200 dark:border-brand-700", contentClassName)}>
            <div className="pt-4">
              {children}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
