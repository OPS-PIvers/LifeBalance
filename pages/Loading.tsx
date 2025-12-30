import React from 'react';
import { Loader2 } from 'lucide-react';

const Loading: React.FC = () => {
  return (
    <div className="min-h-screen bg-brand-50 flex flex-col items-center justify-center p-4">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-brand-600 animate-spin mx-auto mb-4" />
        <h2 className="text-xl font-bold text-brand-800 mb-2">Loading...</h2>
        <p className="text-brand-500">Setting up your LifeBalance experience</p>
      </div>
    </div>
  );
};

export default Loading;
