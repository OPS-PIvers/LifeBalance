import React, { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ className, children, ...props }) => {
  return (
    <div
      className={cn(
        'bg-white dark:bg-slate-800 backdrop-blur-xl rounded-card shadow-glass ring-1 ring-black/5 dark:ring-white/10',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;
