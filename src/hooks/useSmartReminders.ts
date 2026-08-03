import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import { AndroidSettings, IOSSettings, NativeSettings } from 'capacitor-native-settings';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { NotificationPayload } from '../components/NotificationCard';
import { firestore } from '../lib/firebase';
import { TripData, calculateSettlement } from '../utils/calculations.ts';
import { loadSettledTransfers } from '../utils/settlements.ts';

const NOTIFICATION_PREFS_KEY = 'tripspend_notification_prefs_v1';
const NOTIFICATION_DEVICE_ID_KEY = 'tripspend_notification_device_id_v1';
const NOTIFICATION_TOKEN_KEY = 'tripspend_notification_token_v1';
const NOTIFICATION_DAILY_HOUR = 20;
const NOTIFICATION_DAILY_MINUTE = 0;
const NOTIFICATION_SETTLEMENT_HOUR = 9;
const NOTIFICATION_SETTLEMENT_MINUTE = 0;
const NOTIFICATION_HORIZON_DAYS = 30;
const NOTIFICATION_CHANNEL_ID = 'tripspend_reminders';

type NotificationPermissionState = 'prompt' | 'granted' | 'denied';

export type NotificationRoute = {
  screen?: 'add' | 'settlement' | 'expense' | 'dashboard';
  tripId?: string;
  expenseId?: string;
  reminderKind?: 'daily' | 'settlement';
  dateKey?: string;
};

interface SmartReminderPreferences {
  enabled: boolean;
  dailyExpense: boolean;
  pendingSettlement: boolean;
}

interface UseSmartRemindersInput {
  tripId: string | null;
  data: TripData;
  notify: (payload: NotificationPayload) => void;
  onNavigateNotification: (route: NotificationRoute) => void;
  userUid?: string | null;
}

interface SmartReminderState {
  notificationsEnabled: boolean;
  dailyExpenseRemindersEnabled: boolean;
  pendingSettlementRemindersEnabled: boolean;
  pushToken: string | null;
  notificationPermission: NotificationPermissionState;
  requestInitialNotificationPermission: () => Promise<void>;
  enableNotificationsFromSettings: () => Promise<void>;
  disableNotifications: () => Promise<void>;
  openNotificationSettings: () => Promise<void>;
  setDailyExpenseRemindersEnabled: (enabled: boolean) => void;
  setPendingSettlementRemindersEnabled: (enabled: boolean) => void;
  unregisterDeviceToken: () => Promise<void>;
}

const defaultPreferences: SmartReminderPreferences = {
  enabled: false,
  dailyExpense: true,
  pendingSettlement: true,
};

const isNative = () => Capacitor.isNativePlatform();

const readPreferences = (): SmartReminderPreferences => {
  try {
    const raw = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (!raw) return defaultPreferences;
    const parsed = JSON.parse(raw) as Partial<SmartReminderPreferences>;
    return {
      enabled: parsed.enabled ?? defaultPreferences.enabled,
      dailyExpense: parsed.dailyExpense ?? defaultPreferences.dailyExpense,
      pendingSettlement: parsed.pendingSettlement ?? defaultPreferences.pendingSettlement,
    };
  } catch {
    return defaultPreferences;
  }
};

const savePreferences = (preferences: SmartReminderPreferences) => {
  try {
    localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore storage failures.
  }
};

const readStoredString = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStoredString = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
};

const removeStoredString = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
};

const readSecureToken = async (): Promise<string | null> => {
  if (!isNative()) return readStoredString(NOTIFICATION_TOKEN_KEY);
  try {
    const { value } = await Preferences.get({ key: NOTIFICATION_TOKEN_KEY });
    return value;
  } catch {
    return readStoredString(NOTIFICATION_TOKEN_KEY);
  }
};

const writeSecureToken = async (value: string | null) => {
  if (!isNative()) {
    if (value) writeStoredString(NOTIFICATION_TOKEN_KEY, value);
    else removeStoredString(NOTIFICATION_TOKEN_KEY);
    return;
  }

  try {
    if (value) {
      await Preferences.set({ key: NOTIFICATION_TOKEN_KEY, value });
    } else {
      await Preferences.remove({ key: NOTIFICATION_TOKEN_KEY });
    }
  } catch {
    if (value) writeStoredString(NOTIFICATION_TOKEN_KEY, value);
    else removeStoredString(NOTIFICATION_TOKEN_KEY);
  }
};

const ensureDeviceId = (): string => {
  const stored = readStoredString(NOTIFICATION_DEVICE_ID_KEY);
  if (stored) return stored;
  const next = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  writeStoredString(NOTIFICATION_DEVICE_ID_KEY, next);
  return next;
};

const getNotificationId = (tripId: string, kind: 'daily' | 'settlement', dateKey: string) => {
  const input = `${tripId}:${kind}:${dateKey}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash & 0x7fffffff) || 1;
};

const getNotificationDedupKey = (tripId: string, kind: 'daily' | 'settlement', dateKey: string) =>
  `tripspend_notification_seen_${tripId}_${kind}_${dateKey}`;

const canSendBrowserNotification = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

const sendBrowserNotification = (title: string, message: string) => {
  if (!canSendBrowserNotification()) return;
  new Notification(title, { body: message });
};

const buildTripDataSignature = (data: TripData) => JSON.stringify({
  setup: data.setup,
  expensesCount: data.expenses.length,
  newestExpenseId: data.expenses[0]?.id || null,
  newestExpenseUpdatedAt: data.expenses[0]?.updatedAt || null,
  deletedCount: Object.keys(data.deletedExpenseMap || {}).length,
});

const toDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

const setNotificationTime = (date: Date, hour: number, minute: number) => {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
};

const openSystemNotificationSettings = async () => {
  if (!isNative()) return;

  try {
    if (Capacitor.getPlatform() === 'android') {
      await NativeSettings.openAndroid({ option: AndroidSettings.AppNotification });
      return;
    }

    await NativeSettings.openIOS({ option: IOSSettings.AppNotification });
  } catch {
    // Fallback to broader app settings if notification-specific screen is unavailable.
    if (Capacitor.getPlatform() === 'android') {
      await NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails });
      return;
    }

    await NativeSettings.openIOS({ option: IOSSettings.App });
  }
};

const getNativeNotificationPermission = async (): Promise<NotificationPermissionState> => {
  if (!isNative()) {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'granted' : 'prompt';
  }

  const [localPermission, pushPermission] = await Promise.all([
    LocalNotifications.checkPermissions(),
    PushNotifications.checkPermissions(),
  ]);

  if (Capacitor.getPlatform() === 'android') {
    if (localPermission.display === 'denied' || pushPermission.receive === 'denied') return 'denied';
    if (localPermission.display === 'granted' || pushPermission.receive === 'granted') return 'granted';
    return 'prompt';
  }

  if (localPermission.display === 'denied' || pushPermission.receive === 'denied') return 'denied';
  if (localPermission.display === 'granted' && pushPermission.receive === 'granted') return 'granted';
  return 'prompt';
};

const requestNativeNotificationPermission = async (): Promise<NotificationPermissionState> => {
  if (!isNative()) {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'granted' : 'prompt';
  }

  await ensureNativeChannels();
  const [localRequest, pushRequest] = await Promise.all([
    LocalNotifications.requestPermissions(),
    PushNotifications.requestPermissions(),
  ]);

  if (Capacitor.getPlatform() === 'android') {
    if (localRequest.display === 'denied' || pushRequest.receive === 'denied') return 'denied';
    if (localRequest.display === 'granted' || pushRequest.receive === 'granted') return 'granted';
    return 'prompt';
  }

  if (localRequest.display === 'granted' && pushRequest.receive === 'granted') return 'granted';
  if (localRequest.display === 'denied' || pushRequest.receive === 'denied') return 'denied';
  return 'prompt';
};

const ensureNativeChannels = async () => {
  if (!isNative()) return;

  try {
    await Promise.all([
      LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'TripSpend reminders',
        description: 'TripSpend reminder notifications',
        importance: 4,
        visibility: 1,
        vibration: true,
        lights: true,
      }),
      PushNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'TripSpend reminders',
        description: 'TripSpend reminder notifications',
        importance: 4,
        visibility: 1,
        vibration: true,
        lights: true,
      }),
    ]);
  } catch {
    // Ignore channel creation failures; the SDK can still fall back to defaults.
  }
};

const isNotificationRoute = (value: unknown): value is NotificationRoute => {
  if (!value || typeof value !== 'object') return false;
  const payload = value as NotificationRoute;
  return typeof payload === 'object';
};

const extractRoute = (value: unknown): NotificationRoute | null => {
  if (!isNotificationRoute(value)) return null;
  return {
    screen: value.screen,
    tripId: value.tripId,
    expenseId: value.expenseId,
    reminderKind: value.reminderKind,
    dateKey: value.dateKey,
  };
};

export function useSmartReminders({ tripId, data, notify, onNavigateNotification, userUid }: UseSmartRemindersInput): SmartReminderState {
  const [preferences, setPreferences] = useState<SmartReminderPreferences>(() => readPreferences());
  const [permissionState, setPermissionState] = useState<NotificationPermissionState>('prompt');
  const [pushToken, setPushToken] = useState<string | null>(() => readStoredString(NOTIFICATION_TOKEN_KEY));
  const [nowTick, setNowTick] = useState(0);
  const appActiveRef = useRef(true);
  const pendingEnableFromSettingsRef = useRef(false);
  const scheduledIdsRef = useRef<number[]>([]);
  const scheduledSignatureRef = useRef('');
  const deviceIdRef = useRef(ensureDeviceId());
  const nativeListenersReadyRef = useRef(false);
  const lastDeliveredReminderKeyRef = useRef<string | null>(null);
  const notificationsEnabledRef = useRef(false);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    void (async () => {
      const token = await readSecureToken();
      if (token) setPushToken(token);
    })();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((value) => value + 1), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const currentNow = useMemo(() => new Date(), [nowTick]);
  const today = useMemo(() => startOfDay(currentNow), [currentNow]);
  const todayKey = useMemo(() => toDateKey(today), [today]);

  const notificationsActive = preferences.enabled && permissionState === 'granted';

  useEffect(() => {
    notificationsEnabledRef.current = notificationsActive;
  }, [notificationsActive]);

  const tripDataSignature = useMemo(() => buildTripDataSignature(data), [data]);

  const settlementSummary = useMemo(() => {
    if (!notificationsActive || !preferences.pendingSettlement || !data.setup) return null;
    return calculateSettlement(data.setup, data.expenses);
  }, [data.expenses, data.setup, notificationsActive, preferences.pendingSettlement]);

  const settledTransfers = useMemo(() => {
    if (!settlementSummary) return [];
    const currentTransferKeys = new Set<string>();
    for (let i = 0; i < settlementSummary.transfers.length; i += 1) {
      const transfer = settlementSummary.transfers[i];
      currentTransferKeys.add(`${transfer.from}|${transfer.to}|${Math.round(transfer.amount * 100)}`);
    }
    return loadSettledTransfers().filter((transfer) => currentTransferKeys.has(`${transfer.from}|${transfer.to}|${Math.round(transfer.amount * 100)}`));
  }, [settlementSummary]);

  const pendingTransfers = useMemo(() => {
    if (!settlementSummary) return [];
    const settledKeySet = new Set<string>();
    for (let i = 0; i < settledTransfers.length; i += 1) {
      const transfer = settledTransfers[i];
      settledKeySet.add(`${transfer.from}|${transfer.to}|${Math.round(transfer.amount * 100)}`);
    }
    return settlementSummary.transfers.filter((transfer) => !settledKeySet.has(`${transfer.from}|${transfer.to}|${Math.round(transfer.amount * 100)}`));
  }, [settlementSummary, settledTransfers]);

  const recordDeliveredReminder = useCallback((dedupKey: string, payload: NotificationPayload) => {
    if (lastDeliveredReminderKeyRef.current === dedupKey) return;
    lastDeliveredReminderKeyRef.current = dedupKey;

    try {
      if (localStorage.getItem(dedupKey) === '1') return;
      localStorage.setItem(dedupKey, '1');
    } catch {
      // Ignore storage failures and still surface the notification.
    }

    notify(payload);
    sendBrowserNotification(payload.title, payload.body ?? payload.message ?? '');
  }, [notify]);

  const routeFromNotification = useCallback((rawData: unknown) => {
    const route = extractRoute(rawData);
    if (!route) return;
    onNavigateNotification(route);
  }, [onNavigateNotification]);

  const clearScheduledReminders = useCallback(async () => {
    if (!isNative() || scheduledIdsRef.current.length === 0) return;
    const descriptors = scheduledIdsRef.current.map((id) => ({ id }));
    scheduledIdsRef.current = [];
    scheduledSignatureRef.current = '';

    try {
      await LocalNotifications.cancel({ notifications: descriptors as never[] });
    } catch {
      // Ignore cancel failures.
    }
  }, []);

  const persistTokenForUser = useCallback(async (token: string | null) => {
    setPushToken(token);
    await writeSecureToken(token);

    if (!userUid || !firestore) return;

    const tokenRef = doc(firestore, 'users', userUid, 'notificationTokens', deviceIdRef.current);
    if (!token) {
      await deleteDoc(tokenRef).catch(() => {});
      return;
    }

    await setDoc(tokenRef, {
      token,
      platform: Capacitor.getPlatform(),
      deviceId: deviceIdRef.current,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }, [userUid]);

  const unregisterDeviceToken = useCallback(async () => {
    if (isNative()) {
      try {
        await PushNotifications.unregister();
      } catch {
        // Ignore unregister failures.
      }
    }

    await persistTokenForUser(null);
  }, [persistTokenForUser]);

  const scheduleLocalReminders = useCallback(async () => {
    if (!isNative() || !notificationsActive || !data.setup || !tripId) {
      await clearScheduledReminders();
      return;
    }

    const nextNotifications: Array<{
      id: number;
      title: string;
      body: string;
      schedule: { at: Date; allowWhileIdle: boolean };
      channelId: string;
      extra: NotificationRoute & { dedupKey: string };
      autoCancel: boolean;
    }> = [];

    const expenseDateSet = new Set<string>();
    for (let i = 0; i < data.expenses.length; i += 1) {
      expenseDateSet.add(data.expenses[i].date);
    }

    const tripStartDate = data.setup.startDate ? startOfDay(parseISO(data.setup.startDate)) : null;
    const tripEndDate = data.setup.endDate ? startOfDay(parseISO(data.setup.endDate)) : null;

    if (tripStartDate && tripEndDate && preferences.dailyExpense) {
      for (let day = startOfDay(currentNow > tripStartDate ? currentNow : tripStartDate); !isAfter(day, tripEndDate); day = addDays(day, 1)) {
        const dateKey = toDateKey(day);
        if (expenseDateSet.has(dateKey)) continue;

        const scheduledAt = setNotificationTime(day, NOTIFICATION_DAILY_HOUR, NOTIFICATION_DAILY_MINUTE);
        if (isBefore(scheduledAt, currentNow) && dateKey !== todayKey) continue;

        const dedupKey = getNotificationDedupKey(tripId, 'daily', dateKey);
        nextNotifications.push({
          id: getNotificationId(tripId, 'daily', dateKey),
          title: 'Daily expense reminder',
          body: 'No expense has been recorded today yet. Add it now so your trip budget stays accurate.',
          schedule: { at: scheduledAt > currentNow ? scheduledAt : new Date(currentNow.getTime() + 5 * 60 * 1000), allowWhileIdle: true },
          channelId: NOTIFICATION_CHANNEL_ID,
          extra: {
            screen: 'add',
            tripId,
            reminderKind: 'daily',
            dateKey,
            dedupKey,
          },
          autoCancel: true,
        });
      }
    }

    if (tripEndDate && preferences.pendingSettlement) {
      const hasPendingTransfers = pendingTransfers.length > 0;
      if (hasPendingTransfers) {
        const horizonEnd = addDays(tripEndDate, NOTIFICATION_HORIZON_DAYS);
        for (let day = addDays(startOfDay(currentNow > tripEndDate ? currentNow : tripEndDate), 1); !isAfter(day, horizonEnd); day = addDays(day, 1)) {
          const dateKey = toDateKey(day);
          const scheduledAt = setNotificationTime(day, NOTIFICATION_SETTLEMENT_HOUR, NOTIFICATION_SETTLEMENT_MINUTE);
          if (isBefore(scheduledAt, currentNow) && dateKey !== todayKey) continue;

          const dedupKey = getNotificationDedupKey(tripId, 'settlement', dateKey);
          const pendingTotal = pendingTransfers.reduce((sum, transfer) => sum + transfer.amount, 0);
          nextNotifications.push({
            id: getNotificationId(tripId, 'settlement', dateKey),
            title: 'Pending settlement reminder',
            body: `${pendingTransfers.length} settlement${pendingTransfers.length > 1 ? 's' : ''} are still pending, totaling Rs ${pendingTotal.toFixed(0)}.`,
            schedule: { at: scheduledAt > currentNow ? scheduledAt : new Date(currentNow.getTime() + 5 * 60 * 1000), allowWhileIdle: true },
            channelId: NOTIFICATION_CHANNEL_ID,
            extra: {
              screen: 'settlement',
              tripId,
              reminderKind: 'settlement',
              dateKey,
              dedupKey,
            },
            autoCancel: true,
          });
        }
      }
    }

    const nextSignature = nextNotifications.map((notification) => notification.id).sort((a, b) => a - b).join(',');
    if (nextSignature === scheduledSignatureRef.current) return;

    await clearScheduledReminders();

    if (nextNotifications.length === 0) return;

    try {
      await LocalNotifications.schedule({ notifications: nextNotifications as never[] });
      scheduledIdsRef.current = nextNotifications.map((notification) => notification.id);
      scheduledSignatureRef.current = nextSignature;
    } catch {
      // If scheduling fails, keep the app usable and fall back to in-app reminders.
    }
  }, [
    clearScheduledReminders,
    currentNow,
    data.expenses,
    data.setup,
    notificationsActive,
    pendingTransfers,
    preferences.dailyExpense,
    preferences.pendingSettlement,
    todayKey,
    tripId,
  ]);

  const syncPermissionAndRegistration = useCallback(async () => {
    if (!isNative()) return;

    try {
      await ensureNativeChannels();
      const permission = await getNativeNotificationPermission();
      setPermissionState(permission);

      if (permission !== 'granted') {
        await clearScheduledReminders();
        await unregisterDeviceToken();
        if (preferences.enabled) {
          setPreferences((prev) => ({ ...prev, enabled: false }));
        }
        return;
      }

      if (preferences.enabled) {
        try {
          await PushNotifications.register();
        } catch {
          // Continue with local reminders even if push registration fails.
        }
        await scheduleLocalReminders();
      }
    } catch {
      // Ignore sync failures and let the app continue.
    }
  }, [clearScheduledReminders, preferences.enabled, scheduleLocalReminders, unregisterDeviceToken]);

  // The native listener registration effect below must run exactly once per app
  // lifetime -- nativeListenersReadyRef enforces that (Capacitor plugin listeners
  // should not be re-added). But several of the functions its listeners call
  // (scheduleLocalReminders, syncPermissionAndRegistration, persistTokenForUser)
  // change identity often -- e.g. whenever trip data or preferences.enabled
  // changes. Previously those were in the effect's own dependency array, which
  // meant the effect legitimately re-ran on those changes; its cleanup then
  // removed the real native listeners, but nativeListenersReadyRef blocked the
  // re-run's setup() from ever re-registering them -- silently and permanently
  // disabling push/local notification handling for the rest of the session
  // after almost any app activity. Keeping "latest" refs here lets the effect
  // register its listeners exactly once while those listeners still always call
  // through to the current logic instead of a stale, mount-time closure.
  const notifyRef = useRef(notify);
  const recordDeliveredReminderRef = useRef(recordDeliveredReminder);
  const routeFromNotificationRef = useRef(routeFromNotification);
  const persistTokenForUserRef = useRef(persistTokenForUser);
  const scheduleLocalRemindersRef = useRef(scheduleLocalReminders);
  const syncPermissionAndRegistrationRef = useRef(syncPermissionAndRegistration);
  notifyRef.current = notify;
  recordDeliveredReminderRef.current = recordDeliveredReminder;
  routeFromNotificationRef.current = routeFromNotification;
  persistTokenForUserRef.current = persistTokenForUser;
  scheduleLocalRemindersRef.current = scheduleLocalReminders;
  syncPermissionAndRegistrationRef.current = syncPermissionAndRegistration;

  useEffect(() => {
    let appListener: { remove: () => Promise<void> } | undefined;
    let pushRegistrationListener: { remove: () => Promise<void> } | undefined;
    let pushRegistrationErrorListener: { remove: () => Promise<void> } | undefined;
    let pushReceivedListener: { remove: () => Promise<void> } | undefined;
    let pushActionListener: { remove: () => Promise<void> } | undefined;
    let localReceivedListener: { remove: () => Promise<void> } | undefined;
    let localActionListener: { remove: () => Promise<void> } | undefined;

    const setup = async () => {
      if (!isNative() || nativeListenersReadyRef.current) return;
      nativeListenersReadyRef.current = true;

      await ensureNativeChannels();

      pushRegistrationListener = await PushNotifications.addListener('registration', async (token) => {
        await persistTokenForUserRef.current(token.value);
      });

      pushRegistrationErrorListener = await PushNotifications.addListener('registrationError', () => {
        setPermissionState('denied');
      });

      pushReceivedListener = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        if (!notificationsEnabledRef.current) return;

        const route = extractRoute(notification.data);
        const dedupKey = route?.tripId && route?.reminderKind && route?.dateKey
          ? getNotificationDedupKey(route.tripId, route.reminderKind, route.dateKey)
          : null;

        if (dedupKey && localStorage.getItem(dedupKey) === '1') return;

        const payload: NotificationPayload = {
          title: notification.title || 'TripSpend',
          body: notification.body || '',
          data: route || undefined,
          variant: 'info',
          durationMs: 5200,
        };

        if (appActiveRef.current) {
          if (dedupKey) localStorage.setItem(dedupKey, '1');
          notifyRef.current(payload);
        }

        if (route) {
          routeFromNotificationRef.current(notification.data);
        }
      });

      pushActionListener = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        if (!notificationsEnabledRef.current) return;
        routeFromNotificationRef.current(action.notification.data);
      });

      localReceivedListener = await LocalNotifications.addListener('localNotificationReceived', (notification) => {
        if (!notificationsEnabledRef.current) return;

        const route = extractRoute(notification.extra);
        const dedupKey = route?.tripId && route?.reminderKind && route?.dateKey
          ? getNotificationDedupKey(route.tripId, route.reminderKind, route.dateKey)
          : null;

        if (dedupKey && localStorage.getItem(dedupKey) === '1') return;

        if (appActiveRef.current) {
          if (dedupKey) localStorage.setItem(dedupKey, '1');
          recordDeliveredReminderRef.current(dedupKey || `${notification.id}`, {
            title: notification.title || 'TripSpend',
            body: notification.body || '',
            data: route || undefined,
            variant: 'info',
            durationMs: 5200,
          });
        }
      });

      localActionListener = await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        if (!notificationsEnabledRef.current) return;
        routeFromNotificationRef.current(action.notification.extra);
      });

      appListener = await CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
        appActiveRef.current = isActive;
        if (isActive) {
          if (pendingEnableFromSettingsRef.current) {
            const permission = await getNativeNotificationPermission();
            setPermissionState(permission);
            if (permission === 'granted') {
              pendingEnableFromSettingsRef.current = false;
              setPreferences((prev) => ({ ...prev, enabled: true }));
              try {
                await PushNotifications.register();
              } catch {
                // Best effort.
              }
              await scheduleLocalRemindersRef.current();
            }
          }
          void syncPermissionAndRegistrationRef.current();
        }
      });

      const launch = await CapacitorApp.getLaunchUrl();
      if (launch?.url) {
        // Keep existing deep link handling in App; this hook only deals with notifications.
      }

      void syncPermissionAndRegistrationRef.current();
    };

    void setup();

    return () => {
      void appListener?.remove();
      void pushRegistrationListener?.remove();
      void pushRegistrationErrorListener?.remove();
      void pushReceivedListener?.remove();
      void pushActionListener?.remove();
      void localReceivedListener?.remove();
      void localActionListener?.remove();
    };
    // Intentionally run once per app lifetime: nativeListenersReadyRef guards
    // against re-registering native plugin listeners, so this effect must not
    // re-run on every change to notify/recordDeliveredReminder/routeFromNotification/
    // syncPermissionAndRegistration. Freshness is handled via the refs above instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!preferences.enabled) {
      void clearScheduledReminders();
      return;
    }

    if (permissionState !== 'granted') {
      void clearScheduledReminders();
      return;
    }

    void scheduleLocalReminders();
  }, [clearScheduledReminders, permissionState, preferences.enabled, scheduleLocalReminders]);

  const requestInitialNotificationPermission = useCallback(async () => {
    if (!isNative()) {
      setPermissionState('granted');
      setPreferences((prev) => ({ ...prev, enabled: true }));
      return;
    }

    const requested = await requestNativeNotificationPermission();
    const granted = requested === 'granted';
    setPermissionState(requested);
    setPreferences((prev) => ({ ...prev, enabled: granted }));

    if (granted) {
      try {
        await PushNotifications.register();
      } catch {
        // Push registration is best-effort; local scheduling still works offline.
      }
      await scheduleLocalReminders();
      return;
    }

    await clearScheduledReminders();
    await unregisterDeviceToken();
  }, [clearScheduledReminders, scheduleLocalReminders, unregisterDeviceToken]);

  const enableNotificationsFromSettings = useCallback(async () => {
    if (!isNative()) {
      setPermissionState('granted');
      setPreferences((prev) => ({ ...prev, enabled: true }));
      return;
    }

    let permission = await getNativeNotificationPermission();

    if (permission === 'prompt') {
      permission = await requestNativeNotificationPermission();
    }

    setPermissionState(permission);

    if (permission === 'granted') {
      setPreferences((prev) => ({ ...prev, enabled: true }));
      pendingEnableFromSettingsRef.current = false;
      try {
        await PushNotifications.register();
      } catch {
        // Continue with local reminders.
      }
      await scheduleLocalReminders();
      return;
    }

    pendingEnableFromSettingsRef.current = true;
    await openSystemNotificationSettings();
  }, [scheduleLocalReminders]);

  const openNotificationSettings = useCallback(async () => {
    if (!isNative()) return;

    const permission = await getNativeNotificationPermission();
    if (permission === 'prompt') {
      await enableNotificationsFromSettings();
      return;
    }

    await openSystemNotificationSettings();
  }, [enableNotificationsFromSettings]);

  const disableNotifications = useCallback(async () => {
    pendingEnableFromSettingsRef.current = false;
    setPreferences((prev) => ({ ...prev, enabled: false }));
    await clearScheduledReminders();
    await unregisterDeviceToken();
  }, [clearScheduledReminders, unregisterDeviceToken]);

  const setDailyExpenseRemindersEnabled = useCallback((enabled: boolean) => {
    setPreferences((prev) => ({ ...prev, dailyExpense: enabled }));
  }, []);

  const setPendingSettlementRemindersEnabled = useCallback((enabled: boolean) => {
    setPreferences((prev) => ({ ...prev, pendingSettlement: enabled }));
  }, []);

  useEffect(() => {
    if (!isNative() || !notificationsActive || !preferences.enabled) return;
    void syncPermissionAndRegistration();
  }, [notificationsActive, preferences.enabled, syncPermissionAndRegistration]);

  useEffect(() => {
    const refresh = async () => {
      if (!isNative()) return;
      const permission = await getNativeNotificationPermission();
      setPermissionState(permission);
      if (permission !== 'granted' && preferences.enabled) {
        await disableNotifications();
      }
    };

    void refresh();
  }, [disableNotifications, preferences.enabled]);

  useEffect(() => {
    if (!isNative()) return;
    if (!preferences.enabled || permissionState !== 'granted') {
      void clearScheduledReminders();
      return;
    }

    void scheduleLocalReminders();
  }, [clearScheduledReminders, permissionState, preferences.enabled, scheduleLocalReminders, nowTick, tripDataSignature]);

  return {
    notificationsEnabled: preferences.enabled && permissionState === 'granted',
    dailyExpenseRemindersEnabled: preferences.dailyExpense,
    pendingSettlementRemindersEnabled: preferences.pendingSettlement,
    pushToken,
    notificationPermission: permissionState,
    requestInitialNotificationPermission,
    enableNotificationsFromSettings,
    disableNotifications,
    openNotificationSettings,
    setDailyExpenseRemindersEnabled,
    setPendingSettlementRemindersEnabled,
    unregisterDeviceToken,
  };
}