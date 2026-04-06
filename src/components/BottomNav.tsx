import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, PlusCircle, List, Settings, BarChart3 } from 'lucide-react';
import { cn } from '../utils/cn';
import { motion } from 'motion/react';

export const BottomNav: React.FC = () => {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-slate-200 px-2 pt-2 z-50 shadow-xl shadow-slate-200/20"
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="max-w-md mx-auto grid grid-cols-5 gap-1 items-center">
        <NavItem to="/" icon={<Home className="w-5 h-5" />} label="Home" />
        <NavItem to="/add" icon={<PlusCircle className="w-5 h-5" />} label="Add" />
        <NavItem to="/expenses" icon={<List className="w-5 h-5" />} label="Expenses" />
        <NavItem to="/analytics" icon={<BarChart3 className="w-5 h-5" />} label="Analytics" />
        <NavItem to="/settings" icon={<Settings className="w-5 h-5" />} label="Settings" />
      </div>
    </nav>
  );
};

const NavItem = ({ to, icon, label }: { to: string, icon: React.ReactNode, label: string }) => (
  <NavLink
    to={to}
    className={({ isActive }) => cn(
      "flex flex-col items-center justify-center gap-1 transition-all duration-300 relative rounded-xl py-2",
      isActive ? "text-blue-600 bg-blue-50" : "text-slate-500 hover:text-slate-700"
    )}
  >
    {({ isActive }) => (
      <>
        {isActive && (
          <motion.div
            layoutId="activeIndicator"
            className="absolute top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-blue-600 rounded-full"
          />
        )}
        {icon}
        <span className="text-[9px] font-bold uppercase tracking-wide leading-tight text-center">{label}</span>
      </>
    )}
  </NavLink>
);
