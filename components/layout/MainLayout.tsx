import React from 'react';
import TopToolbar from './TopToolbar';
import BottomNav from './BottomNav';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-brand-50">
      <div className="flex-none z-10">
        <TopToolbar />
      </div>

      <main className="flex-1 overflow-y-auto relative scroll-smooth w-full">
        <div className="pb-8">
            {children}
        </div>
      </main>

      <div className="flex-none z-20">
        <BottomNav />
      </div>
    </div>
  );
};

export default MainLayout;
