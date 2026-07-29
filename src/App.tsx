import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import googleIcon from './assets/google-icon.png';
import { useTripData } from './hooks/useTripData';
import { useCollaborativeTripData } from './hooks/useCollaborativeTripData';
import { useMemberRegistry } from './hooks/useMemberRegistry';
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
import { PreSetupTripChoice } from './components/PreSetupTripChoice';
import { useFirebaseAuth } from './hooks/useFirebaseAuth';
import { NotificationRoute, useSmartReminders } from './hooks/useSmartReminders';
import { saveTripToCloud, loadAllTripsFromCloud, syncTripIncremental } from './services/cloudTrip';
import { clearAccountScopedStorage } from './utils/privacy';
import { buildDisplayNameMap } from './utils/memberDisplay';

// Navigation paths where pressing the native Android back button should exit the app instead of going back
const EXIT_PATHS = new Set(['/', '/setup']);

// Storage keys used to save app preferences and temporary data in the browser/device
const ONBOARDING_KEY = 'tripspend_onboarding_done_v1';
const SYNC_QUEUE_KEY = 'tripspend_sync_queue_v1';
const PENDING_JOIN_KEY = 'tripspend_pending_join_id';
const WORKSPACE_MODE_KEY = 'tripspend_workspace_mode_v1';

// Structure for items waiting in the offline sync retry queue
interface SyncQueueItem {
  tripId: string;
  enqueuedAt: number;
  attempts: number;
  nextRetryAt: number;
}

// Safely reads any queued background sync tasks saved in local storage
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

// Screen shown to new users asking if they want to create a brand new trip or join an existing one via invite code
const PreSetupChoiceRoute = ({
  defaultJoinTripId,
  onJoinTrip,
  onCreateSetup,
}: {
  defaultJoinTripId?: string | null;
  onJoinTrip: (tripId: string) => Promise<boolean>;
  onCreateSetup: () => void;
}) => {
  const navigate = useNavigate();

  return (
    <PreSetupTripChoice
      onCreateTrip={() => {
        onCreateSetup();
        navigate('/setup');
      }}
      onJoinTrip={onJoinTrip}
      defaultJoinTripId={defaultJoinTripId}
    />
  );
};

// Listens for custom app link URLs (like tripspend://...) clicked on mobile devices to open specific trips or pages
const DeepLinkHandler = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Deep links only apply when running natively inside a mobile app (iOS/Android)
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let handler: { remove: () => Promise<void> } | undefined;

    // Parses custom link strings and redirects the user to the matching screen or join code
    const routeFromUrl = (rawUrl: string) => {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'tripspend:') {
          return;
        }

        const joinTripId = parsed.searchParams.get('joinTripId');
        if (joinTripId) {
          const cleaned = joinTripId.trim();
          if (/^\d{6}$/.test(cleaned)) {
            navigate(`/?joinTripId=${encodeURIComponent(cleaned)}`);
            return;
          }
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

    // Registers the app link listener with native device software
    const registerHandler = async () => {
      handler = await CapacitorApp.addListener('appUrlOpen', (event) => {
        if (event.url) {
          routeFromUrl(event.url);
        }
      });

      // Handle the case where the app was opened directly from a deep link cold-start
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

// Checks the web URL query string for a `?joinTripId=...` parameter and triggers the join flow
const JoinTripQueryHandler = ({
  onJoinTripId,
}: {
  onJoinTripId: (joinTripId: string) => void;
}) => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const joinTripId = params.get('joinTripId');
    if (!joinTripId) return;

    const cleaned = joinTripId.trim();
    // Validate that the trip ID is exactly a 6-digit code
    if (/^\d{6}$/.test(cleaned)) {
      onJoinTripId(cleaned);
    }

    // Clean up the URL by removing the joinTripId parameter from the query string
    params.delete('joinTripId');
    const nextSearch = params.toString();
    navigate({
      pathname: location.pathname,
      search: nextSearch ? `?${nextSearch}` : '',
    }, { replace: true });
  }, [location.pathname, location.search, navigate, onJoinTripId]);

  return null;
};

// Automatically scrolls the window back to the top whenever the page path changes
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
};

// Redirects the user to a specific screen when they tap on a system notification
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

// Handles hardware back button presses on Android devices
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
        // If we are on the home screen or setup screen, close the app. Otherwise, go back one page.
        if (!EXIT_PATHS.has(location.pathname)) {
          navigate(-1);
        } else {
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

// Screen prompting unauthenticated users to sign in with Google before enabling cloud features
const AuthPrompt = ({ onSignIn }: { onSignIn: () => void }) => (
  <div className="min-h-screen px-4 py-8 flex items-center justify-center bg-gradient-to-br from-blue-100 via-purple-100 to-pink-100">
    <div className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl p-8 text-center border border-white/50 backdrop-blur-sm">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-blue-600 flex items-center justify-center mb-6 shadow-xl shadow-blue-200">
        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>

      <h2 className="text-2xl font-black text-slate-900 mb-2">Cloud Sync & Shared Trips</h2>
      <p className="text-slate-500 text-sm mb-8 leading-relaxed px-2">
        Sign in to back up your trips automatically and collaborate with your group in real time.
      </p>

      {/* Google Sign In Button */}
      <button
        type="button"
        onClick={onSignIn}
        className="w-full py-3.5 rounded-full bg-white border-2 border-slate-200 shadow-md hover:shadow-lg hover:border-slate-300 transition-all flex items-center justify-center gap-3 mb-6 font-semibold text-slate-900"
      >
        <img src={googleIcon} alt="" className="w-5 h-5" />
        Sign in with Google
      </button>
    </div>
  </div>
);

// Loading state displayed while waiting for the user to accept push notification permissions
const NotificationPermissionGate = () => (
  <div className="min-h-screen px-4 py-8 flex items-center justify-center bg-gradient-to-br from-blue-100 via-purple-100 to-pink-100">
    <div className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl p-8 text-center">
      <div className="w-10 h-10 mx-auto rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
      <h2 className="mt-5 text-2xl font-black text-slate-900">Enabling notifications</h2>
      <p className="mt-2 text-sm text-slate-500">Please respond to the system permission prompt to continue.</p>
    </div>
  </div>
);

// Main Application Component
export default function App() {
  // Flag tracking if the user has completed the welcome onboarding flow
  const [onboardingDone, setOnboardingDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === '1';
    } catch {
      return false;
    }
  });

  // UI state flags
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
  
  // Stores a trip ID if the user clicked an invite link before logging in
  const [pendingJoinTripId, setPendingJoinTripId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PENDING_JOIN_KEY);
    } catch {
      return null;
    }
  });

  // References used for keeping state up-to-date inside asynchronous callbacks without triggering re-renders
  const lastAutoSyncSignatureRef = useRef('');
  const isAutoSyncInFlightRef = useRef(false);
  const tripSwitchTimeoutRef = useRef<number | null>(null);

  // Track whether the app was previously operating in offline ('local') or cloud ('collaborative') mode
  const [storedWorkspaceMode, setStoredWorkspaceMode] = useState<'local' | 'collaborative'>(() => {
    try {
      const mode = localStorage.getItem(WORKSPACE_MODE_KEY);
      return mode === 'collaborative' ? 'collaborative' : 'local';
    } catch {
      return 'local';
    }
  });

  // Local device storage hook (used for offline trips)
  const localTripStore = useTripData();

  // Firebase Authentication hook
  const {
    user,
    loading: authLoading,
    signInWithGoogle,
    logout,
    isConfigured: firebaseConfigured,
  } = useFirebaseAuth();

  // Cloud collaborative mode is requested whenever Firebase is configured and a user is logged in
  const collaborativeModeRequested = Boolean(firebaseConfigured && user);

  // Use a ref so handleRemoteUpdate can read activeTrip without a stale closure
  // and without needing activeTrip to be declared first
  const activeTripRef = useRef<string | null>(null);
  const cloudAccessDeniedNotificationShownRef = useRef(false);

  // Callback executed when changes are pushed from another device/member
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

  // Hook for handling collaborative cloud trips via Firestore
  const collaborativeTripStore = useCollaborativeTripData({
    userUid: user?.uid || null,
    enabled: collaborativeModeRequested,
    onRemoteUpdate: handleRemoteUpdate,
  });

  // Collaborative mode is active as long as requested and cloud access isn't blocked/denied
  const collaborativeMode = collaborativeModeRequested && !collaborativeTripStore.cloudAccessDenied;

  // Helper flags derived from store states
  const localHasSetup = Boolean(localTripStore.data.setup);
  const localActiveTripId = localTripStore.activeTrip;
  const localTripsForMigration = localTripStore.trips;
  const collaborativeTrips = collaborativeTripStore.trips;
  const collaborativeHasTrips = collaborativeTrips.length > 0;
  const collaborativeHasAnySetup = collaborativeTrips.some((trip) => Boolean(trip.data.setup));

  // Determine whether we should present cloud data or fall back to local data
  useEffect(() => {
    if (!collaborativeModeRequested) {
      setCollabReady(false);
      setIsMigrating(false);
      return;
    }

    if (collaborativeTripStore.cloudAccessDenied) {
      setCollabReady(false);
      setIsMigrating(false);
      return;
    }

    if (collaborativeHasTrips) {
      setCollabReady(true);
      return;
    }

    // Don't decide between cloud/local until the first trips snapshot arrives —
    // deciding on an empty not-yet-loaded list causes flashes and wrong fallbacks.
    if (!collaborativeTripStore.tripsLoaded) {
      return;
    }

    if (!localHasSetup) {
      // New cloud user with no local data — go straight into cloud mode.
      setCollabReady(true);
      return;
    }

    // User has local data but no cloud trips yet.
    // Stay in local mode — they can create/join a cloud trip from Settings,
    // which will set collaborativeHasTrips=true and flip collabReady automatically.
    // Do NOT use a timer here: a mid-session store switch breaks the active UI.
    setCollabReady(false);
    setIsMigrating(false);
  }, [
    collaborativeModeRequested,
    collaborativeHasTrips,
    collaborativeTripStore.cloudAccessDenied,
    collaborativeTripStore.tripsLoaded,
    localHasSetup,
  ]);

  // Select the appropriate data store based on availability and readiness
  const usingCollaborativeStore = collaborativeMode && collabReady;
  const tripStore = usingCollaborativeStore ? collaborativeTripStore : localTripStore;

  // Keep the stored workspace mode updated in localStorage
  useEffect(() => {
    try {
      if (usingCollaborativeStore) {
        localStorage.setItem(WORKSPACE_MODE_KEY, 'collaborative');
        setStoredWorkspaceMode('collaborative');
      } else if (!user && !authLoading) {
        localStorage.setItem(WORKSPACE_MODE_KEY, 'local');
        setStoredWorkspaceMode('local');
      }
    } catch (e) {
      console.error('Failed to save workspace mode to localStorage', e);
    }
  }, [usingCollaborativeStore, user, authLoading]);

  // isHydrated check: Defer rendering the workspace if the last selected workspace was collaborative,
  // keeping the loading screen visible until auth is done and collaborative trip data is fully loaded.
  const isHydrated = useMemo(() => {
    const localHydrated = (localTripStore as typeof localTripStore & { isHydrated?: boolean }).isHydrated ?? false;
    if (storedWorkspaceMode === 'collaborative') {
      if (authLoading) return false;
      if (user) {
        if (collabReady) return true;
        if (collaborativeTripStore.cloudAccessDenied) return localHydrated;
        // Wait only for the first cloud snapshot. Once it has arrived and we
        // still aren't in cloud mode (e.g. local data exists but no cloud
        // trips), fall back to the local store instead of loading forever.
        if (!collaborativeTripStore.tripsLoaded) return false;
        return localHydrated;
      }
    }
    return localHydrated;
  }, [storedWorkspaceMode, authLoading, user, collabReady, collaborativeTripStore.cloudAccessDenied, collaborativeTripStore.tripsLoaded, localTripStore]);

  // Extract functions and data from the active trip store
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
    deleteTrip,
    renameTrip,
    setActiveTripId,
    getActiveTripName,
    mergeTripFromSync,
  } = tripStore;

  // Join should target collaborative store when available so users can accept cloud invites
  // even while the UI is still on local data.
  const canUseCollaborativeActions = collaborativeModeRequested && !collaborativeTripStore.cloudAccessDenied;
  const joinTrip = canUseCollaborativeActions ? collaborativeTripStore.joinTrip : tripStore.joinTrip;
  // Regular create should follow the active store mode.
  const createTrip = tripStore.createTrip;

  // Invite code generation is an explicit cloud action. If the user is already on a
  // shared cloud trip, its doc id *is* the invite code — no new trip needed. Otherwise
  // this is a local-only trip being shared for the first time, so we migrate its actual
  // setup + expenses into the cloud trip rather than creating a disconnected empty one.
  //
  // NOTE: these internal "is this id a cloud trip id" checks intentionally accept any
  // all-digit string (not just exactly 6 digits). Local trip ids always look like
  // `trip_<timestamp>_<random>` (never purely numeric), so `/^\d+$/` still reliably
  // distinguishes a cloud trip id from a local one. Gating on the *current* code length
  // (6) here would silently discard a still-valid trip that was migrated to the cloud
  // before the 6-digit format was restored — new codes are always generated at 6 digits
  // via generateShortCode(), but existing ones must keep working.
  const generateInviteCode = useCallback(async () => {
    if (!collaborativeModeRequested) {
      console.warn('[generateInviteCode] Skipped: collaborative mode not requested (not signed in or Firebase not configured).');
      return null;
    }

    if (usingCollaborativeStore && activeTrip && /^\d+$/.test(activeTrip)) {
      return activeTrip;
    }

    const currentLocalTrip = localTripsForMigration.find((trip) => trip.id === localActiveTripId);
    if (!currentLocalTrip) {
      console.error('[generateInviteCode] No local trip found to migrate.', { localActiveTripId, availableTripIds: localTripsForMigration.map((trip) => trip.id) });
      return null;
    }

    const created = await collaborativeTripStore.importLocalTrips([currentLocalTrip], currentLocalTrip.id);
    if (typeof created === 'string' && /^\d+$/.test(created)) return created;
    console.error('[generateInviteCode] importLocalTrips did not return a usable cloud trip id.', { created });
    return null;
  }, [collaborativeModeRequested, usingCollaborativeStore, activeTrip, localTripsForMigration, localActiveTripId, collaborativeTripStore]);

  // Only the trip's creator may revoke/reactivate its invite code — enforced again
  // server-side by onlyCreatorInviteControl().
  const isActiveTripCreator = usingCollaborativeStore
    ? Boolean(user?.uid) && collaborativeTripStore.tripCreatorUid === user?.uid
    : true;
  const activeTripInviteActive = usingCollaborativeStore
    ? trips.find((trip) => trip.id === activeTrip)?.inviteActive ?? true
    : true;
  const handleToggleInviteActive = useCallback(async (active: boolean) => {
    if (!usingCollaborativeStore || !activeTrip) return false;
    return collaborativeTripStore.setInviteActive(activeTrip, active);
  }, [usingCollaborativeStore, activeTrip, collaborativeTripStore]);

  // Member management interface helper
  const memberRegistryApi = useMemberRegistry({
    setup: data.setup,
    saveSetup,
    isCollaborative: usingCollaborativeStore,
    userUid: user?.uid || null,
    tripCreatorUid: usingCollaborativeStore ? collaborativeTripStore.tripCreatorUid : user?.uid || null,
    identityMap: usingCollaborativeStore ? collaborativeTripStore.identityMap : {},
    tripId: activeTrip,
    removeMemberUid: usingCollaborativeStore ? collaborativeTripStore.removeMemberUid : undefined,
  });
  const displayNames = useMemo(() => buildDisplayNameMap(memberRegistryApi.registry, true), [memberRegistryApi.registry]);

  // Auto-dismiss identity picker if user already has a claimed name (returning user)
  useEffect(() => {
    if (showIdentityPicker && collaborativeTripStore.myMemberId) {
      setShowIdentityPicker(false);
    }
  }, [showIdentityPicker, collaborativeTripStore.myMemberId]);

  // Edge 2: Show identity picker on every session if user is in a collaborative trip but hasn't claimed a name yet
  useEffect(() => {
    if (
      usingCollaborativeStore &&
      !collaborativeTripStore.myMemberId &&
      Object.keys(data.setup?.memberRegistry || {}).length > 0
    ) {
      setShowIdentityPicker(true);
    }
  }, [usingCollaborativeStore, collaborativeTripStore.myMemberId, data.setup?.memberRegistry]);

  // Keep activeTripRef in sync so handleRemoteUpdate can read it without stale closure
  useEffect(() => { activeTripRef.current = activeTrip ?? null; }, [activeTrip]);

  // Handler for receiving and storing join trip IDs from links
  const handleIncomingJoinTripId = useCallback((joinTripId: string) => {
    setPendingJoinTripId(joinTripId);
    try {
      localStorage.setItem(PENDING_JOIN_KEY, joinTripId);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  // Sets the destination screen when triggered from a notification
  const handleNotificationRoute = useCallback((route: NotificationRoute) => {
    setPendingNotificationRoute(route);
  }, []);

  // Display a temporary banner notification inside the app
  const notify = useCallback((payload: NotificationPayload) => {
    setNotification({ ...payload, id: Date.now() });
  }, []);

  useEffect(() => {
    // Reset notification flag when auth state changes
    if (!collaborativeModeRequested) {
      cloudAccessDeniedNotificationShownRef.current = false;
    }
  }, [collaborativeModeRequested]);

  // Show a warning if cloud connectivity fails or permission is denied
  useEffect(() => {
    // Only show the notification once per session when cloud access is denied.
    // Never show it when the user simply has no collaborative trips yet
    // (e.g. a brand new cloud user — no trips have been synced, no denial happened).
    if (
      !collaborativeModeRequested ||
      !collaborativeTripStore.cloudAccessDenied ||
      collaborativeTrips.length === 0  // No trips at all → not a real denial
    ) {
      // Reset the flag if cloud access becomes available again
      if (!collaborativeTripStore.cloudAccessDenied) {
        cloudAccessDeniedNotificationShownRef.current = false;
      }
      return;
    }

    if (cloudAccessDeniedNotificationShownRef.current) return; // Already shown in this session
    cloudAccessDeniedNotificationShownRef.current = true;

    notify({
      title: 'Cloud Sync Unavailable',
      message: 'Shared-trip cloud access is unavailable right now. Your local data stays active, and background cloud backup can still sync when permitted.',
      variant: 'warning',
      durationMs: 5000,
    });
  }, [collaborativeModeRequested, collaborativeTripStore.cloudAccessDenied, collaborativeTrips.length, notify]);

  // Hook for scheduling and managing local push notifications/reminders
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

  // Prompt for notification permissions right after completing onboarding
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
  }, [onboardingDone, notificationGateComplete, notificationPermission, requestInitialNotificationPermission]);

  // Handles Google login action with user feedback
  const handleGoogleSignIn = useCallback(async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign-in failed', error);
      const code = (error as { code?: string })?.code;
      const message = (error as { message?: string })?.message || '';
      if (code === 'auth/cancelled-by-user' || code === 'CANCELLED' || message.includes('cancelled')) {
        return;
      }
      if (code === 'auth/network-request-failed' || message.toLowerCase().includes('network')) {
        notify({
          title: 'Connection Error',
          message: 'Check your internet and try again.',
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
  }, [notify, signInWithGoogle, signingIn]);

  // Handles signing out and clearing account-specific local data
  const handleGoogleSignOut = useCallback(async () => {
    try {
      await unregisterDeviceToken();
      clearAccountScopedStorage();
      await logout();
    } catch (error) {
      console.error('Sign-out failed', error);
      notify({ title: 'Sign-Out Failed', message: 'Could not sign out. Please try again.', variant: 'error' });
    }
  }, [logout, notify, unregisterDeviceToken]);

  // Re-triggers sign-in to switch Google accounts
  const handleSwitchAccount = useCallback(async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Switch account failed', error);
    }
  }, [signInWithGoogle]);

  // Manually triggers a cloud backup for local trips
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

  // Restores a trip backup from the cloud into local storage
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

  // Helper flags determining which screen/modal to display during application boot
  const isSetup = isHydrated && !!data.setup;
  const shouldShowOnboarding = isHydrated && !isSetup && !onboardingDone;
  const shouldShowNotificationGate = isHydrated && !isSetup && onboardingDone && !notificationGateComplete;
  const shouldShowPreSetupAuthPrompt = isHydrated && !isSetup && onboardingDone && notificationGateComplete && firebaseConfigured && !authLoading && !user;
  const shouldShowPreSetupChoice = isHydrated && !isSetup && onboardingDone && notificationGateComplete && !!user;

  // Save onboarding completion status
  const completeOnboarding = useCallback(() => {
    setOnboardingDone(true);
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch { /* ignore */ }
  }, []);

  // Handles switching between different active trips with a brief loading overlay
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

  // Rename the current active trip
  const handleNameCurrentTrip = useCallback((name: string) => {
    if (!activeTrip) return;
    renameTrip(activeTrip, name);
  }, [activeTrip, renameTrip]);

  // Calculate when the next offline sync attempt should occur
  const nextRetryAt = useMemo(() => {
    if (usingCollaborativeStore) return null;
    if (syncQueue.length === 0) return null;
    let min = syncQueue[0].nextRetryAt;
    for (let i = 1; i < syncQueue.length; i += 1) {
      if (syncQueue[i].nextRetryAt < min) min = syncQueue[i].nextRetryAt;
    }
    return min;
  }, [syncQueue, usingCollaborativeStore]);

  // Dismiss banner notification
  const closeNotification = useCallback(() => {
    setNotification(null);
  }, []);

  // Clear pending trip join invitation
  const handleDismissPendingJoin = useCallback(() => {
    setPendingJoinTripId(null);
    try {
      localStorage.removeItem(PENDING_JOIN_KEY);
    } catch { /* ignore */ }
  }, []);

  return (
    <Router>
      <DeepLinkHandler />
      <BackButtonGuard />
      <ScrollToTop />
      <JoinTripQueryHandler onJoinTripId={handleIncomingJoinTripId} />
      <NotificationRouteHandler route={pendingNotificationRoute} onHandled={() => setPendingNotificationRoute(null)} />
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 font-sans text-slate-900">
        
        {/* Sign-in overlay indicator */}
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

        {/* Data migration overlay indicator */}
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

        {/* Modal popup when receiving a trip invitation code/link */}
        {pendingJoinTripId && (
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

              {!user ? (
                <div className="space-y-3">
                  <button
                    onClick={handleGoogleSignIn}
                    className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-3"
                  >
                    <img src={googleIcon} alt="" className="w-5 h-5 brightness-0 invert" />
                    Sign in to join
                  </button>
                  <button
                    onClick={handleDismissPendingJoin}
                    className="w-full py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm"
                  >
                    Decline
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handleDismissPendingJoin}
                    className="py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm"
                  >
                    Decline
                  </button>
                  <button
                    onClick={async () => {
                      if (!joinTrip || !pendingJoinTripId) return;
                      const joined = await joinTrip(pendingJoinTripId);
                      handleDismissPendingJoin();
                      if (joined) {
                        setShowIdentityPicker(true);
                      } else {
                        notify({ title: 'Trip not found', message: 'This invite code is invalid or expired.', variant: 'error' });
                      }
                    }}
                    className="py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm"
                  >
                    Join trip
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}

        {/* Identity selection modal prompting the user to select which member in the shared trip they are */}
        {showIdentityPicker && usingCollaborativeStore && Object.keys(data.setup?.memberRegistry || {}).length > 0 && !collaborativeTripStore.myMemberId && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50">
            <div className="w-full max-w-md bg-white rounded-t-3xl p-6 shadow-2xl"
              style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
              <h3 className="text-lg font-black text-slate-900 mb-1">Who are you in this trip?</h3>
              <p className="text-sm text-slate-500 mb-5">Pick your member slot so the app knows which settlements are yours.</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {Object.values(data.setup?.memberRegistry || {}).map((member) => {
                  const claimedByOther = Object.entries(collaborativeTripStore.identityMap || {}).some(
                    ([uid, mappedMemberId]) => mappedMemberId === member.memberId && uid !== user?.uid
                  );
                  const inactive = member.isActive === false;
                  return (
                    <button
                      key={member.memberId}
                      disabled={claimedByOther}
                      onClick={async () => {
                        if (activeTrip && collaborativeTripStore.claimMemberIdentity) {
                          await collaborativeTripStore.claimMemberIdentity(activeTrip, member.memberId);
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
                        {(displayNames[member.memberId] || member.name)[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`font-semibold ${inactive ? 'text-slate-500' : 'text-slate-900'}`}>{displayNames[member.memberId] || member.name}</span>
                        {claimedByOther && (
                          <p className="text-[10px] text-slate-400 mt-0.5">Already claimed by another member</p>
                        )}
                        {inactive && !claimedByOther && (
                          <p className="text-[10px] text-slate-400 mt-0.5">Member left the trip</p>
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

        {/* Primary Page Route Definitions */}
        <Routes>
          {!isHydrated ? (
            /* Loading screen shown while storage and auth states are initializing */
            <Route path="*" element={
              <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
                <div className="text-center">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-600 flex items-center justify-center mb-4 shadow-xl shadow-blue-200">
                    <svg className="w-7 h-7 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  </div>
                  <p className="text-sm font-bold text-slate-900">Loading your data...</p>
                </div>
              </div>
            } />
          ) : shouldShowOnboarding ? (
            /* Welcome / Walkthrough screens for brand new installations */
            <Route path="*" element={<OnboardingScreen onComplete={completeOnboarding} />} />
          ) : shouldShowNotificationGate ? (
            /* Push notification request screen */
            <Route path="*" element={<NotificationPermissionGate />} />
          ) : shouldShowPreSetupAuthPrompt ? (
            /* Sign-in prompt prior to initial trip creation */
            <Route path="*" element={<AuthPrompt onSignIn={handleGoogleSignIn} />} />
          ) : shouldShowPreSetupChoice ? (
            /* Choose between joining a trip or creating a new one */
            <>
              <Route
                path="/setup"
                element={<SetupScreen onSave={saveSetup} initialData={data.setup} onNameTrip={handleNameCurrentTrip} />}
              />
              <Route
                path="*"
                element={
                  <PreSetupChoiceRoute
                    onCreateSetup={completeOnboarding}
                    onJoinTrip={async (tripId: string) => {
                      if (!joinTrip) return false;
                      const joined = await joinTrip(tripId);
                      if (!joined) {
                        notify({ title: 'Trip not found', message: 'Check the Trip ID and try again.', variant: 'error' });
                      }
                      return joined;
                    }}
                    defaultJoinTripId={pendingJoinTripId}
                  />
                }
              />
            </>
          ) : !isSetup ? (
            /* Setup wizard for configuring initial trip currency, members, and details */
            <Route
              path="*"
              element={<SetupScreen onSave={saveSetup} initialData={data.setup} onNameTrip={handleNameCurrentTrip} />}
            />
          ) : (
            /* Main Application Navigation Routes */
            <>
              {/* Home Dashboard */}
              <Route
                path="/"
                element={
                  <Dashboard
                    data={data}
                    onSaveSetup={saveSetup}
                    onAddExpense={addExpense}
                    onUpdateExpense={updateExpense}
                    onDeleteExpense={deleteExpense}
                    onUndoDelete={undoDeleteExpense}
                    canUndoDelete={canUndoDelete}
                    onNameCurrentTrip={handleNameCurrentTrip}
                    onSelectTrip={handleTripSelect}
                    trips={trips}
                    activeTrip={activeTrip}
                    onCreateTrip={createTrip}
                    onGenerateInviteCode={generateInviteCode}
                    onJoinTrip={joinTrip}
                    onDeleteTrip={deleteTrip}
                    onRenameTrip={renameTrip}
                    notify={notify}
                    isCollaborative={usingCollaborativeStore}
                    userUid={user?.uid || null}
                    myMemberId={collaborativeTripStore.myMemberId}
                    identityMap={collaborativeTripStore.identityMap}
                    isTripCreator={isActiveTripCreator}
                    inviteActive={activeTripInviteActive}
                    onToggleInviteActive={handleToggleInviteActive}
                  />
                }
              />
              {/* Analytics & Charts */}
              <Route
                path="/analytics"
                element={
                  <Analytics
                    data={data}
                    isCollaborative={usingCollaborativeStore}
                  />
                }
              />
              {/* Balance & Debt Settlements */}
              <Route
                path="/settlement"
                element={
                  <Settlement
                    setup={data.setup}
                    expenses={data.expenses}
                    isCollaborative={usingCollaborativeStore}
                    userUid={user?.uid || null}
                    tripId={activeTrip}
                    tripCreatorUid={usingCollaborativeStore ? collaborativeTripStore.tripCreatorUid : user?.uid || null}
                    identityMap={collaborativeTripStore.identityMap}
                    myMemberId={collaborativeTripStore.myMemberId}
                  />
                }
              />
              {/* Log of Past Settlements */}
              <Route
                path="/settlement-log"
                element={
                  <SettlementLog
                    isCollaborative={usingCollaborativeStore}
                    tripId={activeTrip}
                    userUid={user?.uid || null}
                    setup={data.setup}
                  />
                }
              />
              {/* Create Expense */}
              <Route
                path="/add"
                element={
                  <AddExpense
                    setup={data.setup}
                    onAdd={addExpense}
                    onUpdate={updateExpense}
                    expenses={data.expenses}
                    presets={presets}
                    onAddPreset={addPreset}
                    onToggleFavorite={togglePresetFavorite}
                    isCollaborative={usingCollaborativeStore}
                    userUid={user?.uid || null}
                    myMemberId={collaborativeTripStore.myMemberId}
                  />
                }
              />
              {/* Edit Expense */}
              <Route
                path="/edit/:id"
                element={
                  <AddExpense
                    setup={data.setup}
                    onAdd={addExpense}
                    onUpdate={updateExpense}
                    expenses={data.expenses}
                    presets={presets}
                    onAddPreset={addPreset}
                    onToggleFavorite={togglePresetFavorite}
                    isCollaborative={usingCollaborativeStore}
                    userUid={user?.uid || null}
                    myMemberId={collaborativeTripStore.myMemberId}
                  />
                }
              />
              {/* Detailed Expense View */}
              <Route
                path="/expense/:id"
                element={
                  <ExpenseDetail
                    expenses={data.expenses}
                    setup={data.setup}
                    onUpdate={updateExpense}
                    onDelete={deleteExpense}
                    isCollaborative={usingCollaborativeStore}
                    userUid={user?.uid || null}
                    myMemberId={collaborativeTripStore.myMemberId}
                  />
                }
              />
              {/* All Expenses List View */}
              <Route
                path="/expenses"
                element={
                  <ExpenseList
                    expenses={data.expenses}
                    setup={data.setup}
                    onDelete={deleteExpense}
                    onUndoDelete={undoDeleteExpense}
                    canUndoDelete={canUndoDelete}
                    isCollaborative={usingCollaborativeStore}
                    userUid={user?.uid || null}
                    myMemberId={collaborativeTripStore.myMemberId}
                  />
                }
              />
              {/* Trip Configuration Details */}
              <Route
                path="/trip-details"
                element={
                  <TripDetails
                    setup={data.setup}
                    onSave={saveSetup}
                  />
                }
              />
              {/* Group Members Management */}
              <Route
                path="/members"
                element={
                  <GroupMemberManager
                    setup={data.setup}
                    expenses={data.expenses}
                    onUpdate={saveSetup}
                    isCollaborative={usingCollaborativeStore}
                    userUid={user?.uid || null}
                    tripCreatorUid={usingCollaborativeStore ? collaborativeTripStore.tripCreatorUid : user?.uid || null}
                    identityMap={collaborativeTripStore.identityMap}
                    tripId={activeTrip}
                  />
                }
              />
              {/* Category Management */}
              <Route path="/categories" element={<CategoryManager setup={data.setup} onUpdate={saveSetup} />} />
              {/* App & Account Settings */}
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
                    onSwitchAccount={handleSwitchAccount}
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
                    onGenerateInviteCode={generateInviteCode}
                    onJoinTrip={joinTrip}
                    onSelectTrip={handleTripSelect}
                    onDeleteTrip={deleteTrip}
                    onRenameTrip={renameTrip}
                    isTripCreator={isActiveTripCreator}
                    inviteActive={activeTripInviteActive}
                    onToggleInviteActive={handleToggleInviteActive}
                  />
                }
              />
              {/* Edit Trip Setup Screen */}
              <Route path="/setup" element={<SetupScreen onSave={saveSetup} initialData={data.setup} onNameTrip={handleNameCurrentTrip} />} />
              {/* Fallback route redirecting unknown paths back home */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>

        {/* Transition overlay shown when switching between active trips */}
        {isTripSwitching && (
          <div className="fixed inset-0 z-[120] bg-slate-900/35 backdrop-blur-[2px] flex items-center justify-center px-6">
            <div className="w-full max-w-xs rounded-2xl bg-white shadow-2xl border border-slate-200 p-5 text-center">
              <div className="w-10 h-10 mx-auto rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
              <p className="mt-4 text-sm font-semibold text-slate-900">Switching Trip</p>
              <p className="mt-1 text-xs text-slate-500">Loading {pendingTripName}...</p>
            </div>
          </div>
        )}

        {/* Global Toast Notification Popup */}
        <NotificationCard
          notification={notification}
          onClose={closeNotification}
        />
        
        {/* Bottom Navigation Bar */}
        {isSetup && <BottomNav />}

      </div>
    </Router>
  );
}
