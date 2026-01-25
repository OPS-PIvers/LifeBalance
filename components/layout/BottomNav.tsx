import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Wallet, Plus, Activity, Utensils, CheckSquare, ShoppingCart } from 'lucide-react';
import CaptureModal from '../modals/CaptureModal';

const BottomNav: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const navLinkClass = ({ isActive }: { isActive: boolean }) => 
    `flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${
      isActive ? 'text-brand-800' : 'text-brand-400 hover:text-brand-600'
    }`;

  const iconClass = (isActive: boolean) => 
    `w-6 h-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`;

  return (
    <>
      <nav className="w-full bg-white/80 backdrop-blur-xl border-t border-white/20 ring-1 ring-black/5 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.05)] pb-safe">
        <div className="flex items-center justify-between h-16 px-2 relative">
          
          {/* Left Group */}
          <div className="flex items-center flex-1 justify-around">
            <NavLink to="/" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <LayoutDashboard className={iconClass(isActive)} />
                  <span className="text-xxs font-medium">Home</span>
                </>
              )}
            </NavLink>
            <NavLink to="/budget" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <Wallet className={iconClass(isActive)} />
                  <span className="text-xxs font-medium">Budget</span>
                </>
              )}
            </NavLink>
            <NavLink to="/habits" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <Activity className={iconClass(isActive)} />
                  <span className="text-xxs font-medium">Habits</span>
                </>
              )}
            </NavLink>
          </div>

          {/* Center FAB Placeholder to maintain spacing */}
          <div className="w-16 flex justify-center" />

          {/* Right Group */}
          <div className="flex items-center flex-1 justify-around">
            <NavLink to="/todos" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <CheckSquare className={iconClass(isActive)} />
                  <span className="text-xxs font-medium">To-Dos</span>
                </>
              )}
            </NavLink>
            <NavLink to="/meals" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <Utensils className={iconClass(isActive)} />
                  <span className="text-xxs font-medium">Meals</span>
                </>
              )}
            </NavLink>
            <NavLink to="/shopping" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  <ShoppingCart className={iconClass(isActive)} />
                  <span className="text-xxs font-medium">Shopping</span>
                </>
              )}
            </NavLink>
          </div>

          {/* Actual FAB positioned absolutely */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-6">
            <button
              onClick={() => setIsModalOpen(true)}
              className="group flex items-center justify-center w-16 h-16 bg-brand-800 text-white rounded-full shadow-xl shadow-brand-900/20 border-4 border-brand-50 active:scale-95 transition-transform"
              aria-label="Add Transaction"
            >
              <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform duration-300" />
            </button>
          </div>
        </div>
      </nav>

      {/* Capture Modal Overlay */}
      <CaptureModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
};

export default BottomNav;
