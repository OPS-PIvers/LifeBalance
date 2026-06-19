import React from 'react';
import { useLocation } from 'react-router-dom';
import TopToolbar from './TopToolbar';
import BottomNav from './BottomNav';
import ErrorBoundary from '@/components/ErrorBoundary';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { pathname } = useLocation();

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-brand-50 dark:bg-brand-900 transition-colors">
      <div className="flex-none">
        <TopToolbar />
      </div>

      <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth w-full">
        <div className="pb-8">
          {/* key=pathname resets the boundary on navigation so a crashed page
              does not stay crashed after the user navigates away */}
          <ErrorBoundary key={pathname}>
            {children}
          </ErrorBoundary>
        </div>
      </main>

      <div className="flex-none z-20">
        <BottomNav />
      </div>
    </div>
  );
};

export default MainLayout;
