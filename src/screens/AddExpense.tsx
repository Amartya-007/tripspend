import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Expense, TripSetup, getTripCategories } from '../utils/calculations.ts';
import { categorizeExpenseWithAI, isAIConfigured } from '../utils/aiCategorization.ts';
import { IndianRupee, Tag, FileText, Calendar, Plus, Save, AlertCircle, ReceiptText, Image as ImageIcon, X, Camera as CameraIcon, ScanText, Mic } from 'lucide-react';
import { motion } from 'motion/react';
import { format, isBefore, isValid, parseISO, startOfDay } from 'date-fns';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { recognize } from 'tesseract.js';

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

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Expense['category']>('Food');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [tagsInput, setTagsInput] = useState('');
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiCategorizing, setAiCategorizing] = useState(false);

  const isLocked = setup?.lockPreviousDays && isBefore(startOfDay(parseISO(date)), startOfDay(new Date()));

  useEffect(() => {
    if (isEditing) {
      const expense = expenses.find(e => e.id === id);
      if (expense) {
        setAmount(expense.amount.toString());
        setCategory(expense.category);
        setNote(expense.note || '');
        setDate(expense.date);
        setTagsInput((expense.tags || []).join(', '));
        const legacyReceipts = expense.receiptImage ? [{ image: expense.receiptImage, name: expense.receiptName }] : [];
        setReceipts((expense.receipts && expense.receipts.length > 0) ? expense.receipts : legacyReceipts);
      }
    }
  }, [id, isEditing, expenses]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amount || isNaN(parseFloat(amount)) || isLocked) return;

    const amountNum = parseFloat(amount);

    const tags = tagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    const expenseData: Expense = {
      id: isEditing ? id : crypto.randomUUID(),
      amount: amountNum,
      category,
      note: note.trim(),
      date,
      paidBy: 'Trip Wallet',
      tags,
      receipts,
      receiptImage: receipts[0]?.image,
      receiptName: receipts[0]?.name
    };

    if (isEditing) {
      onUpdate(expenseData);
    } else {
      onAdd(expenseData);
    }
    navigate('/expenses');
  };

  const categories = getTripCategories(setup);
  const quickAmounts = [50, 100, 200, 500];

  const handleQuickAmount = (val: number) => {
    const current = parseFloat(amount) || 0;
    setAmount((current + val).toString());
  };

  const addReceiptFromDataUrl = async (dataUrl: string, fileName?: string) => {
    const compressed = await compressReceipt(dataUrl);
    const estimatedBytes = estimateBytesFromDataUrl(compressed);
    if (estimatedBytes > MAX_RECEIPT_ESTIMATED_BYTES) {
      throw new Error('Receipt is too large. Please use a smaller image.');
    }

    setReceipts((prev) => [...prev, { image: compressed, name: fileName }]);
  };

  const handleReceiptUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setError('');
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        await addReceiptFromDataUrl(dataUrl, file.name);
      }
    } catch (uploadError) {
      if (uploadError instanceof Error) {
        setError(uploadError.message);
      } else {
        setError('Could not process that image. Try another receipt photo.');
      }
    }

    event.target.value = '';
  };

  const handleCameraCapture = async () => {
    setError('');
    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      });

      if (!photo.dataUrl) {
        setError('Could not capture image.');
        return;
      }

      await addReceiptFromDataUrl(photo.dataUrl, `Camera_${Date.now()}.jpg`);
    } catch {
      setError('Camera capture cancelled or failed.');
    }
  };

  const handleExtractFromReceipt = async () => {
    if (receipts.length === 0) {
      setError('Attach at least one receipt first.');
      return;
    }

    setError('');
    setOcrLoading(true);
    try {
      const { data } = await recognize(receipts[0].image, 'eng');
      const extracted = extractReceiptFields(data.text || '');

      if (extracted.amount && (!amount || parseFloat(amount) <= 0)) {
        setAmount(extracted.amount.toString());
      }

      if (extracted.date) {
        const parsedDate = parseISO(extracted.date);
        if (isValid(parsedDate)) {
          setDate(format(parsedDate, 'yyyy-MM-dd'));
        }
      }

      if (extracted.vendor && !note.trim()) {
        setNote(extracted.vendor);
      }
      // Try AI categorization
      if (data.text && isAIConfigured()) {
        setAiCategorizing(true);
        try {
          const aiResult = await categorizeExpenseWithAI(data.text, categories, extracted.amount || undefined);
          if (aiResult) {
            setCategory(aiResult.category);
          }
        } catch {
          // Silently fail - AI categorization is optional
        } finally {
          setAiCategorizing(false);
        }
      }
    } catch {
      setError('OCR extraction failed. Try a clearer receipt image.');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleVoiceAdd = async () => {
    setError('');

    if (Capacitor.isNativePlatform()) {
      try {
        const availability = await SpeechRecognition.available();
        if (!availability.available) {
          setError('Voice recognition is unavailable on this device.');
          return;
        }

        const permissionState = await SpeechRecognition.checkPermissions();
        if (permissionState.speechRecognition !== 'granted') {
          const request = await SpeechRecognition.requestPermissions();
          if (request.speechRecognition !== 'granted') {
            setError('Microphone permission is required for voice add.');
            return;
          }
        }

        const result = await SpeechRecognition.start({
          language: 'en-IN',
          maxResults: 1,
          partialResults: false,
          popup: true,
          prompt: 'Speak your expense, for example: Spent 250 on food'
        });

        const transcript = result.matches?.[0];
        if (!transcript) {
          setError('Could not hear clearly. Try again.');
          return;
        }

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

    if (!SpeechRecognitionImpl) {
      setError('Voice input is not supported on this device.');
      return;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      applyVoiceTranscript(transcript, setAmount, setCategory, setNote);
    };

    recognition.onerror = () => {
      setError('Voice recognition failed. Please try again.');
    };

    recognition.start();
  };

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
            autoFocus
            disabled={isLocked}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full px-4 py-4 text-2xl font-bold rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
          />
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            {quickAmounts.map(val => (
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
          <input
            type="date"
            disabled={isLocked}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
          />
        </div>

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
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was this for?"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
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
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
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

        <button
          type="submit"
          disabled={isLocked}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
        >
          {isEditing ? <Save className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          {isEditing ? 'Update Expense' : 'Save Expense'}
        </button>
      </motion.form>
    </div>
  );
};
