import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Expense, TripSetup, getTripCategories, getTripPeople } from '../utils/calculations.ts';
import { categorizeExpenseWithAI, isAIConfigured } from '../utils/aiCategorization.ts';
import { formatCurrency } from '../utils/cn';
import { AMOUNT_MAX, MAX_NOTE_LENGTH, MAX_TAGS_INPUT_LENGTH, MAX_TAGS_COUNT, COUNTER_THRESHOLD } from '../utils/constants.ts';
import { validateAmount, validateTags, parseTags, showCounter } from '../utils/validation.ts';
import { IndianRupee, Tag, FileText, Calendar, Plus, Save, AlertCircle, ReceiptText, Image as ImageIcon, X, Camera as CameraIcon, ScanText, Mic, User, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DatePicker } from '../components/DatePicker.tsx';
import { PeoplePickerSheet } from '../components/PeoplePickerSheet.tsx';
import { format, isAfter, isBefore, isValid, parseISO, startOfDay } from 'date-fns';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

const QUICK_AMOUNTS = [50, 100, 200, 500];

interface AddExpenseProps {
  onAdd: (expense: Expense) => void;
  onUpdate: (expense: Expense) => void;
  expenses: Expense[];
  setup: TripSetup | null;
  presets?: Array<{ id: string; amount: number; category: string; note?: string; isFavorite: boolean }>;
  onAddPreset?: (preset: { amount: number; category: string; note?: string; isFavorite: boolean }) => void;
  onTogglePresetFavorite?: (id: string) => void;
}

const MAX_RECEIPT_DIMENSION = 1280;
const RECEIPT_QUALITY = 0.72;
const MAX_RECEIPT_ESTIMATED_BYTES = 450 * 1024;

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error('Image decode failed'));
    };
    image.src = src;
  });
};

const canvasToDataUrl = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Image compression failed'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Image read failed'));
        }
      };
      reader.onerror = () => reject(new Error('Image read failed'));
      reader.readAsDataURL(blob);
    }, type, quality);
  });
};

const estimateBytesFromDataUrl = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
};

const compressReceipt = async (inputImage: string): Promise<string> => {
  const image = await loadImage(inputImage);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const scale = Math.min(1, MAX_RECEIPT_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas context unavailable');
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  let dataUrl = await canvasToDataUrl(canvas, 'image/jpeg', RECEIPT_QUALITY);
  if (estimateBytesFromDataUrl(dataUrl) > MAX_RECEIPT_ESTIMATED_BYTES) {
    dataUrl = await canvasToDataUrl(canvas, 'image/jpeg', 0.55);
  }

  return dataUrl;
};

const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('File read failed'));
      }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
};

const normalizeAmount = (raw: string) => {
  return Number(raw.replace(/,/g, '').trim());
};

const extractReceiptFields = (ocrText: string) => {
  const lines = ocrText.split('\n').map((line) => line.trim()).filter(Boolean);
  const lowerLines = lines.map((line) => line.toLowerCase());

  let amount: number | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lower = lowerLines[i];
    const amountMatch = line.match(/(?:inr|rs\.?|₹)?\s*(\d{2,6}(?:[.,]\d{1,2})?)/gi);
    if (!amountMatch) continue;

    const parsed = amountMatch
      .map((entry) => normalizeAmount(entry.replace(/inr|rs\.?|₹/gi, '')))
      .filter((value) => Number.isFinite(value));

    if (parsed.length === 0) continue;
    const candidate = Math.max(...parsed);

    if (lower.includes('total') || lower.includes('amount') || lower.includes('grand')) {
      amount = candidate;
      break;
    }

    if (!amount || candidate > amount) {
      amount = candidate;
    }
  }

  const dateMatch = ocrText.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/);
  const date = dateMatch ? dateMatch[0].replace(/[.]/g, '-') : null;

  const vendor = lines.find((line) => {
    const lower = line.toLowerCase();
    if (line.length < 3) return false;
    if (line.match(/\d/)) return false;
    if (lower.includes('invoice') || lower.includes('tax') || lower.includes('gst') || lower.includes('total')) return false;
    return true;
  }) || null;

  return { amount, date, vendor };
};

type ReceiptItem = {
  image: string;
  name?: string;
};

type SpeechRecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};

const PaidBySelect: React.FC<{
  people: string[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}> = ({ people, value, disabled, onChange }) => {
  const selected = useMemo(() => (value ? [value] : []), [value]);

  const handleChange = useCallback((next: string[]) => {
    if (!next[0]) return;
    onChange(next[0]);
  }, [onChange]);

  return (
    <PeoplePickerSheet
      people={people}
      selected={selected}
      onChange={handleChange}
      mode="single"
      disabled={disabled}
      triggerLabel={value || 'Select payer'}
      title="Paid By"
      subtitle="Pick who paid this expense"
      accent="emerald"
      showSelectedSummary={false}
    />
  );
};

const SplitSelect: React.FC<{
  people: string[];
  selected: string[];
  paidBy: string;
  disabled: boolean;
  onChange: (v: string[]) => void;
}> = ({ people, selected, paidBy, disabled, onChange }) => {
  const label = selected.length === people.length
    ? 'Everyone'
    : selected.length === 0
    ? 'No one selected'
    : selected.length === 1
    ? selected[0]
    : `${selected.length} people`;

  return (
    <PeoplePickerSheet
      people={people}
      selected={selected}
      onChange={onChange}
      mode="multiple"
      disabled={disabled}
      triggerLabel={label}
      title="Split Between"
      subtitle={`${selected.length} of ${people.length} selected`}
      accent="blue"
      paidBy={paidBy}
      showPayerBadge
      showPayerWarning
      showSelectAllAction
      showClearAllAction
      showOnlyPayerAction
      showSelectedSummary
    />
  );
};

// ── Smart category suggestions from note keywords ─────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Travel: ['petrol', 'fuel', 'cab', 'uber', 'ola', 'auto', 'bus', 'train', 'flight', 'taxi', 'transport', 'toll', 'parking', 'metro'],
  Stay:   ['hotel', 'stay', 'room', 'hostel', 'airbnb', 'lodge', 'resort', 'accommodation', 'rent'],
  Food:   ['food', 'lunch', 'dinner', 'breakfast', 'snack', 'restaurant', 'cafe', 'coffee', 'tea', 'meal', 'eat', 'drink', 'biryani', 'pizza'],
};

const suggestCategory = (noteText: string, availableCategories: string[]): string | null => {
  const lower = noteText.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (availableCategories.includes(cat) && keywords.some(kw => lower.includes(kw))) {
      return cat;
    }
  }
  return null;
};

// ── Duplicate detection ────────────────────────────────────────────
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

const findDuplicate = (expenses: Expense[], amount: number, paidBy: string, date: string, excludeId?: string): Expense | null => {
  const targetTime = new Date(date + 'T12:00:00').getTime();
  return expenses.find(e => {
    if (e.id === excludeId) return false;
    if (e.paidBy !== paidBy) return false;
    if (Math.abs(e.amount - amount) > 0.01) return false;
    const eTime = e.createdAt ? new Date(e.createdAt).getTime() : new Date(e.date + 'T12:00:00').getTime();
    return Math.abs(eTime - targetTime) < DUPLICATE_WINDOW_MS;
  }) ?? null;
};

const applyVoiceTranscript = (
  transcript: string,
  setAmount: (value: string) => void,
  setCategory: (value: Expense['category']) => void,
  setNote: (value: string) => void
) => {
  const normalized = transcript.toLowerCase();
  const amountMatch = normalized.match(/(\d+(?:\.\d+)?)/);

  if (amountMatch) {
    setAmount(amountMatch[1]);
  }

  if (normalized.includes('food')) setCategory('Food' as string);
  if (normalized.includes('travel')) setCategory('Travel' as string);
  if (normalized.includes('stay') || normalized.includes('hotel')) setCategory('Stay' as string);
  if (normalized.includes('misc') || normalized.includes('other')) setCategory('Misc' as string);

  const noteMatch = normalized.match(/on\s+(.+)/);
  if (noteMatch?.[1]) {
    setNote(noteMatch[1]);
  }
};

export const AddExpense: React.FC<AddExpenseProps> = ({ onAdd, onUpdate, expenses, setup }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEditing = !!id;

  const people = useMemo(() => getTripPeople(setup), [setup]);
  const categories = useMemo(() => getTripCategories(setup), [setup]);
  const dailyLimit = useMemo(
    () => (setup ? (setup.totalBudget / Math.max(1, setup.peopleCount)) : 0),
    [setup]
  );
  const paidByPeople = useMemo(() => (people.length > 0 ? people : ['Trip Wallet']), [people]);

  const [amount, setAmount] = useState('');

  const amountError = useMemo(() => validateAmount(amount) ?? '', [amount]);
  const [category, setCategory] = useState<Expense['category']>('Food');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paidBy, setPaidBy] = useState<string>(people[0] || 'Trip Wallet');
  const [splitWith, setSplitWith] = useState<string[]>(people);
  const [tagsInput, setTagsInput] = useState('');
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDuplicateWarning, setShowDuplicateWarning] = useState<Expense | null>(null);
  const [showLargeExpenseConfirm, setShowLargeExpenseConfirm] = useState(false);
  const [pendingExpense, setPendingExpense] = useState<Expense | null>(null);

  const isLocked = setup?.lockPreviousDays && isBefore(startOfDay(parseISO(date)), startOfDay(new Date()));
  const tripStartDate = useMemo(() => (setup?.startDate ? startOfDay(parseISO(setup.startDate)) : null), [setup?.startDate]);
  const tripEndDate = useMemo(() => (setup?.endDate ? startOfDay(parseISO(setup.endDate)) : null), [setup?.endDate]);

  const isExpenseOutsideTripDates = useMemo(() => {
    if (isEditing || !tripStartDate || !tripEndDate) return false;
    const selectedDate = startOfDay(parseISO(date));
    return isBefore(selectedDate, tripStartDate) || isAfter(selectedDate, tripEndDate);
  }, [date, isEditing, tripEndDate, tripStartDate]);

  const dateWarningText = useMemo(() => {
    if (!setup?.startDate || !setup?.endDate) return '';
    const selectedDate = startOfDay(parseISO(date));
    if (tripStartDate && isBefore(selectedDate, tripStartDate)) {
      return `This expense is dated before your trip starts on ${format(parseISO(setup.startDate), 'dd MMM yyyy')}.`;
    }
    if (tripEndDate && isAfter(selectedDate, tripEndDate)) {
      return `This expense is dated after your trip ends on ${format(parseISO(setup.endDate), 'dd MMM yyyy')}.`;
    }
    return 'This expense is outside your trip dates.';
  }, [date, setup?.endDate, setup?.startDate, tripEndDate, tripStartDate]);

  useEffect(() => {
    if (isEditing) {
      const expense = expenses.find(e => e.id === id);
      if (expense) {
        setAmount(expense.amount.toString());
        setCategory(expense.category);
        setNote(expense.note || '');
        setDate(expense.date);
        setPaidBy(expense.paidBy || people[0] || 'Trip Wallet');
        setSplitWith(expense.participants && expense.participants.length > 0 ? expense.participants : people);
        setTagsInput((expense.tags || []).join(', '));
        const legacyReceipts = expense.receiptImage ? [{ image: expense.receiptImage, name: expense.receiptName }] : [];
        setReceipts((expense.receipts && expense.receipts.length > 0) ? expense.receipts : legacyReceipts);
      }
    }
  }, [id, isEditing, expenses, people]);

  useEffect(() => {
    if (isEditing) return;

    if (people.length === 0) {
      setPaidBy('Trip Wallet');
      setSplitWith([]);
      return;
    }

    setPaidBy((prev) => (people.includes(prev) ? prev : people[0]));
    setSplitWith((prev) => {
      if (prev.length === 0) return people;
      const filtered = prev.filter((person) => people.includes(person));
      return filtered.length > 0 ? filtered : people;
    });
  }, [isEditing, people]);

  useEffect(() => {
    if (isEditing) return;

    const amountParam = searchParams.get('amount');
    if (amountParam) {
      const value = parseFloat(amountParam);
      if (!isNaN(value) && value > 0) {
        setAmount(value.toString());
      }
    }

    const categoryParam = searchParams.get('category') as Expense['category'] | null;
    if (categoryParam && ['Food', 'Travel', 'Stay', 'Misc'].includes(categoryParam)) {
      setCategory(categoryParam);
    }

    const dateParam = searchParams.get('date');
    if (dateParam) {
      const parsed = parseISO(dateParam);
      if (isValid(parsed)) {
        setDate(format(parsed, 'yyyy-MM-dd'));
      }
    }
  }, [isEditing, searchParams]);

  // Smart category suggestion when note changes
  const handleNoteChange = useCallback((value: string) => {
    setNote(value);
    if (!isEditing) {
      const suggested = suggestCategory(value, categories);
      if (suggested) setCategory(suggested);
    }
  }, [categories, isEditing]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amount || isNaN(parseFloat(amount))) {
      setError('Please enter a valid amount.');
      return;
    }
    if (amountError) {
      setError(amountError);
      return;
    }
    if (isLocked) {
      setError('Editing is locked for previous days. Change the date or disable day lock in settings.');
      return;
    }

    const amountNum = parseFloat(amount);
    if (amountNum <= 0 || amountNum > AMOUNT_MAX) {
      setError(`Amount must be between ₹0.01 and ₹${AMOUNT_MAX.toLocaleString('en-IN')}.`);
      return;
    }
    const tagsError = validateTags(tagsInput);
    if (tagsError) { setError(tagsError); return; }
    const tags = parseTags(tagsInput);

    const expenseData: Expense = {
      id: isEditing ? id : crypto.randomUUID(),
      amount: amountNum,
      category,
      note: note.trim(),
      date,
      paidBy,
      participants: splitWith.length > 0 ? splitWith : people,
      tags,
      receipts,
      receiptImage: receipts[0]?.image,
      receiptName: receipts[0]?.name,
      ...(!isEditing && { createdAt: new Date().toISOString() }),
    };

    if (!isEditing) {
      const dup = findDuplicate(expenses, amountNum, paidBy, date, id);
      if (dup) {
        setPendingExpense(expenseData);
        setShowDuplicateWarning(dup);
        return;
      }

      if (dailyLimit > 0 && amountNum > dailyLimit) {
        setPendingExpense(expenseData);
        setShowLargeExpenseConfirm(true);
        return;
      }
    }

    if (isEditing) {
      onUpdate(expenseData);
    } else {
      onAdd(expenseData);
    }
    navigate('/expenses');
  }, [amount, category, dailyLimit, date, expenses, id, isEditing, isLocked, navigate, onAdd, onUpdate, paidBy, people, receipts, splitWith, tagsInput, note]);

  const commitExpense = useCallback(() => {
    if (!pendingExpense) return;
    if (isEditing) onUpdate(pendingExpense);
    else onAdd(pendingExpense);
    setPendingExpense(null);
    setShowDuplicateWarning(null);
    setShowLargeExpenseConfirm(false);
    navigate('/expenses');
  }, [pendingExpense, isEditing, onUpdate, onAdd, navigate]);

  const clearDuplicateWarning = useCallback(() => {
    setShowDuplicateWarning(null);
    setPendingExpense(null);
  }, []);

  const clearLargeExpenseWarning = useCallback(() => {
    setShowLargeExpenseConfirm(false);
    setPendingExpense(null);
  }, []);

  const handleQuickAmount = useCallback((val: number) => {
    setAmount(prev => (parseFloat(prev) || 0) + val + '');
  }, []);

  const addReceiptFromDataUrl = useCallback(async (dataUrl: string, fileName?: string) => {
    const compressed = await compressReceipt(dataUrl);
    if (estimateBytesFromDataUrl(compressed) > MAX_RECEIPT_ESTIMATED_BYTES) {
      throw new Error('Receipt is too large. Please use a smaller image.');
    }
    setReceipts((prev) => [...prev, { image: compressed, name: fileName }]);
  }, []);

  const handleReceiptUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setError('');
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        await addReceiptFromDataUrl(dataUrl, file.name);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not process that image. Try another receipt photo.');
    }
    event.target.value = '';
  }, [addReceiptFromDataUrl]);

  const handleCameraCapture = useCallback(async () => {
    setError('');
    try {
      const photo = await Camera.getPhoto({ quality: 80, resultType: CameraResultType.DataUrl, source: CameraSource.Camera });
      if (!photo.dataUrl) { setError('Could not capture image.'); return; }
      await addReceiptFromDataUrl(photo.dataUrl, `Camera_${Date.now()}.jpg`);
    } catch {
      setError('Camera capture cancelled or failed.');
    }
  }, [addReceiptFromDataUrl]);

  const handleExtractFromReceipt = useCallback(async () => {
    if (receipts.length === 0) { setError('Attach at least one receipt first.'); return; }
    setError('');
    setOcrLoading(true);
    try {
      // Lazy load tesseract — only pulled when actually needed (~300KB saved from initial bundle)
      const { recognize } = await import('tesseract.js');
      const { data } = await recognize(receipts[0].image, 'eng');
      const extracted = extractReceiptFields(data.text || '');

      if (extracted.amount && (!amount || parseFloat(amount) <= 0)) setAmount(extracted.amount.toString());
      if (extracted.date) {
        const parsedDate = parseISO(extracted.date);
        if (isValid(parsedDate)) setDate(format(parsedDate, 'yyyy-MM-dd'));
      }
      if (extracted.vendor && !note.trim()) setNote(extracted.vendor);

      if (data.text && isAIConfigured()) {
        try {
          const aiResult = await categorizeExpenseWithAI(data.text, categories, extracted.amount || undefined);
          if (aiResult) setCategory(aiResult.category);
        } catch { /* AI categorization is optional */ }
      }
    } catch {
      setError('OCR extraction failed. Try a clearer receipt image.');
    } finally {
      setOcrLoading(false);
    }
  }, [receipts, amount, note, categories]);

  const handleVoiceAdd = useCallback(async () => {
    setError('');
    if (Capacitor.isNativePlatform()) {
      try {
        const availability = await SpeechRecognition.available();
        if (!availability.available) { setError('Voice recognition is unavailable on this device.'); return; }
        const permissionState = await SpeechRecognition.checkPermissions();
        if (permissionState.speechRecognition !== 'granted') {
          const request = await SpeechRecognition.requestPermissions();
          if (request.speechRecognition !== 'granted') { setError('Microphone permission is required for voice add.'); return; }
        }
        const result = await SpeechRecognition.start({ language: 'en-IN', maxResults: 1, partialResults: false, popup: true, prompt: 'Speak your expense, for example: Spent 250 on food' });
        const transcript = result.matches?.[0];
        if (!transcript) { setError('Could not hear clearly. Try again.'); return; }
        applyVoiceTranscript(transcript, setAmount, setCategory, setNote);
        return;
      } catch {
        setError('Voice recognition failed. Please try again.');
        return;
      }
    }

    const SpeechRecognitionImpl = (
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition
    );
    if (!SpeechRecognitionImpl) { setError('Voice input is not supported on this device.'); return; }

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => applyVoiceTranscript(event.results[0][0].transcript, setAmount, setCategory, setNote);
    recognition.onerror = () => setError('Voice recognition failed. Please try again.');
    recognition.start();
  }, []);

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title">{isEditing ? 'Edit Expense' : 'Add Expense'}</h1>
        <p className="page-subtitle">{isEditing ? 'Update your spending details' : 'Record a new spending'}</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-700 text-sm font-medium">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {isLocked && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-700 text-sm font-medium">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          Editing is locked for previous days.
        </div>
      )}

      <motion.form 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={handleSubmit} 
        className="space-y-6 bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100"
      >
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-slate-400" />
              Amount (₹)
            </label>
            <button
              type="button"
              onClick={handleVoiceAdd}
              className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold inline-flex items-center gap-1"
            >
              <Mic className="w-3 h-3" />
              Voice Add
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mb-2">e.g. "Spent 250 on food"</p>
          <input
            type="number"
            required
            autoFocus={!isEditing}
            disabled={isLocked}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            max="9999999"
            step="0.01"
            className={`w-full px-4 py-4 text-2xl font-bold rounded-2xl border focus:outline-none focus:ring-2 transition-all disabled:opacity-50 ${
              amountError
                ? 'border-red-400 focus:ring-red-400 bg-red-50'
                : 'border-slate-200 focus:ring-blue-500'
            }`}
          />
          {amountError && (
            <p className="mt-1.5 text-xs font-semibold text-red-500 flex items-center gap-1">
              <span>⚠</span> {amountError}
            </p>
          )}
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            {QUICK_AMOUNTS.map(val => (
              <button
                key={val}
                type="button"
                disabled={isLocked}
                onClick={() => handleQuickAmount(val)}
                className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors whitespace-nowrap"
              >
                +₹{val}
              </button>
            ))}
            <button
              type="button"
              disabled={isLocked}
              onClick={() => setAmount('')}
              className="px-4 py-2 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-500 hover:bg-red-100 transition-colors whitespace-nowrap"
            >
              Clear
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            Date
          </label>
          <DatePicker value={date} onChange={setDate} disabled={Boolean(isLocked)} />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <User className="w-4 h-4 text-slate-400" />
            Paid by
          </label>
          <PaidBySelect people={paidByPeople} value={paidBy} onChange={setPaidBy} disabled={Boolean(isLocked)} />
        </div>

        {people.length > 1 && (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              Split between
              <span className="ml-auto text-xs font-normal text-slate-400">{splitWith.length} of {people.length}</span>
            </label>
            <SplitSelect
              people={people}
              selected={splitWith}
              paidBy={paidBy}
              disabled={Boolean(isLocked)}
              onChange={setSplitWith}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-slate-400" />
            Category
          </label>
          <div className="grid grid-cols-2 gap-3">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                disabled={isLocked}
                onClick={() => setCategory(cat)}
                className={`py-3 px-4 rounded-2xl font-bold text-sm transition-all border ${
                  category === cat 
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-100' 
                    : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" />
            Note (Optional)
          </label>
          <input
            type="text"
            disabled={isLocked}
            value={note}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="What was this for?"
            maxLength={MAX_NOTE_LENGTH}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          {showCounter(note, MAX_NOTE_LENGTH) && (
            <p className="text-[11px] text-slate-400 mt-1 text-right">{note.length}/{MAX_NOTE_LENGTH}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <Tag className="w-4 h-4 text-slate-400" />
            Tags (comma separated)
          </label>
          <input
            type="text"
            disabled={isLocked}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="snacks, airport, museum"
            maxLength={MAX_TAGS_INPUT_LENGTH}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          {showCounter(tagsInput, MAX_TAGS_INPUT_LENGTH) && (
            <p className="text-[11px] text-slate-400 mt-1 text-right">{tagsInput.length}/{MAX_TAGS_INPUT_LENGTH}</p>
          )}
          <p className="text-[11px] text-slate-400 mt-1">Max {MAX_TAGS_COUNT} tags</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <ReceiptText className="w-4 h-4 text-slate-400" />
            Receipt (Optional)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="px-4 py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 flex items-center justify-center gap-2 cursor-pointer hover:border-blue-400 transition-all">
              <ImageIcon className="w-4 h-4" />
              Upload
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={isLocked}
                onChange={handleReceiptUpload}
                className="hidden"
              />
            </label>

            <button
              type="button"
              disabled={isLocked}
              onClick={handleCameraCapture}
              className="px-4 py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 flex items-center justify-center gap-2 hover:border-blue-400 transition-all"
            >
              <CameraIcon className="w-4 h-4" />
              Camera
            </button>
          </div>

          <button
            type="button"
            disabled={isLocked || ocrLoading || receipts.length === 0}
            onClick={handleExtractFromReceipt}
            className="mt-2 w-full px-4 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-sm font-semibold disabled:bg-slate-100 disabled:text-slate-400 inline-flex items-center justify-center gap-2"
          >
            <ScanText className="w-4 h-4" />
            {ocrLoading ? 'Extracting...' : 'Extract Amount/Date/Vendor (OCR)'}
          </button>

          {receipts.length > 0 && (
            <div className="mt-3 p-3 bg-slate-50 border border-slate-100 rounded-2xl">
              <p className="text-xs font-semibold text-slate-500 mb-2">Receipts ({receipts.length})</p>
              <div className="grid grid-cols-3 gap-2">
                {receipts.map((receipt, idx) => (
                  <div key={`receipt-${idx}`} className="relative">
                    <img src={receipt.image} alt={receipt.name || `Receipt ${idx + 1}`} className="w-full h-20 object-cover rounded-xl" />
                    <button
                      type="button"
                      onClick={() => setReceipts((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-2 -right-2 p-1 rounded-full bg-white shadow text-slate-500 hover:text-red-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {isExpenseOutsideTripDates && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2 text-amber-700 text-xs font-medium">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{dateWarningText} The expense will still be saved.</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isLocked}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
        >
          {isEditing ? <Save className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {isEditing ? 'Update Expense' : 'Save Expense'}
        </button>
      </motion.form>

      {/* Duplicate warning bottom sheet */}
      <AnimatePresence>
        {showDuplicateWarning && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-[70]" onClick={clearDuplicateWarning} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[80] bg-white rounded-t-3xl p-6 shadow-2xl max-w-md mx-auto"
              style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
            >
              <div className="flex justify-center mb-3">
                <div className="w-10 h-1 bg-slate-200 rounded-full" />
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="font-black text-slate-900">Possible Duplicate</p>
                  <p className="text-xs text-slate-500 mt-0.5">A similar expense was added recently</p>
                </div>
              </div>
              <div className="bg-slate-50 rounded-2xl p-3 mb-5 text-sm text-slate-600">
                <span className="font-semibold">{formatCurrency(showDuplicateWarning.amount)}</span>
                {' · '}{showDuplicateWarning.category}
                {showDuplicateWarning.note && ` · ${showDuplicateWarning.note}`}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={clearDuplicateWarning}
                  className="py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm">
                  Cancel
                </button>
                <button onClick={commitExpense}
                  className="py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm">
                  Add Anyway
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Large expense confirmation */}
      <AnimatePresence>
        {showLargeExpenseConfirm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-[70]" onClick={clearLargeExpenseWarning} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[80] bg-white rounded-t-3xl p-6 shadow-2xl max-w-md mx-auto"
              style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
            >
              <div className="flex justify-center mb-3">
                <div className="w-10 h-1 bg-slate-200 rounded-full" />
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-red-50 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="font-black text-slate-900">Large Expense</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatCurrency(parseFloat(amount))} exceeds your daily limit of {formatCurrency(dailyLimit)}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={clearLargeExpenseWarning}
                  className="py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm">
                  Cancel
                </button>
                <button onClick={commitExpense}
                  className="py-3 rounded-2xl bg-red-600 text-white font-bold text-sm">
                  Add Anyway
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
