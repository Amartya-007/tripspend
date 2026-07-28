const ACCOUNT_SCOPED_KEYS = [
  'tripspend_active_shared_trip',
  'tripspend_pending_join_id',
  'tripspend_sync_queue_v1',
  'tripspend_workspace_mode_v1',
  'tripspend_settled_v2',
  'tripspend_settlement_history_v1',
  'tripspend_notification_prefs_v1',
];

export const clearAccountScopedStorage = () => {
  for (const key of ACCOUNT_SCOPED_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage failures during logout.
    }
  }
};
