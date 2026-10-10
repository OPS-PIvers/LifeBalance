import React from 'react';
import { Loader2 } from 'lucide-react';

const Loading: React.FC = () => {
  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 flex flex-col items-center justify-center p-4">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-accent-600 dark:text-accent-400 animate-spin mx-auto mb-4" />
        <h2 className="font-display text-2xl font-semibold tracking-tight text-brand-800 dark:text-brand-100 mb-2">
          Loading
        </h2>
        <p className="text-brand-500 dark:text-brand-400">
          Setting up your LifeBalance experience
        </p>
      </div>
    </div>
  );
};

export default Loading;
