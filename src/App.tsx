import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import googleIcon from './assets/google-icon.png';
import { useTripData } from './hooks/useTripData';
import { useCollaborativeTripData } from './hooks/useCollaborativeTripData';
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
import { TripDetails } from './screens/TripDetails';
import { OnboardingScreen } from './screens/Onboarding';
import { BottomNav } from './components/BottomNav';
import { NotificationCard, NotificationPayload } from './components/NotificationCard';
import { useFirebaseAuth } from './hooks/useFirebaseAuth';
import { NotificationRoute, useSmartReminders } from './hooks/useSmartReminders';
import { saveTripToCloud, loadAllTripsFromCloud, syncTripIncremental } from './services/cloudTrip';

const EXIT_PATHS = new Set(['/', '/setup']);
const ONBOARDING_KEY = 'tripspend_onboarding_done_v1';
const AUTH_PROMPT_DISMISSED_KEY = 'tripspend_auth_prompt_dismissed_v1';
const SYNC_QUEUE_KEY = 'tripspend_sync_queue_v1';

interface SyncQueueItem {
  tripId: string;
  enqueuedAt: number;
  attempts: number;
  nextRetryAt: number;
}

const readSyncQueue = (): SyncQueueItem[] => {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SyncQueueItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

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

const NotificationRouteHandler = ({
  route,
  onHandled,
}: {
  route: NotificationRoute | null;
  onHandled: () => void;
}) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!route) return;

    if (route.screen === 'settlement') {
      navigate('/settlement');
    } else if (route.screen === 'expense' && route.expenseId) {
      navigate(`/expense/${route.expenseId}`);
    } else if (route.screen === 'add') {
      navigate('/add');
    } else {
      navigate('/');
    }

    onHandled();
  }, [navigate, onHandled, route]);

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
  <div className="min-h-screen px-4 py-8 flex items-center justify-center bg-gradient-to-br from-blue-100 via-purple-100 to-pink-100">
    <div className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl p-8 text-center">
      {/* Google Logo */}
      <div className="mb-8 flex justify-center">
        <img src={googleIcon} alt="Google" className="w-20 h-20 object-contain" />
      </div>

      {/* Heading */}
      <h2 className="text-3xl font-black text-slate-900 mb-2">Connect your Google account</h2>
      
      {/* Description */}
      <p className="text-sm text-slate-500 mb-6">
        Secure your data across devices.<br />
        Back up and restore anytime.
      </p>

      {/* Sign In Button */}
      <button
        type="button"
        onClick={onSignIn}
        className="w-full py-3.5 rounded-full bg-white border-2 border-slate-200 shadow-md hover:shadow-lg hover:border-slate-300 transition-all flex items-center justify-center gap-3 mb-6 font-semibold text-slate-900"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Sign in with Google
      </button>

      {/* Later Link */}
      <button
        type="button"
        onClick={onLater}
        className="text-slate-400 font-medium hover:text-slate-600 transition-colors text-sm"
      >
        Later
      </button>
    </div>
  </div>
);

const NotificationPermissionGate = () => (
  <div className="min-h-screen px-4 py-8 flex items-center justify-center bg-gradient-to-br from-blue-100 via-purple-100 to-pink-100">
    <div className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl p-8 text-center">
      <div className="w-10 h-10 mx-auto rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
      <h2 className="mt-5 text-2xl font-black text-slate-900">Enabling notifications</h2>
      <p className="mt-2 text-sm text-slate-500">Please respond to the system permission prompt to continue.</p>
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
    } catch { return false; }
  });
  const [signingIn, setSigningIn] = useState(false);
  const [isTripSwitching, setIsTripSwitching] = useState(false);
  const [pendingTripName, setPendingTripName] = useState('');
  const [notificationGateComplete, setNotificationGateComplete] = useState(false);
  const [notification, setNotification] = useState<(NotificationPayload & { id: number }) | null>(null);
  const [pendingNotificationRoute, setPendingNotificationRoute] = useState<NotificationRoute | null>(null);
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<number | null>(null);
  const [lastSyncAttemptAt, setLastSyncAttemptAt] = useState<number | null>(null);
  const [autoSyncError, setAutoSyncError] = useState<string | null>(null);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>(() => readSyncQueue());
  const [collabReady, setCollabReady] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [showIdentityPicker, setShowIdentityPicker] = useState(false);
  const [pendingJoinTripId, setPendingJoinTripId] = useState<string | null>(null);
  const lastAutoSyncSignatureRef = useRef('');
  const isAutoSyncInFlightRef = useRef(false);
  const tripSwitchTimeoutRef = useRef<number | null>(null);
  const migrationAttemptedRef = useRef(false);

  const localTripStore = useTripData();

  const {
    user,
    loading: authLoading,
    signInWithGoogle,
    logout,
    isConfigured: firebaseConfigured,
  } = useFirebaseAuth();

  const collaborativeMode = Boolean(firebaseConfigured && user);

  // Use a ref so handleRemoteUpdate can read activeTrip without a stale closure
  // and without needing activeTrip to be declared first
  const activeTripRef = useRef<string | null>(null);

  const handleRemoteUpdate = useCallback((tripId: string) => {
    setNotification((prev) => {
      if (prev?.title === 'Trip updated') return prev;
      return {
        id: Date.now(),
        title: 'Trip updated',
        message: `A member made changes to ${tripId === activeTripRef.current ? 'this trip' : 'a shared trip'}.`,
        variant: 'info' as const,
        durationMs: 3000,
      };
    });
  }, []);

  const collaborativeTripStore = useCollaborativeTripData({
    userUid: user?.uid || null,
    enabled: collaborativeMode,
    onRemoteUpdate: handleRemoteUpdate,
  });

  const localHasSetup = Boolean(localTripStore.data.setup);
  const localActiveTripId = localTripStore.activeTrip;
  const localTripsForMigration = localTripStore.trips;
  const collaborativeTrips = collaborativeTripStore.trips;
  const collaborativeHasTrips = collaborativeTrips.length > 0;
  const collaborativeHasAnySetup = collaborativeTrips.some((trip) => Boolean(trip.data.setup));
  const importLocalTripsToCollaborative = collaborativeTripStore.importLocalTrips;

  useEffect(() => {
    if (!collaborativeMode) {
      setCollabReady(false);
      migrationAttemptedRef.current = false;
      return;
    }

    if (collaborativeHasTrips) {
      // Keep local mode if shared trips exist but have no setup while local setup is already complete.
      if (localHasSetup && !collaborativeHasAnySetup) {
        setCollabReady(false);
        return;
      }

      setCollabReady(true);
      return;
    }

    if (!localHasSetup) {
      // Fresh users without local setup can proceed with collaborative flow directly.
      setCollabReady(true);
      return;
    }

    // Local setup exists but shared data isn't ready yet: stay in local mode.
    setCollabReady(false);

    if (migrationAttemptedRef.current) {
      return;
    }

    migrationAttemptedRef.current = true;

    const runMigration = async () => {
      setIsMigrating(true);
      try {
        await importLocalTripsToCollaborative(localTripsForMigration, localActiveTripId);
      } finally {
        setIsMigrating(false);
      }
    };

    void runMigration();
  }, [
    collaborativeMode,
    collaborativeHasAnySetup,
    collaborativeHasTrips,
    importLocalTripsToCollaborative,
    localActiveTripId,
    localHasSetup,
    localTripsForMigration,
  ]);

  const usingCollaborativeStore = collaborativeMode && collabReady;
  const tripStore = usingCollaborativeStore ? collaborativeTripStore : localTripStore;

  // isHydrated only exists on the local store; collaborative store is always ready once collabReady
  const isHydrated = usingCollaborativeStore ? true : (localTripStore as typeof localTripStore & { isHydrated?: boolean }).isHydrated ?? false;

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
    togglePresetFavorite,
    trips,
    activeTrip,
    createTrip,
    joinTrip,
    deleteTrip,
    renameTrip,
    setActiveTripId,
    getActiveTripName,
    mergeTripFromSync,
  } = tripStore;

  // Auto-dismiss identity picker if user already has a claimed name (returning user)
  useEffect(() => {
    if (showIdentityPicker && collaborativeTripStore.myParticipantName) {
      setShowIdentityPicker(false);
    }
  }, [showIdentityPicker, collaborativeTripStore.myParticipantName]);

  // Edge 2: Show identity picker on every session if user is in a collaborative trip but hasn't claimed a name yet
  useEffect(() => {
    if (
      usingCollaborativeStore &&
      !collaborativeTripStore.myParticipantName &&
      (data.setup?.participants?.length ?? 0) > 0
    ) {
      setShowIdentityPicker(true);
    }
  }, [usingCollaborativeStore, collaborativeTripStore.myParticipantName, data.setup?.participants?.length]);

  // Keep activeTripRef in sync so handleRemoteUpdate can read it without stale closure
  useEffect(() => { activeTripRef.current = activeTrip ?? null; }, [activeTrip]);

  useEffect(() => {
    if (!collaborativeMode || !joinTrip) return;

    const params = new URLSearchParams(window.location.search);
    const joinTripId = params.get('joinTripId');
    if (!joinTripId) return;

    // Store for confirmation dialog — don't join silently
    setPendingJoinTripId(joinTripId);

    params.delete('joinTripId');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [collaborativeMode, joinTrip]);

  const handleNotificationRoute = useCallback((route: NotificationRoute) => {
    setPendingNotificationRoute(route);
  }, []);

  const notify = useCallback((payload: NotificationPayload) => {
    setNotification({ ...payload, id: Date.now() });
  }, []);

  const {
    notificationsEnabled,
    dailyExpenseRemindersEnabled,
    pendingSettlementRemindersEnabled,
    notificationPermission,
    requestInitialNotificationPermission,
    enableNotificationsFromSettings,
    disableNotifications,
    openNotificationSettings,
    unregisterDeviceToken,
    setDailyExpenseRemindersEnabled,
    setPendingSettlementRemindersEnabled,
  } = useSmartReminders({
    tripId: activeTrip,
    data,
    notify,
    onNavigateNotification: handleNotificationRoute,
    userUid: user?.uid || null,
  });

  useEffect(() => {
    if (!onboardingDone) return;
    if (notificationGateComplete) return;

    const runGate = async () => {
      if (notificationPermission === 'prompt') {
        await requestInitialNotificationPermission();
      }
      setNotificationGateComplete(true);
    };

    void runGate();
  }, [notificationGateComplete, notificationPermission, onboardingDone, requestInitialNotificationPermission]);

  useEffect(() => {
    if (usingCollaborativeStore) return;
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
    } catch {
      console.error('Failed to persist sync queue', {});
    }
  }, [syncQueue, usingCollaborativeStore]);

  const enqueueTripSync = useCallback((tripId: string) => {
    setSyncQueue((prev) => {
      const existing = prev.find((item) => item.tripId === tripId);
      if (existing) {
        return prev.map((item) => item.tripId === tripId
          ? { ...item, nextRetryAt: Math.min(item.nextRetryAt, Date.now()) }
          : item
        );
      }
      return [...prev, {
        tripId,
        enqueuedAt: Date.now(),
        attempts: 0,
        nextRetryAt: Date.now(),
      }];
    });
  }, []);

  useEffect(() => {
    if (usingCollaborativeStore || !firebaseConfigured || !user || !activeTrip) return;
    const currentTrip = trips.find((trip) => trip.id === activeTrip);
    if (!currentTrip || !currentTrip.data.setup) return;

    const signature = JSON.stringify({
      id: currentTrip.id,
      updatedAt: currentTrip.updatedAt,
      setup: currentTrip.data.setup,
      expensesCount: currentTrip.data.expenses.length,
      newestExpenseId: currentTrip.data.expenses[0]?.id || null,
      newestExpenseUpdatedAt: currentTrip.data.expenses[0]?.updatedAt || null,
      deletedCount: Object.keys(currentTrip.data.deletedExpenseMap || {}).length,
    });

    if (signature !== lastAutoSyncSignatureRef.current) {
      lastAutoSyncSignatureRef.current = signature;
      enqueueTripSync(currentTrip.id);
    }
  }, [activeTrip, enqueueTripSync, firebaseConfigured, trips, user, usingCollaborativeStore]);

  const syncQueueRef = useRef(syncQueue);
  useEffect(() => { syncQueueRef.current = syncQueue; }, [syncQueue]);

  useEffect(() => {
    if (usingCollaborativeStore || !firebaseConfigured || !user) return;

    const processQueue = async () => {
      if (isAutoSyncInFlightRef.current) return;
      if (!navigator.onLine) return;

      const now = Date.now();
      const queue = syncQueueRef.current;
      let next: SyncQueueItem | null = null;
      for (const item of queue) {
        if (item.nextRetryAt > now) continue;
        if (!next || item.nextRetryAt < next.nextRetryAt) {
          next = item;
        }
      }

      if (!next) return;

      const trip = trips.find((item) => item.id === next!.tripId);
      if (!trip || !trip.data.setup) {
        setSyncQueue((prev) => prev.filter((item) => item.tripId !== next!.tripId));
        return;
      }

      isAutoSyncInFlightRef.current = true;
      try {
        setLastSyncAttemptAt(Date.now());
        const result = await syncTripIncremental(user.uid, trip);
        mergeTripFromSync(result.mergedTrip);
        setLastAutoSyncAt(result.lastAttemptAt);
        setAutoSyncError(null);
        setSyncQueue((prev) => prev.filter((item) => item.tripId !== next!.tripId));
      } catch (error) {
        console.error('Queued sync failed', error);
        const nextAttempts = next.attempts + 1;
        const backoffMs = Math.min(5 * 60 * 1000, 15000 * (2 ** Math.min(nextAttempts, 5)));
        setAutoSyncError('Auto-sync failed. Will retry.');
        setSyncQueue((prev) => prev.map((item) => item.tripId === next!.tripId
          ? {
            ...item,
            attempts: nextAttempts,
            nextRetryAt: Date.now() + backoffMs,
          }
          : item
        ));
      } finally {
        isAutoSyncInFlightRef.current = false;
      }
    };

    const interval = window.setInterval(() => {
      void processQueue();
    }, 5000);

    const onOnline = () => {
      void processQueue();
    };
    window.addEventListener('online', onOnline);

    void processQueue();

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', onOnline);
    };
  }, [firebaseConfigured, user, trips, mergeTripFromSync, usingCollaborativeStore]);

  const handleGoogleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      setSigningIn(false);
      console.error('Google sign-in failed', error);
      const code = (error as { code?: string })?.code || '';
      const message = (error as { message?: string })?.message || '';
      if (code === 'auth/unauthorized-domain') {
        notify({
          title: 'Google Sign-In Failed',
          message: 'Unauthorized domain. Add your app domain in Firebase Auth settings.',
          variant: 'error',
          durationMs: 3600,
        });
        return;
      }
      if (message.includes('no ID token')) {
        notify({
          title: 'Google Sign-In Failed',
          message: 'Missing ID token. Verify Android Firebase setup, SHA fingerprints, and google-services.json.',
          variant: 'error',
          durationMs: 4200,
        });
        return;
      }
      const detail = [code, message].filter(Boolean).join(' | ');
      notify({
        title: 'Google Sign-In Failed',
        message: `${detail || 'Unknown error'}. If this is Android, verify google-services.json and SHA fingerprints, then reinstall.`,
        variant: 'error',
        durationMs: 4200,
      });
    } finally {
      setSigningIn(false);
    }
  }, [notify, signInWithGoogle]);

  const handleGoogleSignOut = useCallback(async () => {
    try {
      await unregisterDeviceToken();
      await logout();
    } catch (error) {
      console.error('Sign-out failed', error);
      notify({ title: 'Sign-Out Failed', message: 'Could not sign out. Please try again.', variant: 'error' });
    }
  }, [logout, notify, unregisterDeviceToken]);

  const handleCloudBackup = useCallback(async () => {
    if (!user) {
      notify({ title: 'Sign In Required', message: 'Sign in with Google first.', variant: 'warning' });
      return;
    }

    if (usingCollaborativeStore) {
      notify({ title: 'Real-time Sync Active', message: 'Shared trips sync automatically in real time.', variant: 'info' });
      return;
    }

    try {
      // Find the current active trip to backup
      const currentTrip = trips.find(t => t.id === activeTrip);
      if (!currentTrip) {
        notify({ title: 'No Active Trip', message: 'No active trip to backup.', variant: 'warning' });
        return;
      }

      await saveTripToCloud(user.uid, currentTrip);
      setLastAutoSyncAt(Date.now());
      setLastSyncAttemptAt(Date.now());
      setAutoSyncError(null);
      notify({ title: 'Backup Saved', message: `Cloud backup saved for "${currentTrip.name}".`, variant: 'success' });
    } catch (error) {
      console.error('Cloud backup failed', error);
      notify({ title: 'Backup Failed', message: 'Check Firestore rules and Firebase config.', variant: 'error' });
    }
  }, [activeTrip, notify, trips, user, usingCollaborativeStore]);

  const handleCloudRestore = useCallback(async () => {
    if (!user) {
      notify({ title: 'Sign In Required', message: 'Sign in with Google first.', variant: 'warning' });
      return;
    }

    if (usingCollaborativeStore) {
      notify({ title: 'Real-time Sync Active', message: 'Trips are already live and shared across members.', variant: 'info' });
      return;
    }

    try {
      const cloudTrips = await loadAllTripsFromCloud(user.uid);
      if (cloudTrips.length === 0) {
        notify({ title: 'No Cloud Backup', message: 'No cloud backups found for this account.', variant: 'info' });
        return;
      }

      // For now, restore the most recent trip
      const tripToRestore = cloudTrips[0];
      if (!tripToRestore.data.setup) {
        notify({ title: 'Restore Failed', message: 'Cloud backup has no trip setup.', variant: 'error' });
        return;
      }

      restoreData(tripToRestore.data.setup, tripToRestore.data.expenses || []);
      setLastAutoSyncAt(Date.now());
      setLastSyncAttemptAt(Date.now());
      setAutoSyncError(null);
      notify({ title: 'Restore Complete', message: `Cloud backup "${tripToRestore.name}" restored successfully.`, variant: 'success' });
    } catch (error) {
      console.error('Cloud restore failed', error);
      notify({ title: 'Restore Failed', message: 'Check Firestore rules and Firebase config.', variant: 'error' });
    }
  }, [notify, restoreData, user, usingCollaborativeStore]);

  // If no setup, force setup screen — but only after IDB hydration to avoid flash
  const isSetup = isHydrated && !!data.setup;
  const shouldShowOnboarding = isHydrated && !isSetup && !onboardingDone;
  const shouldShowNotificationGate = isHydrated && !isSetup && onboardingDone && !notificationGateComplete;
  const shouldShowPreSetupAuthPrompt = isHydrated && !isSetup && onboardingDone && notificationGateComplete && firebaseConfigured && !authLoading && !user && !authPromptDismissed;

  const completeOnboarding = useCallback(() => {
    setOnboardingDone(true);
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // Ignore storage failures in private browsing/storage pressure.
    }
  }, []);

  const handleAuthPromptLater = useCallback(() => {
    setAuthPromptDismissed(true);
    try {
      localStorage.setItem(AUTH_PROMPT_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const handleTripSelect = useCallback((tripId: string) => {
    if (tripId === activeTrip) return;
    const targetName = trips.find((trip) => trip.id === tripId)?.name || 'trip';
    setPendingTripName(targetName);
    setIsTripSwitching(true);
    setActiveTripId(tripId);

    if (tripSwitchTimeoutRef.current !== null) {
      window.clearTimeout(tripSwitchTimeoutRef.current);
    }

    tripSwitchTimeoutRef.current = window.setTimeout(() => {
      setIsTripSwitching(false);
      setPendingTripName('');
    }, 550);
  }, [activeTrip, setActiveTripId, trips]);

  useEffect(() => {
    return () => {
      if (tripSwitchTimeoutRef.current !== null) {
        window.clearTimeout(tripSwitchTimeoutRef.current);
      }
    };
  }, []);

  const handleNameCurrentTrip = useCallback((name: string) => {
    if (!activeTrip) return;
    renameTrip(activeTrip, name);
  }, [activeTrip, renameTrip]);

  const nextRetryAt = useMemo(() => {
    if (usingCollaborativeStore) return null;
    if (syncQueue.length === 0) return null;
    let min = syncQueue[0].nextRetryAt;
    for (let i = 1; i < syncQueue.length; i += 1) {
      if (syncQueue[i].nextRetryAt < min) min = syncQueue[i].nextRetryAt;
    }
    return min;
  }, [syncQueue, usingCollaborativeStore]);

  const closeNotification = useCallback(() => {
    setNotification(null);
  }, []);

  return (
    <Router>
      <DeepLinkHandler />
      <BackButtonGuard />
      <ScrollToTop />
      <NotificationRouteHandler route={pendingNotificationRoute} onHandled={() => setPendingNotificationRoute(null)} />
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 font-sans text-slate-900">
        {/* Signing-in loader overlay */}
        {signingIn && (
          <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm">
            <div className="w-16 h-16 rounded-3xl bg-blue-600 flex items-center justify-center mb-5 shadow-xl shadow-blue-200">
              <svg className="w-8 h-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
            <p className="text-lg font-black text-slate-900">Signing in...</p>
            <p className="text-sm text-slate-500 mt-1">Just a moment</p>
          </div>
        )}
        {/* Migration overlay — shown while local trips are being uploaded to Firestore */}
        {isMigrating && (
          <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/95 backdrop-blur-sm">
            <div className="w-16 h-16 rounded-3xl bg-blue-600 flex items-center justify-center mb-5 shadow-xl shadow-blue-200">
              <svg className="w-8 h-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
            <p className="text-lg font-black text-slate-900">Syncing your trips...</p>
            <p className="text-sm text-slate-500 mt-1">Moving your data to the cloud. Don't close the app.</p>
          </div>
        )}
        {/* Identity picker — shown after joining a shared trip */}
        {showIdentityPicker && usingCollaborativeStore && (data.setup?.participants?.length ?? 0) > 0 && !collaborativeTripStore.myParticipantName && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50">
            <div className="w-full max-w-md bg-white rounded-t-3xl p-6 shadow-2xl"
              style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
              <h3 className="text-lg font-black text-slate-900 mb-1">Who are you in this trip?</h3>
              <p className="text-sm text-slate-500 mb-5">Pick your name so the app knows which settlements are yours.</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {(data.setup?.participants || []).map((name) => {
                  // Check if this name is already claimed by another member
                  const claimedByOther = Object.entries(collaborativeTripStore.identityMap || {}).some(
                    ([uid, n]) => n === name && uid !== user?.uid
                  );
                  return (
                    <button
                      key={name}
                      disabled={claimedByOther}
                      onClick={async () => {
                        if (activeTrip && collaborativeTripStore.claimParticipantIdentity) {
                          await collaborativeTripStore.claimParticipantIdentity(activeTrip, name);
                        }
                        setShowIdentityPicker(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors text-left ${
                        claimedByOther
                          ? 'bg-slate-50 border-slate-100 opacity-40 cursor-not-allowed'
                          : 'bg-slate-50 border-slate-200 hover:bg-blue-50 hover:border-blue-300'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-black flex-shrink-0">
                        {name[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-slate-900">{name}</span>
                        {claimedByOther && (
                          <p className="text-[10px] text-slate-400 mt-0.5">Already claimed by another member</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setShowIdentityPicker(false)}
                className="mt-4 w-full py-3 rounded-2xl bg-slate-100 text-slate-500 text-sm font-semibold"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}
        {/* Join confirmation — shown when app is opened via invite link */}
        {pendingJoinTripId && collaborativeMode && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50">
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="w-full max-w-md bg-white rounded-t-3xl p-6 shadow-2xl"
              style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
            >
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
              <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-black text-slate-900 text-center mb-1">You've been invited!</h3>
              <p className="text-sm text-slate-500 text-center mb-6">
                Join this shared trip and collaborate with your group in real time.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPendingJoinTripId(null)}
                  className="py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm"
                >
                  Decline
                </button>
                <button
                  onClick={async () => {
                    if (!joinTrip || !pendingJoinTripId) return;
                    const joined = await joinTrip(pendingJoinTripId);
                    setPendingJoinTripId(null);
                    if (joined) {
                      setShowIdentityPicker(true);
                    } else {
                      notify({ title: 'Trip not found', message: 'This invite link may have expired.', variant: 'error' });
                    }
                  }}
                  className="py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm"
                >
                  Join trip
                </button>
              </div>
            </motion.div>
          </div>
        )}
        <Routes>
          {!isHydrated ? (
            <Route path="*" element={
              <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
                <div className="text-center">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-600 flex items-center justify-center mb-4 shadow-xl shadow-blue-200">
                    <svg className="w-7 h-7 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-slate-500">Loading your trip...</p>
                </div>
              </div>
            } />
          ) : !isSetup ? (
            <Route
              path="*"
              element={
                shouldShowOnboarding
                  ? <OnboardingScreen onComplete={completeOnboarding} />
                  : shouldShowNotificationGate
                    ? <NotificationPermissionGate />
                    : shouldShowPreSetupAuthPrompt
                    ? <PreSetupAuthPrompt onSignIn={handleGoogleSignIn} onLater={handleAuthPromptLater} />
                    : <SetupScreen onSave={saveSetup} onNameTrip={handleNameCurrentTrip} initialTripName={getActiveTripName()} />
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
              <Route
                path="/settlement"
                element={
                  <Settlement
                    data={data}
                    tripId={activeTrip}
                    userUid={user?.uid || null}
                    userDisplayName={user?.displayName || null}
                    userEmail={user?.email || null}
                    myParticipantName={usingCollaborativeStore ? (collaborativeTripStore.myParticipantName ?? null) : null}
                    isCollaborative={usingCollaborativeStore}
                  />
                }
              />
              <Route path="/settlement-log" element={<SettlementLog tripId={activeTrip} isCollaborative={usingCollaborativeStore} />} />
              <Route path="/trip-details" element={<TripDetails setup={data.setup} onSave={saveSetup} />} />
              <Route path="/members" element={<GroupMemberManager setup={data.setup} onUpdate={saveSetup} claimedNames={usingCollaborativeStore ? Object.values(collaborativeTripStore.identityMap || {}) : []} />} />
              <Route path="/categories" element={<CategoryManager setup={data.setup} onUpdate={saveSetup} />} />
              <Route
                path="/settings"
                element={
                  <Settings
                    onReset={resetTrip}
                    data={data}
                    onImport={restoreData}
                    notify={notify}
                    firebaseConfigured={firebaseConfigured}
                    lastAutoSyncAt={lastAutoSyncAt}
                    lastSyncAttemptAt={lastSyncAttemptAt}
                    autoSyncError={autoSyncError}
                    pendingSyncCount={syncQueue.length}
                    nextRetryAt={nextRetryAt}
                    authLoading={authLoading}
                    userEmail={user?.email || null}
                    onSignInGoogle={handleGoogleSignIn}
                    onSignOutGoogle={handleGoogleSignOut}
                    onCloudBackup={handleCloudBackup}
                    onCloudRestore={handleCloudRestore}
                    notificationsEnabled={notificationsEnabled}
                    notificationPermission={notificationPermission}
                    onEnableNotifications={enableNotificationsFromSettings}
                    onDisableNotifications={disableNotifications}
                    onOpenNotificationSettings={openNotificationSettings}
                    dailyExpenseRemindersEnabled={dailyExpenseRemindersEnabled}
                    pendingSettlementRemindersEnabled={pendingSettlementRemindersEnabled}
                    onDailyExpenseRemindersChange={setDailyExpenseRemindersEnabled}
                    onPendingSettlementRemindersChange={setPendingSettlementRemindersEnabled}
                    trips={trips}
                    activeTrip={activeTrip}
                    onCreateTrip={createTrip}
                    onJoinTrip={joinTrip}
                    onSelectTrip={handleTripSelect}
                    onDeleteTrip={deleteTrip}
                    onRenameTrip={renameTrip}
                  />
                }
              />
              <Route path="/setup" element={<SetupScreen onSave={saveSetup} initialData={data.setup} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>

        {isTripSwitching && (
          <div className="fixed inset-0 z-[120] bg-slate-900/35 backdrop-blur-[2px] flex items-center justify-center px-6">
            <div className="w-full max-w-xs rounded-2xl bg-white shadow-2xl border border-slate-200 p-5 text-center">
              <div className="w-10 h-10 mx-auto rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
              <p className="mt-4 text-sm font-semibold text-slate-900">Switching Trip</p>
              <p className="mt-1 text-xs text-slate-500">Loading {pendingTripName}...</p>
            </div>
          </div>
        )}

        <NotificationCard
          notification={notification}
          onClose={closeNotification}
        />
        
        {isSetup && <BottomNav />}

      </div>
    </Router>
  );
}
