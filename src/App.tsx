import { useEffect, useState } from 'react';
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
import { SettlementLog } from './screens/SettlementLog';
import { GroupMemberManager } from './screens/GroupMemberManager';
import { CategoryManager } from './screens/CategoryManager';
import { OnboardingScreen } from './screens/Onboarding';
import { BottomNav } from './components/BottomNav';
import { useFirebaseAuth } from './hooks/useFirebaseAuth';
import { loadTripFromCloud, saveTripToCloud } from './services/cloudTrip';

const EXIT_PATHS = new Set(['/', '/setup']);
const ONBOARDING_KEY = 'tripspend_onboarding_done_v1';
const AUTH_PROMPT_DISMISSED_KEY = 'tripspend_auth_prompt_dismissed_v1';

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

const PreSetupAuthPrompt = ({
  onSignIn,
  onLater,
}: {
  onSignIn: () => void;
  onLater: () => void;
}) => (
  <div className="min-h-screen px-4 py-8 flex items-center justify-center">
    <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-6">
      <h2 className="text-2xl font-black text-slate-900">Connect Google Account</h2>
      <p className="text-sm text-slate-600 mt-2">
        Sign in now to enable Firestore cloud backup and restore from day one.
      </p>
      <p className="text-xs text-slate-500 mt-2">
        You can choose Later and connect anytime from Settings - Cloud Sync.
      </p>
      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          type="button"
          onClick={onLater}
          className="py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm"
        >
          Later
        </button>
        <button
          type="button"
          onClick={onSignIn}
          className="py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm"
        >
          Sign in
        </button>
      </div>
    </div>
  </div>
);

export default function App() {
  const [onboardingDone, setOnboardingDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [authPromptDismissed, setAuthPromptDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTH_PROMPT_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

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

  const {
    user,
    loading: authLoading,
    signInWithGoogle,
    logout,
    isConfigured: firebaseConfigured,
  } = useFirebaseAuth();

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Google sign-in failed', error);
      const code = (error as { code?: string })?.code || '';
      if (code === 'auth/unauthorized-domain') {
        alert('Google sign-in failed: unauthorized domain. Add your app domain in Firebase Auth settings.');
        return;
      }
      alert('Google sign-in failed. If this is Android, reinstall latest build and retry from Settings > Cloud Sync.');
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Sign-out failed', error);
      alert('Could not sign out. Please try again.');
    }
  };

  const handleCloudBackup = async () => {
    if (!user) {
      alert('Sign in with Google first.');
      return;
    }

    try {
      await saveTripToCloud(user.uid, data);
      alert('Cloud backup saved to Firestore.');
    } catch (error) {
      console.error('Cloud backup failed', error);
      alert('Cloud backup failed. Check Firestore rules and config.');
    }
  };

  const handleCloudRestore = async () => {
    if (!user) {
      alert('Sign in with Google first.');
      return;
    }

    try {
      const cloudData = await loadTripFromCloud(user.uid);
      if (!cloudData || !cloudData.setup) {
        alert('No cloud backup found for this account.');
        return;
      }

      restoreData(cloudData.setup, cloudData.expenses || []);
      alert('Cloud backup restored successfully.');
    } catch (error) {
      console.error('Cloud restore failed', error);
      alert('Cloud restore failed. Check Firestore rules and config.');
    }
  };

  // If no setup, force setup screen
  const isSetup = !!data.setup;
  const shouldShowOnboarding = !isSetup && !onboardingDone;
  const shouldShowPreSetupAuthPrompt = !isSetup && onboardingDone && firebaseConfigured && !authLoading && !user && !authPromptDismissed;

  const completeOnboarding = () => {
    setOnboardingDone(true);
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // Ignore storage failures in private browsing/storage pressure.
    }
  };

  const handleAuthPromptLater = () => {
    setAuthPromptDismissed(true);
    try {
      localStorage.setItem(AUTH_PROMPT_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage failures.
    }
  };

  return (
    <Router>
      <DeepLinkHandler />
      <BackButtonGuard />
      <ScrollToTop />
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 font-sans text-slate-900">
        <Routes>
          {!isSetup ? (
            <Route
              path="*"
              element={
                shouldShowOnboarding
                  ? <OnboardingScreen onComplete={completeOnboarding} />
                  : shouldShowPreSetupAuthPrompt
                    ? <PreSetupAuthPrompt onSignIn={handleGoogleSignIn} onLater={handleAuthPromptLater} />
                    : <SetupScreen onSave={saveSetup} />
              }
            />
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
              <Route path="/settlement-log" element={<SettlementLog />} />
              <Route path="/members" element={<GroupMemberManager setup={data.setup} onUpdate={saveSetup} />} />
              <Route path="/categories" element={<CategoryManager setup={data.setup} onUpdate={saveSetup} />} />
              <Route
                path="/settings"
                element={
                  <Settings
                    onReset={resetTrip}
                    data={data}
                    onImport={restoreData}
                    firebaseConfigured={firebaseConfigured}
                    authLoading={authLoading}
                    userEmail={user?.email || null}
                    onSignInGoogle={handleGoogleSignIn}
                    onSignOutGoogle={handleGoogleSignOut}
                    onCloudBackup={handleCloudBackup}
                    onCloudRestore={handleCloudRestore}
                  />
                }
              />
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
