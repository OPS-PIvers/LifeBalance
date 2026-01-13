import React from 'react';
import TopToolbar from './TopToolbar';
import BottomNav from './BottomNav';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-brand-50">
      {/* Header - Static flex item */}
      <TopToolbar />

      {/* Main Content - Scrollable area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth">
        {children}
      </main>

      {/* Footer - Static flex item */}
      <BottomNav />
    </div>
  );
};

export default MainLayout;
