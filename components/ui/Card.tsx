import React, { HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ className, children, ...props }) => {
  return (
    <div
      className={cn(
        'bg-white dark:bg-brand-800 rounded-card border border-brand-200 dark:border-brand-700',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;
