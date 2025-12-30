import React from 'react';
import { useLocation } from 'react-router-dom';

const PlaceholderPage: React.FC = () => {
  const location = useLocation();
  const title = location.pathname.substring(1);
  const formattedTitle = title.charAt(0).toUpperCase() + title.slice(1);

  return (
    <div className="min-h-screen bg-brand-50 flex flex-col items-center justify-center pb-24 px-4 text-center">
      <div className="w-20 h-20 bg-brand-100 rounded-full flex items-center justify-center mb-6 text-brand-300">
        <span className="text-4xl">🚧</span>
      </div>
      <h1 className="text-2xl font-bold text-brand-800 mb-2">{formattedTitle} Page</h1>
      <p className="text-brand-400 max-w-xs">
        This module is currently under construction. Check back in Phase 2.
      </p>
    </div>
  );
};

export default PlaceholderPage;
