import React, { useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, List, Settings, ArrowLeftRight, Plus } from 'lucide-react';
import { cn } from '../utils/cn';
import { motion } from 'motion/react';

const NAV_ITEMS = [
  { to: '/', label: 'Home', Icon: Home },
  { to: '/expenses', label: 'Expenses', Icon: List },
  { to: '/settlement', label: 'Settle', Icon: ArrowLeftRight },
  { to: '/settings', label: 'Settings', Icon: Settings },
] as const;

export const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const handleAddExpense = useCallback(() => {
    navigate('/add');
  }, [navigate]);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-slate-200 z-50 shadow-xl shadow-slate-200/20"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-md mx-auto flex items-center justify-around px-2 h-16">
        <NavItem to={NAV_ITEMS[0].to} Icon={NAV_ITEMS[0].Icon} label={NAV_ITEMS[0].label} />
        <NavItem to={NAV_ITEMS[1].to} Icon={NAV_ITEMS[1].Icon} label={NAV_ITEMS[1].label} />

        {/* FAB — raised above nav */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          whileHover={{ scale: 1.05 }}
          onClick={handleAddExpense}
          className="w-14 h-14 bg-blue-600 rounded-full shadow-xl shadow-blue-300 flex items-center justify-center border-4 border-white -translate-y-4"
        >
          <Plus className="w-7 h-7 text-white" strokeWidth={2.5} />
        </motion.button>

        <NavItem to={NAV_ITEMS[2].to} Icon={NAV_ITEMS[2].Icon} label={NAV_ITEMS[2].label} />
        <NavItem to={NAV_ITEMS[3].to} Icon={NAV_ITEMS[3].Icon} label={NAV_ITEMS[3].label} />
      </div>
    </nav>
  );
};

const NavItem = React.memo(({ to, Icon, label }: { to: string; Icon: React.ComponentType<{ className?: string }>; label: string }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      cn(
        'flex flex-col items-center justify-center gap-1 transition-all duration-300 relative rounded-xl py-2 px-3',
        isActive ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
      )
    }
  >
    <>
      <Icon className="w-5 h-5" />
      <span className="text-[9px] font-bold uppercase tracking-wide leading-tight text-center">{label}</span>
    </>
  </NavLink>
));

NavItem.displayName = 'NavItem';
