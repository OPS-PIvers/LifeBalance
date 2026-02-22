import React from 'react';
import { Loader2 } from 'lucide-react';

const Loading: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="text-center space-y-4">
        <div className="relative">
          <div className="absolute inset-0 bg-brand-500/20 blur-xl rounded-full w-16 h-16 mx-auto animate-pulse"></div>
          <Loader2 className="w-12 h-12 text-brand-800 animate-spin mx-auto relative z-10 drop-shadow-sm" />
        </div>
        <div>
          <h2 className="text-lg font-medium text-slate-900 tracking-tight mb-1">Loading LifeBalance</h2>
          <p className="text-sm text-slate-500 animate-pulse">Preparing your dashboard...</p>
        </div>
      </div>
    </div>
  );
};

export default Loading;
