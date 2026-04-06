import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useTripData } from './hooks/useTripData';
import { SetupScreen } from './screens/SetupScreen';
import { Dashboard } from './screens/Dashboard';
import { AddExpense } from './screens/AddExpense';
import { ExpenseList } from './screens/ExpenseList';
import { ExpenseDetail } from './screens/ExpenseDetail';
import { Settings } from './screens/Settings';
import { Analytics } from './screens/Analytics';
import { Settlement } from './screens/Settlement';
import { GroupMemberManager } from './screens/GroupMemberManager';
import { CategoryManager } from './screens/CategoryManager';
import { BottomNav } from './components/BottomNav';

const EXIT_PATHS = new Set(['/', '/setup']);

const DeepLinkHandler = () => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let handler: { remove: () => Promise<void> } | undefined;

    const routeFromUrl = (rawUrl: string) => {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'tripspend:') {
          return;
        }

        const path = parsed.host
          ? `/${parsed.host}${parsed.pathname}`
          : (parsed.pathname || '/');
        const cleanPath = path.replace(/\/+/g, '/');
        navigate(`${cleanPath}${parsed.search || ''}`);
      } catch {
        // Ignore malformed deep links.
      }
    };

    const registerHandler = async () => {
      handler = await CapacitorApp.addListener('appUrlOpen', (event) => {
        if (event.url) {
          routeFromUrl(event.url);
        }
      });

      const launch = await CapacitorApp.getLaunchUrl();
      if (launch?.url) {
        routeFromUrl(launch.url);
      }
    };

    registerHandler();

    return () => {
      handler?.remove();
    };
  }, [navigate]);

  return null;
};

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
};

const BackButtonGuard = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let handler: { remove: () => Promise<void> } | undefined;

    const registerHandler = async () => {
      handler = await CapacitorApp.addListener('backButton', ({ canGoBack }) => {
        if (!EXIT_PATHS.has(location.pathname)) {
          if (canGoBack) {
            navigate(-1);
          } else {
            navigate('/');
          }
          return;
        }

        const shouldClose = window.confirm('Close TripSpend app?');
        if (shouldClose) {
          CapacitorApp.exitApp();
        }
      });
    };

    registerHandler();

    return () => {
      handler?.remove();
    };
  }, [location.pathname, navigate]);

  return null;
};

export default function App() {
  const {
    data,
    presets,
    saveSetup,
    addExpense,
    updateExpense,
    deleteExpense,
    undoDeleteExpense,
    canUndoDelete,
    resetTrip,
    restoreData,
    addPreset,
    togglePresetFavorite
  } = useTripData();

  // If no setup, force setup screen
  const isSetup = !!data.setup;

  return (
    <Router>
      <DeepLinkHandler />
      <BackButtonGuard />
      <ScrollToTop />
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 font-sans text-slate-900">
        <Routes>
          {!isSetup ? (
            <Route path="*" element={<SetupScreen onSave={saveSetup} />} />
          ) : (
            <>
              <Route path="/" element={<Dashboard data={data} />} />
              <Route 
                path="/add" 
                element={
                  <AddExpense 
                    onAdd={addExpense} 
                    onUpdate={updateExpense} 
                    expenses={data.expenses} 
                    setup={data.setup}
                    presets={presets}
                    onAddPreset={addPreset}
                    onTogglePresetFavorite={togglePresetFavorite}
                  />
                } 
              />
              <Route 
                path="/edit/:id" 
                element={
                  <AddExpense 
                    onAdd={addExpense} 
                    onUpdate={updateExpense} 
                    expenses={data.expenses} 
                    setup={data.setup}
                    presets={presets}
                    onAddPreset={addPreset}
                    onTogglePresetFavorite={togglePresetFavorite}
                  />
                } 
              />
              <Route
                path="/expenses"
                element={
                  <ExpenseList
                    expenses={data.expenses}
                    setup={data.setup}
                    onUndoDelete={undoDeleteExpense}
                    canUndoDelete={canUndoDelete}
                  />
                }
              />
              <Route path="/expense/:id" element={<ExpenseDetail expenses={data.expenses} onDelete={deleteExpense} setup={data.setup} />} />
              <Route path="/analytics" element={<Analytics data={data} />} />
              <Route path="/settlement" element={<Settlement data={data} />} />
              <Route path="/members" element={<GroupMemberManager setup={data.setup} onUpdate={saveSetup} />} />
              <Route path="/categories" element={<CategoryManager setup={data.setup} onUpdate={saveSetup} />} />
              <Route path="/settings" element={<Settings onReset={resetTrip} data={data} onImport={restoreData} />} />
              <Route path="/setup" element={<SetupScreen onSave={saveSetup} initialData={data.setup} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
        
        {isSetup && <BottomNav />}
      </div>
    </Router>
  );
}
