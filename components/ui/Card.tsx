import React, { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ className, children, ...props }) => {
  return (
    <div
      className={cn(
        'bg-white backdrop-blur-xl rounded-3xl shadow-premium ring-1 ring-black/5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;
