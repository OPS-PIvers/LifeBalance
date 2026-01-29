import React from 'react';
import TopToolbar from './TopToolbar';
import BottomNav from './BottomNav';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-brand-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-brand-900 focus:font-bold focus:rounded-xl focus:shadow-2xl focus:ring-2 focus:ring-brand-500"
      >
        Skip to content
      </a>

      <div className="flex-none z-10">
        <TopToolbar />
      </div>

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth w-full outline-none"
      >
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
