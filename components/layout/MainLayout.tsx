import React, { useState, useEffect } from 'react';
import TopToolbar from './TopToolbar';
import BottomNav from './BottomNav';
import HorizonCommandPalette from '../ui/HorizonCommandPalette';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [isHorizonOpen, setIsHorizonOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsHorizonOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-brand-50">
      <div className="flex-none z-10">
        <TopToolbar onOpenHorizon={() => setIsHorizonOpen(true)} />
      </div>

      <main className="flex-1 overflow-y-auto relative scroll-smooth w-full">
        <div className="pb-8">
            {children}
        </div>
      </main>

      <div className="flex-none z-20">
        <BottomNav />
      </div>

      <HorizonCommandPalette
        isOpen={isHorizonOpen}
        onClose={() => setIsHorizonOpen(false)}
      />
    </div>
  );
};

export default MainLayout;
