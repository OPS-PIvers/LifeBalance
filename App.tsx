
import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { HouseholdProvider } from './contexts/HouseholdContext';
import TopToolbar from './components/layout/TopToolbar';
import BottomNav from './components/layout/BottomNav';
import Dashboard from './pages/Dashboard';
import Budget from './pages/Budget';
import Habits from './pages/Habits';
import PlaceholderPage from './pages/PlaceholderPage';

const App: React.FC = () => {
  return (
    <HashRouter>
      <HouseholdProvider>
        <div className="min-h-screen bg-brand-50 font-sans text-brand-800">
          <TopToolbar />
          
          <main>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/budget" element={<Budget />} />
              <Route path="/habits" element={<Habits />} />
              <Route path="/meals" element={<PlaceholderPage />} />
            </Routes>
          </main>

          <BottomNav />
          
          <Toaster 
            position="top-center"
            toastOptions={{
              className: 'bg-brand-800 text-white font-medium rounded-lg shadow-lg',
              success: {
                iconTheme: {
                  primary: '#10B981',
                  secondary: 'white',
                },
              },
            }}
          />
        </div>
      </HouseholdProvider>
    </HashRouter>
  );
};

export default App;
