import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Edit3, ChevronRight, Download, Upload, Share2, FileText, History, CloudUpload, CloudDownload, LogIn, LogOut, Bell, HandCoins } from 'lucide-react';
import { motion } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { NotificationPayload } from '../components/NotificationCard';
import { Expense, TripData, TripSetup, Trip, calculateSettlement, getTripPeople } from '../utils/calculations.ts';
import { TripSwitcher } from '../components/TripSwitcher';
import { AccountSwitchDialog } from '../components/AccountSwitchDialog';
import { formatCurrency } from '../utils/cn';
import { MAX_FILE_SIZE_BYTES } from '../utils/fileUtils';

interface SettingsProps {
  onReset: () => void;
  data: TripData;
  onImport: (setup: TripSetup, expenses: Expense[]) => void;
  notify?: (payload: NotificationPayload) => void;
  firebaseConfigured: boolean;
  lastAutoSyncAt?: number | null;
  lastSyncAttemptAt?: number | null;
  autoSyncError?: string | null;
  pendingSyncCount?: number;
  nextRetryAt?: number | null;
  authLoading: boolean;
  userEmail: string | null;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
  onSwitchAccount?: () => void;
  onCloudBackup: () => void;
  onCloudRestore: () => void;
  notificationsEnabled: boolean;
  notificationPermission: 'prompt' | 'granted' | 'denied';
  onEnableNotifications: () => void;
  onDisableNotifications: () => void;
  onOpenNotificationSettings: () => void;
  dailyExpenseRemindersEnabled: boolean;
  pendingSettlementRemindersEnabled: boolean;
  onDailyExpenseRemindersChange: (enabled: boolean) => void;
  onPendingSettlementRemindersChange: (enabled: boolean) => void;
  // Multi-trip props
  trips?: Trip[];
  activeTrip?: string | null;
  onCreateTrip?: (name: string) => string | null | void | Promise<string | null | void>;
  onGenerateInviteCode?: () => Promise<string | null>;
  onJoinTrip?: (tripId: string) => Promise<boolean>;
  onSelectTrip?: (tripId: string) => void;
  onDeleteTrip?: (tripId: string) => void;
  onRenameTrip?: (tripId: string, newName: string) => void;
  isTripCreator?: boolean;
  inviteActive?: boolean;
  onToggleInviteActive?: (active: boolean) => Promise<boolean>;
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    if (blob.size > MAX_FILE_SIZE_BYTES) {
      reject(new Error('File size exceeds the 10MB maximum limit.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image.'));
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') { reject(new Error('Invalid image data.')); return; }
      const idx = reader.result.indexOf(',');
      resolve(idx >= 0 ? reader.result.slice(idx + 1) : reader.result);
    };
    reader.readAsDataURL(blob);
  });

export const Settings: React.FC<SettingsProps> = ({
  onReset,
  data,
  onImport,
  notify,
  firebaseConfigured,
  lastAutoSyncAt = null,
  lastSyncAttemptAt = null,
  autoSyncError = null,
  pendingSyncCount = 0,
  nextRetryAt = null,
  authLoading,
  userEmail,
  onSignInGoogle,
  onSignOutGoogle,
  onSwitchAccount,
  onCloudBackup,
  onCloudRestore,
  notificationsEnabled,
  notificationPermission,
  onEnableNotifications,
  onDisableNotifications,
  onOpenNotificationSettings,
  dailyExpenseRemindersEnabled,
  pendingSettlementRemindersEnabled,
  onDailyExpenseRemindersChange,
  onPendingSettlementRemindersChange,
  trips = [],
  activeTrip = null,
  onCreateTrip,
  onGenerateInviteCode,
  onJoinTrip,
  onSelectTrip,
  onDeleteTrip,
  onRenameTrip,
  isTripCreator,
  inviteActive,
  onToggleInviteActive,
}) => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  const totalBudget = useMemo(() => data.setup?.totalBudget ?? 0, [data.setup]);
  const totalSpent = useMemo(() => data.expenses.reduce((s, e) => s + e.amount, 0), [data.expenses]);
  const remaining = useMemo(() => totalBudget - totalSpent, [totalBudget, totalSpent]);
  const categoryTotals = useMemo(() => data.expenses.reduce((acc, exp) => {
    acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
    return acc;
  }, {} as Record<string, number>), [data.expenses]);

  const formatTimeAgo = useCallback((timestamp: number | null): string => {
    if (!timestamp) return 'Never synced yet';
    const diffMs = Date.now() - timestamp;
    if (diffMs < 10000) return 'Just now';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Less than a minute ago';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }, []);

  const formatRetry = useCallback((timestamp: number | null): string => {
    if (!timestamp || timestamp <= Date.now()) return 'now';
    const diffMs = timestamp - Date.now();
    const secs = Math.ceil(diffMs / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.ceil(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.ceil(mins / 60);
    return `${hrs}h`;
  }, []);

  const pushNotice = useCallback((payload: NotificationPayload) => {
    if (notify) {
      notify(payload);
      return;
    }
    alert(payload.message ? `${payload.title}\n${payload.message}` : payload.title);
  }, [notify]);

  const handleAuthClick = useCallback(() => {
    if (userEmail) {
      // User is already logged in, show account management dialog
      setAccountDialogOpen(true);
    } else {
      // Not logged in, sign in
      onSignInGoogle();
    }
  }, [userEmail, onSignInGoogle]);

  const handleSwitchAccount = useCallback(async () => {
    setSwitchingAccount(true);
    try {
      // First sign out, then sign in with a different account
      await onSignOutGoogle();
      // Small delay to ensure sign-out completes
      await new Promise(resolve => setTimeout(resolve, 500));
      // Then trigger sign in
      if (onSwitchAccount) {
        await onSwitchAccount();
      } else {
        await onSignInGoogle();
      }
    } catch (error) {
      console.error('Account switch failed', error);
      pushNotice({ 
        title: 'Account Switch Failed', 
        message: 'Could not switch accounts. Please try again.', 
        variant: 'error' 
      });
    } finally {
      setSwitchingAccount(false);
      setAccountDialogOpen(false);
    }
  }, [onSignOutGoogle, onSwitchAccount, onSignInGoogle, pushNotice]);

  const handleSignOutFromDialog = useCallback(async () => {
    try {
      await onSignOutGoogle();
      setAccountDialogOpen(false);
    } catch (error) {
      console.error('Sign-out failed', error);
      pushNotice({ 
        title: 'Sign-Out Failed', 
        message: 'Could not sign out. Please try again.', 
        variant: 'error' 
      });
    }
  }, [onSignOutGoogle, pushNotice]);

  const handleReset = useCallback(() => {
    if (window.confirm('Reset the trip? This will delete all expenses and setup data.')) {
      onReset();
      navigate('/setup');
    }
  }, [navigate, onReset]);

  const handleShare = useCallback(async () => {

    let text = `📊 *TripSpend Summary*\n\n`;
    text += `💰 Budget: ${formatCurrency(totalBudget)}\n`;
    text += `💸 Spent: ${formatCurrency(totalSpent)}\n`;
    text += `🏦 Remaining: ${formatCurrency(remaining)}\n\n`;
    text += `*By Category:*\n`;
    Object.entries(categoryTotals).forEach(([cat, amt]) => { text += `- ${cat}: ${formatCurrency(amt)}\n`; });
    text += `\n_Generated by TripSpend_`;

    if (navigator.share) {
      await navigator.share({ title: 'TripSpend Summary', text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(text);
      pushNotice({ title: 'Copied', message: 'Summary copied to clipboard.', variant: 'success' });
    }
  }, [categoryTotals, pushNotice, remaining, totalBudget, totalSpent]);

  const handleShareImage = useCallback(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    if (!ctx) { pushNotice({ title: 'Image Error', message: 'Could not generate image.', variant: 'error' }); return; }

    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = '#2563eb'; ctx.fillRect(70, 70, 940, 220);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 58px sans-serif';
    ctx.fillText('TripSpend Summary', 110, 180);
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 46px sans-serif';
    ctx.fillText(`Budget: Rs ${totalBudget.toFixed(0)}`, 110, 380);
    ctx.fillText(`Spent: Rs ${totalSpent.toFixed(0)}`, 110, 460);
    ctx.fillText(`Remaining: Rs ${remaining.toFixed(0)}`, 110, 540);

    ctx.font = 'bold 38px sans-serif'; ctx.fillText('Category Breakdown', 110, 660);
    ctx.font = '32px sans-serif';
    let y = 740;
    Object.entries(categoryTotals).forEach(([cat, amt]) => { ctx.fillText(`${cat}: Rs ${amt.toFixed(0)}`, 110, y); y += 64; });
    ctx.fillStyle = '#475569'; ctx.font = '26px sans-serif';
    ctx.fillText(`Generated on ${new Date().toLocaleDateString()}`, 110, 1240);

    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
    if (!blob) { pushNotice({ title: 'Image Error', message: 'Could not generate image.', variant: 'error' }); return; }

    const fileName = `tripspend_summary_${Date.now()}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    if (Capacitor.isNativePlatform()) {
      try {
        const b64 = await blobToBase64(blob);
        const result = await Filesystem.writeFile({ path: fileName, data: b64, directory: Directory.Cache });
        await Share.share({ title: 'TripSpend Summary', files: [result.uri], dialogTitle: 'Share summary' });
        return;
      } catch { /* fall through */ }
    }

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title: 'TripSpend Summary', files: [file] }); return; } catch { /* fall through */ }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }, [categoryTotals, pushNotice, remaining, totalBudget, totalSpent]);

  const handleExport = useCallback(async () => {
    const date = new Date().toISOString().split('T')[0];
    const fileName = `tripspend_backup_${date}.json`;
    const json = JSON.stringify(data, null, 2);

    if (Capacitor.isNativePlatform()) {
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const b64 = await blobToBase64(blob);
        const result = await Filesystem.writeFile({
          path: fileName,
          data: b64,
          directory: Directory.Cache,
        });
        await Share.share({
          title: 'TripSpend Backup',
          text: 'TripSpend backup file',
          files: [result.uri],
          dialogTitle: 'Export backup',
        });
        pushNotice({ title: 'Backup Ready', message: 'Backup file is ready to share or save.', variant: 'success' });
        return;
      } catch (error) {
        console.error('Native backup export failed', error);
        pushNotice({ title: 'Export Failed', message: 'Could not export backup on this device.', variant: 'error' });
        return;
      }
    }

    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      pushNotice({ title: 'Backup Downloaded', message: 'Backup file has been downloaded.', variant: 'success' });
    } catch (error) {
      console.error('Web backup export failed', error);
      pushNotice({ title: 'Export Failed', message: 'Could not download backup file.', variant: 'error' });
    }
  }, [data, pushNotice]);

  // PDF-safe currency formatter — jsPDF helvetica doesn't support ₹
  const pdfCurrency = useCallback((amount: number) =>
    'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount), []);

  const handleExportClosingReport = useCallback(async () => {
    if (!data.setup) { pushNotice({ title: 'Trip Setup Required', message: 'Set up a trip first to generate a report.', variant: 'warning' }); return; }
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });

      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const MX = 48;
      const CW = W - MX * 2;
      let y = 0;

      const t = {
        label: (s: string, x = MX) => { doc.setFont('helvetica','bold');   doc.setFontSize(9);  doc.setTextColor(100,116,139); doc.text(s.toUpperCase(),x,y); y+=14; },
        body:  (s: string, x = MX) => { doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(30,41,59);    doc.text(s,x,y); },
        right: (s: string)         => { doc.setFont('helvetica','bold');   doc.setFontSize(11); doc.setTextColor(15,23,42);    doc.text(s,MX+CW,y,{align:'right'}); },
        gap:   (n = 16)            => { y += n; },
      };

      const newPage = (need = 60) => { if (y + need > H - 48) { doc.addPage(); y = 48; } };

      const settlement = calculateSettlement(data.setup, data.expenses);
      const people = getTripPeople(data.setup);
      const budget = data.setup.totalBudget || 0;
      const spent = data.expenses.reduce((s, e) => s + e.amount, 0);
      const remaining = budget - spent;

      const catTotals = new Map<string, number>();
      for (const e of data.expenses) catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + e.amount);
      const catRows = Array.from(catTotals.entries()).map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount);

      const paidTotals = new Map<string, number>();
      for (const p of people) paidTotals.set(p, 0);
      for (const e of data.expenses) paidTotals.set(e.paidBy, (paidTotals.get(e.paidBy) ?? 0) + e.amount);
      const paidRows = Array.from(paidTotals.entries()).map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount);

      // Header banner
      y = 48;
      doc.setFillColor(37,99,235);
      doc.roundedRect(MX, y, CW, 80, 10, 10, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(255,255,255);
      doc.text('Trip Closing Report', MX+20, y+30);
      doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(191,219,254);
      doc.text(`${data.setup.startDate}  to  ${data.setup.endDate}`, MX+20, y+50);
      doc.text(`${people.length} participants  |  ${data.expenses.length} expenses  |  Generated ${new Date().toLocaleDateString('en-IN')}`, MX+20, y+66);
      y += 96;

      // Summary cards
      const colW = CW / 3;
      const summaryItems = [
        { label: 'Total Budget', value: pdfCurrency(budget) },
        { label: 'Total Spent',  value: pdfCurrency(spent) },
        { label: 'Remaining',    value: pdfCurrency(remaining) },
      ];
      summaryItems.forEach(({ label, value }, i) => {
        const cx = MX + i * colW;
        doc.setFillColor(248,250,252);
        doc.roundedRect(cx, y, colW - 8, 52, 8, 8, 'F');
        doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(100,116,139);
        doc.text(label.toUpperCase(), cx+12, y+16);
        doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(15,23,42);
        doc.text(value, cx+12, y+36);
      });
      y += 68;

      // Category breakdown
      newPage(catRows.length * 26 + 40);
      t.label('Category Breakdown'); t.gap(4);
      if (catRows.length === 0) {
        t.body('No expenses recorded.'); t.gap(16);
      } else {
        const totalForPct = catRows.reduce((s, r) => s + r.amount, 0) || 1;
        for (const row of catRows) {
          newPage(22);
          const pct = ((row.amount / totalForPct) * 100).toFixed(1) + '%';
          t.body(row.name);
          // percentage in muted
          doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(100,116,139);
          doc.text(pct, MX + CW - 80, y, { align: 'right' });
          t.right(pdfCurrency(row.amount));
          t.gap(20);
        }
      }
      t.gap(8);

      // Who paid
      newPage(paidRows.length * 26 + 40);
      t.label('Who Paid'); t.gap(4);
      for (const row of paidRows) {
        newPage(22);
        t.body(row.name); t.right(pdfCurrency(row.amount)); t.gap(18);
      }
      t.gap(8);

      // Settlements
      newPage(settlement.transfers.length * 26 + 40);
      t.label('Settlements'); t.gap(4);
      if (settlement.transfers.length === 0) {
        doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(22,163,74);
        doc.text('Everyone is settled up - no transfers needed.', MX, y); t.gap(18);
      } else {
        for (const tr of settlement.transfers) {
          newPage(22);
          t.body(`${tr.from} pays ${tr.to}`); t.right(pdfCurrency(tr.amount)); t.gap(18);
        }
      }

      // Footer on every page
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(226,232,240);
        doc.line(MX, H-36, MX+CW, H-36);
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(148,163,184);
        doc.text('Generated by TripSpend', MX, H-22);
        doc.text(`Page ${i} of ${pages}`, MX+CW, H-22, { align: 'right' });
      }

      const blob = doc.output('blob');
      const date = new Date().toISOString().split('T')[0];
      const fileName = `tripspend_report_${date}.pdf`;

      if (Capacitor.isNativePlatform()) {
        try {
          const b64 = await blobToBase64(blob);
          const result = await Filesystem.writeFile({ path: fileName, data: b64, directory: Directory.Cache });
          await Share.share({ title: 'Trip Closing Report', files: [result.uri], dialogTitle: 'Share report' });
          return;
        } catch { /* fall through */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
    } catch {
      pushNotice({ title: 'Report Error', message: 'Could not generate PDF report.', variant: 'error' });
    }
  }, [data, pdfCurrency, pushNotice]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (parsed.setup && Array.isArray(parsed.expenses)) {
          onImport(parsed.setup, parsed.expenses);
          pushNotice({ title: 'Backup Restored', message: 'Your backup was restored successfully.', variant: 'success' });
          navigate('/');
        } else { pushNotice({ title: 'Invalid Backup', message: 'Selected file is not a valid backup.', variant: 'error' }); }
      } catch { pushNotice({ title: 'Import Failed', message: 'Could not read backup file.', variant: 'error' }); }
    };
    reader.readAsText(file);
  }, [navigate, onImport, pushNotice]);

  return (
    <div className="page-shell space-y-4">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage your trip</p>
      </div>

      {/* Multi-Trip Manager */}
      {trips.length > 0 && (
        <Section label="My Trips" allowOverflow>
          <div className="px-4 py-3 relative z-20">
            <TripSwitcher
              trips={trips}
              activeTrip={activeTrip}
              onSelectTrip={(tripId) => {
                onSelectTrip?.(tripId);
                navigate('/');
              }}
              onCreateTrip={(name) => onCreateTrip?.(name)}
              onGenerateInviteCode={onGenerateInviteCode}
              onJoinTrip={(tripId) => onJoinTrip?.(tripId) ?? Promise.resolve(false)}
              onDeleteTrip={(tripId) => onDeleteTrip?.(tripId)}
              onRenameTrip={(tripId, name) => onRenameTrip?.(tripId, name)}
              notify={pushNotice}
              isTripCreator={isTripCreator}
              inviteActive={inviteActive}
              onToggleInviteActive={onToggleInviteActive}
            />
          </div>
        </Section>
      )}

      {/* Trip */}
      <Section label="Trip & Organization">
        <SettingItem icon={<Edit3 className="w-4.5 h-4.5 text-blue-600" />} iconBg="bg-blue-50"
          label="Edit Trip" description="Budget, dates, members, categories"
          onClick={() => navigate('/trip-details')} />
        <Divider />
        <SettingItem icon={<History className="w-4.5 h-4.5 text-violet-600" />} iconBg="bg-violet-50"
          label="Settlement Log" description="Complete settle/reopen audit trail"
          onClick={() => navigate('/settlement-log')} />
      </Section>

      {/* Notifications */}
      <Section label="Notifications">
        <ToggleItem
          icon={<Bell className="w-4.5 h-4.5 text-blue-600" />}
          iconBg="bg-blue-50"
          label="System notifications"
          description={notificationsEnabled
            ? 'Enabled for reminders and notifications'
            : notificationPermission === 'granted'
              ? 'Permission granted. Turn on to receive reminders.'
            : notificationPermission === 'denied'
              ? 'Open system settings to allow reminders'
              : 'Permission not yet granted'}
          enabled={notificationsEnabled}
          onToggle={() => {
            if (notificationsEnabled) {
              onDisableNotifications();
              return;
            }
            onEnableNotifications();
          }}
        />
        <div className="px-4 pb-3 pt-1 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400 leading-5">
            Uses native notifications for reminders.
          </p>
          {!notificationsEnabled && (
            <button
              type="button"
              onClick={onOpenNotificationSettings}
              className="shrink-0 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-[11px] font-bold"
            >
              Open settings
            </button>
          )}
        </div>
      </Section>

      {/* Smart Reminders */}
      <Section label="Smart Reminders">
        <ToggleItem
          icon={<Bell className="w-4.5 h-4.5 text-blue-600" />}
          iconBg="bg-blue-50"
          label="Daily expense reminder"
          description={notificationsEnabled
            ? 'Nudge me when no expense has been added today'
            : 'Enable system notifications first'}
          enabled={notificationsEnabled && dailyExpenseRemindersEnabled}
          disabled={!notificationsEnabled}
          onToggle={() => notificationsEnabled && onDailyExpenseRemindersChange(!dailyExpenseRemindersEnabled)}
        />
        <Divider />
        <ToggleItem
          icon={<HandCoins className="w-4.5 h-4.5 text-amber-600" />}
          iconBg="bg-amber-50"
          label="Pending settlement reminder"
          description={notificationsEnabled
            ? 'Remind me after the trip ends until settlements are cleared'
            : 'Enable system notifications first'}
          enabled={notificationsEnabled && pendingSettlementRemindersEnabled}
          disabled={!notificationsEnabled}
          onToggle={() => notificationsEnabled && onPendingSettlementRemindersChange(!pendingSettlementRemindersEnabled)}
        />
        <div className="px-4 pb-3 pt-1">
          <p className="text-[11px] text-slate-400 leading-5">
            Available only when system notifications are enabled.
          </p>
        </div>
      </Section>

      {/* Share + Data */}
      <Section label="Share & Data">
        <SettingItem icon={<Share2 className="w-4.5 h-4.5 text-emerald-600" />} iconBg="bg-emerald-50"
          label="Share Summary" description="Send trip summary via WhatsApp"
          onClick={handleShare} />
        <Divider />
        <SettingItem icon={<Share2 className="w-4.5 h-4.5 text-indigo-600" />} iconBg="bg-indigo-50"
          label="Share Summary Image" description="Generate a shareable summary card"
          onClick={() => { void handleShareImage(); }} />
        <Divider />
        <SettingItem icon={<FileText className="w-4.5 h-4.5 text-cyan-700" />} iconBg="bg-cyan-50"
          label="Trip Closing Report (PDF)" description="Totals, categories, payers, and settlements"
          onClick={() => { void handleExportClosingReport(); }} />
        <SettingItem icon={<Download className="w-4.5 h-4.5 text-purple-600" />} iconBg="bg-purple-50"
          label="Export Backup" description="Save all data as JSON"
          onClick={() => { void handleExport(); }} />
        <Divider />
        <SettingItem icon={<Upload className="w-4.5 h-4.5 text-amber-600" />} iconBg="bg-amber-50"
          label="Import Backup" description="Restore from a JSON backup"
          onClick={() => fileInputRef.current?.click()} />
        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
      </Section>

      {/* Cloud */}
      <Section label="Cloud & Account">
        {!firebaseConfigured && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] text-amber-800 mx-4 mt-3 mb-2">
            Firebase is not configured yet. Add VITE_FIREBASE_* env values.
          </div>
        )}

        {firebaseConfigured && (
          <>
            <div className={`mx-4 mt-3 mb-2 rounded-2xl border px-3 py-2.5 ${autoSyncError ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <p className={`text-[11px] font-semibold ${autoSyncError ? 'text-rose-700' : 'text-emerald-700'}`}>
                {autoSyncError ? autoSyncError : `Last auto-sync: ${formatTimeAgo(lastAutoSyncAt)}`}
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-slate-600">
                <p>Success: <span className="font-semibold text-slate-700">{formatTimeAgo(lastAutoSyncAt)}</span></p>
                <p>Attempt: <span className="font-semibold text-slate-700">{formatTimeAgo(lastSyncAttemptAt)}</span></p>
                <p>Pending: <span className="font-semibold text-slate-700">{pendingSyncCount}</span></p>
                <p>Retry: <span className="font-semibold text-slate-700">{pendingSyncCount > 0 ? formatRetry(nextRetryAt) : '-'}</span></p>
              </div>
            </div>
            <SettingItem
              icon={userEmail ? <LogOut className="w-4.5 h-4.5 text-slate-700" /> : <LogIn className="w-4.5 h-4.5 text-blue-600" />}
              iconBg={userEmail ? 'bg-slate-100' : 'bg-blue-50'}
              label={authLoading ? 'Checking sign-in...' : userEmail ? 'Signed in with Google' : 'Sign in with Google'}
              description={authLoading ? 'Please wait' : userEmail || 'Required for cloud backup and restore'}
              onClick={handleAuthClick}
            />
            <Divider />
            <SettingItem
              icon={<CloudUpload className="w-4.5 h-4.5 text-emerald-600" />}
              iconBg="bg-emerald-50"
              label="Backup to Cloud"
              description="Save setup + expenses to Cloud"
              onClick={onCloudBackup}
            />
            <Divider />
            <SettingItem
              icon={<CloudDownload className="w-4.5 h-4.5 text-indigo-600" />}
              iconBg="bg-indigo-50"
              label="Restore from Cloud"
              description="Load latest backup from Cloud"
              onClick={onCloudRestore}
            />
          </>
        )}
      </Section>

      {/* Danger */}
      <Section label="Danger Zone">
        <SettingItem icon={<RotateCcw className="w-4.5 h-4.5 text-red-600" />} iconBg="bg-red-50"
          label="Reset Trip" description="Delete all data and start fresh"
          onClick={handleReset} danger />
      </Section>

      {/* About */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 text-center space-y-1">
        <p className="font-black text-slate-900 text-lg">TripSpend</p>
        <p className="text-xs text-slate-400">Made by Amartya Vishwakarma</p>
        <p className="text-xs text-slate-300 font-bold uppercase tracking-widest pt-2">v2.0.0</p>
      </div>

      {/* Account Switch Dialog */}
      <AccountSwitchDialog
        isOpen={accountDialogOpen}
        userEmail={userEmail}
        isLoading={switchingAccount}
        onSwitchAccount={handleSwitchAccount}
        onSignOut={handleSignOutFromDialog}
        onClose={() => setAccountDialogOpen(false)}
      />
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode; allowOverflow?: boolean }> = ({ label, children, allowOverflow = false }) => (
  <div>
    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">{label}</p>
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm ${allowOverflow ? 'overflow-visible relative z-20' : 'overflow-hidden'}`}>
      {children}
    </div>
  </div>
);

const Divider = () => <div className="h-px bg-slate-50 mx-4" />;

const ToggleItem = ({ label, description, enabled, onToggle, disabled = false }: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) => (
  <div className="w-full px-4 py-3 flex items-center gap-3">
    <div className="flex-1 min-w-0">
      <p className="font-semibold text-sm leading-tight text-slate-900">{label}</p>
      <p className="text-xs text-slate-400 mt-0.5">{description}</p>
    </div>
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`relative w-14 h-8 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-blue-600' : 'bg-slate-300'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      aria-pressed={enabled}
      aria-label={label}
      aria-disabled={disabled}
    >
      <span
        className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${enabled ? 'translate-x-6' : 'translate-x-0'}`}
      />
    </button>
  </div>
);

const SettingItem = ({ label, description, onClick, danger }: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  description: string;
  onClick: () => void;
  danger?: boolean;
}) => (
  <motion.button
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left group"
  >
    <div className="flex-1 min-w-0">
      <p className={`font-semibold text-sm leading-tight ${danger ? 'text-red-600' : 'text-slate-900'}`}>{label}</p>
      <p className="text-xs text-slate-400 mt-0.5">{description}</p>
    </div>
    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
  </motion.button>
);
