import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, IndianRupee, ArrowRight, Lock, Tag, X, Plus, Check } from 'lucide-react';
import { TripSetup } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { motion, AnimatePresence } from 'motion/react';
import { format, addDays } from 'date-fns';
import { DatePicker } from '../components/DatePicker.tsx';
import { NotificationCard } from '../components/NotificationCard.tsx';
import { Capacitor } from '@capacitor/core';
import { Contacts, ContactPayload } from '@capacitor-community/contacts';
import {
  MAX_TRIP_NAME_LENGTH,
  MAX_PARTICIPANT_NAME_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  MIN_PEOPLE,
  MAX_PEOPLE,
  MAX_BUDGET_PER_PERSON,
  DEFAULT_CATEGORIES,
  BUDGET_REGEX,
} from '../utils/constants.ts';
import { isDuplicate, sanitize } from '../utils/validation.ts';

type MemberContactChoice = {
  contactId: string;
  name: string;
  phoneNumber: string;
};

interface SetupScreenProps {
  onSave: (setup: TripSetup) => void | boolean | Promise<void | boolean>;
  initialData?: TripSetup | null;
  onNameTrip?: (name: string) => void;
  initialTripName?: string;
}

const STEPS = ['people-count', 'people-names', 'budget', 'dates', 'categories'] as const;

export const SetupScreen: React.FC<SetupScreenProps> = ({ onSave, initialData, onNameTrip, initialTripName }) => {
  const [step, setStep] = useState<'people-count' | 'people-names' | 'budget' | 'dates' | 'categories'>('people-count');
  const [peopleCount, setPeopleCount] = useState(initialData?.peopleCount?.toString() || '');
  const [participants, setParticipants] = useState<string[]>(initialData?.participants || []);
  const [participantPhoneNumbers, setParticipantPhoneNumbers] = useState<Record<string, string>>(() => {
    const phoneByName = initialData?.participantPhoneNumbers || {};
    const initialParticipants = initialData?.participants || [];
    const byIndex: Record<string, string> = {};

    for (let i = 0; i < initialParticipants.length; i += 1) {
      const name = initialParticipants[i]?.trim();
      if (!name) continue;
      const phone = phoneByName[name];
      if (phone) byIndex[String(i)] = phone;
    }

    return byIndex;
  });
  const [budget, setBudget] = useState(initialData?.budgetPerPerson?.toString() || '');
  const [startDate, setStartDate] = useState(initialData?.startDate || format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(initialData?.endDate || format(addDays(new Date(), 3), 'yyyy-MM-dd'));
  const [lockPrevious, setLockPrevious] = useState(initialData?.lockPreviousDays || false);
  const [categories, setCategories] = useState<string[]>(initialData?.customCategories || [...DEFAULT_CATEGORIES]);
  const [newCategory, setNewCategory] = useState('');
  const [tripName, setTripName] = useState(initialTripName || '');
  const [memberContactPickerOpen, setMemberContactPickerOpen] = useState(false);
  const [memberContactPickerLoading, setMemberContactPickerLoading] = useState(false);
  const [memberContactPickerError, setMemberContactPickerError] = useState('');
  const [memberContactSearch, setMemberContactSearch] = useState('');
  const [memberContactChoices, setMemberContactChoices] = useState<MemberContactChoice[]>([]);
  const [selectedMemberContactIds, setSelectedMemberContactIds] = useState<string[]>([]);
  const [setupWarning, setSetupWarning] = useState('');

  const navigate = useNavigate();

  const peopleNum = useMemo(() => parseInt(peopleCount) || 0, [peopleCount]);
  const budgetNum = useMemo(() => parseFloat(budget) || 0, [budget]);
  const totalBudget = useMemo(() => peopleNum * budgetNum, [peopleNum, budgetNum]);
  const trimmedNewCategory = useMemo(() => newCategory.trim(), [newCategory]);
  const canAddCategory = useMemo(() => Boolean(trimmedNewCategory) && trimmedNewCategory.length <= MAX_CATEGORY_NAME_LENGTH && !isDuplicate(trimmedNewCategory, categories), [trimmedNewCategory, categories]);
  const needsParticipantRemoval = useMemo(() => participants.length > peopleNum, [participants.length, peopleNum]);
  const currentStepIndex = useMemo(() => STEPS.indexOf(step), [step]);
  const maxContactSelections = useMemo(() => Math.max(0, peopleNum - 1), [peopleNum]);
  const selectedMemberContacts = useMemo(() => {
    const selectedIds = new Set(selectedMemberContactIds);
    return memberContactChoices.filter((contact) => selectedIds.has(contact.contactId));
  }, [memberContactChoices, selectedMemberContactIds]);
  const setupNotification = useMemo(
    () => (setupWarning
      ? {
        id: Date.now(),
        title: 'Please check this',
        message: setupWarning,
        variant: 'warning' as const,
        durationMs: 4200,
      }
      : null),
    [setupWarning]
  );

  useEffect(() => {
    if (endDate < startDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  const handlePeopleCountNext = useCallback(() => {
    if (peopleNum < MIN_PEOPLE || peopleNum > MAX_PEOPLE) {
      setSetupWarning(`Please enter between ${MIN_PEOPLE} and ${MAX_PEOPLE} people.`);
      return;
    }
    if (!initialData) {
      const cleanName = tripName.trim();
      if (!cleanName) {
        setSetupWarning('Please name your trip before continuing.');
        return;
      }
    }
    setSetupWarning('');
    if (peopleNum >= participants.length) {
      setParticipants(prev =>
        Array.from({ length: peopleNum }, (_, i) => {
          if (i === 0) return prev[0]?.trim() || 'You';
          return prev[i]?.trim() || `Person ${i + 1}`;
        })
      );
    }
    setStep('people-names');
  }, [initialData, peopleNum, participants.length, tripName]);

  const updateParticipantName = useCallback((index: number, name: string) => {
    const updated = [...participants];
    updated[index] = name;
    setParticipants(updated);
  }, [participants]);

  const removeParticipant = useCallback((idx: number) => {
    setParticipants(prev => prev.filter((_, i) => i !== idx));
    setParticipantPhoneNumbers((prev) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        const oldIndex = Number(key);
        if (!Number.isInteger(oldIndex)) continue;
        if (oldIndex === idx) continue;
        const newIndex = oldIndex > idx ? oldIndex - 1 : oldIndex;
        next[String(newIndex)] = value;
      }
      return next;
    });
  }, []);

  const readContactDisplayName = useCallback((contact: ContactPayload) => {
    const name = contact.name;
    if (!name) return '';
    const display = (name.display || '').trim();
    if (display) return display;
    return [name.given, name.middle, name.family].filter(Boolean).join(' ').trim();
  }, []);

  const closeMemberContactPicker = useCallback(() => {
    setMemberContactPickerOpen(false);
    setMemberContactPickerLoading(false);
    setMemberContactPickerError('');
    setMemberContactSearch('');
    setMemberContactChoices([]);
    setSelectedMemberContactIds([]);
  }, []);

  const buildContactChoice = useCallback((contact: ContactPayload): MemberContactChoice => {
    const name = readContactDisplayName(contact);
    const phoneNumber = contact.phones?.find((phone) => Boolean(phone?.number))?.number?.trim() || '';
    return {
      contactId: contact.contactId?.trim() || `${name || phoneNumber}-${phoneNumber}`,
      name: name || phoneNumber,
      phoneNumber,
    };
  }, [readContactDisplayName]);

  const applyContactsToParticipants = useCallback((contacts: MemberContactChoice[]) => {
    // Contacts fill slots 1..N — slot 0 is always "You"
    const limitedContacts = contacts.slice(0, peopleNum - 1);

    setParticipants((prev) =>
      Array.from({ length: peopleNum }, (_, index) => {
        if (index === 0) return prev[0]?.trim() || 'You';
        const pickedContact = limitedContacts[index - 1];
        return pickedContact?.name?.trim() || prev[index]?.trim() || `Person ${index + 1}`;
      })
    );

    setParticipantPhoneNumbers(() => {
      const next: Record<string, string> = {};
      limitedContacts.forEach((contact, index) => {
        const phone = contact.phoneNumber.trim();
        // index 0 in contacts → participant index 1
        if (phone) next[String(index + 1)] = phone;
      });
      return next;
    });

    closeMemberContactPicker();
  }, [closeMemberContactPicker, peopleNum]);

  const toggleMemberContactSelection = useCallback((contactId: string) => {
    if (maxContactSelections === 0) return;

    setSelectedMemberContactIds((prev) => (
      prev.includes(contactId)
        ? prev.filter((id) => id !== contactId)
        : prev.length >= maxContactSelections
          ? prev
          : [...prev, contactId]
    ));
  }, [maxContactSelections]);

  const openMemberContactsPicker = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setSetupWarning('Contact picker is available on native app builds only.');
      return;
    }

    try {
      setMemberContactPickerError('');
      setMemberContactPickerLoading(true);

      let permission = await Contacts.checkPermissions();
      if (permission.contacts !== 'granted' && permission.contacts !== 'limited') {
        permission = await Contacts.requestPermissions();
      }

      if (permission.contacts !== 'granted' && permission.contacts !== 'limited') {
        setSetupWarning('Contacts permission denied. You can still enter names manually.');
        return;
      }

      const response = await Contacts.getContacts({
        projection: {
          name: true,
          phones: true,
        },
      });

      const contacts = (response.contacts || [])
        .map(buildContactChoice)
        .filter((contact) => Boolean(contact.name || contact.phoneNumber));

      if (contacts.length === 0) {
        setMemberContactPickerError('No contacts with names or phone numbers were found on this device.');
        return;
      }

      setMemberContactChoices(contacts);
      setSelectedMemberContactIds([]);
      setMemberContactPickerOpen(true);
    } catch (error) {
      console.error('Failed to load contacts', error);
      setMemberContactPickerError('Could not load contacts on this device. You can still type names manually.');
      setSetupWarning('Could not load contacts. You can still type names manually.');
    } finally {
      setMemberContactPickerLoading(false);
    }
  }, [buildContactChoice]);

  const applySelectedMemberContacts = useCallback(() => {
    if (selectedMemberContacts.length === 0) {
      setMemberContactPickerError('Select at least 1 contact, or close and type names manually.');
      return;
    }

    applyContactsToParticipants(selectedMemberContacts);
  }, [applyContactsToParticipants, selectedMemberContacts]);

  const filteredContacts = useMemo(() => {
    const query = memberContactSearch.trim().toLowerCase();
    if (!query) return memberContactChoices;
    return memberContactChoices.filter((contact) => (
      contact.name.toLowerCase().includes(query) || contact.phoneNumber.toLowerCase().includes(query)
    ));
  }, [memberContactChoices, memberContactSearch]);

  const handleAddCategory = useCallback(() => {
    if (canAddCategory) {
      setCategories([...categories, sanitize(trimmedNewCategory)]);
      setNewCategory('');
    }
  }, [canAddCategory, categories, trimmedNewCategory]);

  const handleRemoveCategory = useCallback((idx: number) => {
    if (categories.length > 1) {
      setCategories(categories.filter((_, i) => i !== idx));
    }
  }, [categories]);

  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (peopleNum < MIN_PEOPLE || peopleNum > MAX_PEOPLE) {
      setSetupWarning(`People count must be between ${MIN_PEOPLE} and ${MAX_PEOPLE}.`);
      return;
    }
    if (budgetNum <= 0 || budgetNum > MAX_BUDGET_PER_PERSON) {
      setSetupWarning(`Budget per person must be between 1 and ${formatCurrency(MAX_BUDGET_PER_PERSON)}.`);
      return;
    }
    if (endDate < startDate) {
      setSetupWarning('End date cannot be before start date.');
      return;
    }

    if (peopleNum > 0 && budgetNum > 0 && startDate && endDate) {
      if (!initialData && onNameTrip) {
        const cleanName = tripName.trim();
        if (!cleanName) {
          setSetupWarning('Please name your trip before starting.');
          return;
        }
        onNameTrip(cleanName);
      }

      setSetupWarning('');
      setSaving(true);
      try {
        const result = await Promise.resolve(onSave({
          peopleCount: peopleNum,
          budgetPerPerson: budgetNum,
          totalBudget,
          startDate,
          endDate,
          lockPreviousDays: lockPrevious,
          participants: participants.filter(p => p.trim()),
          participantPhoneNumbers: participants.reduce<Record<string, string>>((acc, person, index) => {
            const name = person.trim();
            const phone = participantPhoneNumbers[String(index)]?.trim();
            if (name && phone) acc[name] = phone;
            return acc;
          }, {}),
          customCategories: categories.filter(c => c.trim()),
        }));

        // onSave may not report a result at all (local/offline mode always succeeds
        // synchronously), so only a literal `false` is treated as a real failure.
        if (result === false) {
          setSetupWarning('Could not save your trip. Please check your connection and try again.');
          return;
        }

        navigate('/');
      } catch (error) {
        console.error('[SetupScreen] Failed to save trip setup.', error);
        setSetupWarning('Could not save your trip. Please check your connection and try again.');
      } finally {
        setSaving(false);
      }
    }
  }, [budgetNum, categories, endDate, initialData, lockPrevious, navigate, onNameTrip, onSave, participantPhoneNumbers, participants, peopleNum, startDate, totalBudget, tripName]);

  const handlePeopleCountChange = useCallback((value: string) => {
    setSetupWarning('');
    const digitsOnly = value.replace(/\D/g, '');
    if (!digitsOnly) {
      setPeopleCount('');
      return;
    }
    const parsed = Number(digitsOnly);
    if (!Number.isFinite(parsed)) return;
    setPeopleCount(String(Math.min(MAX_PEOPLE, Math.max(0, parsed))));
  }, []);

  const handleBudgetChange = useCallback((value: string) => {
    setSetupWarning('');
    if (!BUDGET_REGEX.test(value)) return;
    if (!value) {
      setBudget('');
      return;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    if (parsed > MAX_BUDGET_PER_PERSON) {
      setBudget(String(MAX_BUDGET_PER_PERSON));
      return;
    }
    setBudget(value);
  }, []);

  const handleTripNameChange = useCallback((value: string) => {
    setSetupWarning('');
    setTripName(value.slice(0, MAX_TRIP_NAME_LENGTH));
  }, []);

  const toggleLockPrevious = useCallback(() => {
    setLockPrevious(prev => !prev);
  }, []);

  const goToStep = useCallback((nextStep: typeof step) => {
    setStep(nextStep);
  }, []);

  const handleNewCategoryChange = useCallback((value: string) => {
    setNewCategory(value);
  }, []);

  const goBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 px-4 py-7 flex flex-col items-center justify-center">
      <NotificationCard notification={setupNotification} onClose={() => setSetupWarning('')} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md card-premium shadow-2xl p-8"
      >
        {/* Progress dots */}
        <div className="flex justify-between items-center mb-8">
          {STEPS.map((s, idx) => (
            <motion.div
              key={s}
              className={`h-2 rounded-full transition-all duration-300 ${
                step === s ? 'bg-blue-600 w-8' :
                currentStepIndex > idx ? 'bg-blue-300 w-2' : 'bg-slate-200 w-2'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">

          {/* STEP 1 — People Count */}
          {step === 'people-count' && (
            <motion.div key="people-count" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <div className="text-center mb-8">
                <h1 className="text-3xl font-black bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">Trip Setup</h1>
                <p className="text-slate-500 mt-2 text-sm">Name the trip, then choose who is joining</p>
              </div>
              {!initialData && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Trip Name</label>
                  <input
                    type="text"
                    value={tripName}
                    onChange={(e) => handleTripNameChange(e.target.value)}
                    placeholder="e.g. Goa Friends 2026"
                    maxLength={MAX_TRIP_NAME_LENGTH}
                    className="input-field text-sm"
                  />
                  <p className="text-[11px] text-slate-400 mt-1 text-right">{tripName.length}/{MAX_TRIP_NAME_LENGTH}</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <div className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center">
                    <Users className="w-3 h-3 text-blue-600" />
                  </div>
                  Number of People
                </label>
                <input
                  type="number" min={MIN_PEOPLE} max={MAX_PEOPLE} autoFocus
                  value={peopleCount}
                  onChange={(e) => handlePeopleCountChange(e.target.value)}
                  placeholder="e.g. 4"
                  className="input-field text-4xl font-black text-center"
                />
                <p className="text-xs text-slate-400 mt-2 text-center">{MIN_PEOPLE}–{MAX_PEOPLE} people</p>
              </div>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handlePeopleCountNext} disabled={peopleNum < MIN_PEOPLE || peopleNum > MAX_PEOPLE} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed">
                Next →
              </motion.button>
            </motion.div>
          )}

          {/* STEP 2 — Names */}
          {step === 'people-names' && (
            <motion.div key="people-names" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
              <div className="text-center mb-4">
                <h1 className="text-2xl font-black text-slate-900">Who's who?</h1>
                <p className="text-slate-500 mt-1 text-sm">Enter names for each participant</p>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 space-y-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">Speed up with contacts</p>
                  <p className="text-xs text-slate-600 mt-1">Person 1 is you. Select up to {maxContactSelections} contact{maxContactSelections === 1 ? '' : 's'} for the rest, then tap OK.</p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => { void openMemberContactsPicker(); }}
                  className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={peopleNum < MIN_PEOPLE || peopleNum > MAX_PEOPLE || maxContactSelections === 0}
                >
                  Select from Contacts
                </motion.button>
                {maxContactSelections === 0 && (
                  <p className="text-xs text-slate-500">Only 1 participant selected, so no extra contacts are needed.</p>
                )}
              </div>

              {needsParticipantRemoval && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-semibold text-amber-700 text-center">
                  Remove {participants.length - peopleNum} person{participants.length - peopleNum > 1 ? 's' : ''} to match your count of {peopleNum}
                </motion.div>
              )}

              <div className="space-y-2.5 max-h-72 overflow-y-auto px-0.5 py-0.5">
                <AnimatePresence>
                  {participants.map((name, idx) => (
                    <motion.div
                      key={idx}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="flex items-center gap-2"
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0 ${idx === 0 ? 'bg-blue-600 text-white' : 'bg-blue-50 border border-blue-100 text-blue-600'}`}>
                        {idx === 0 ? '★' : idx + 1}
                      </div>
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => updateParticipantName(idx, e.target.value.slice(0, MAX_PARTICIPANT_NAME_LENGTH))}
                          placeholder={idx === 0 ? 'You (your name)' : `Person ${idx + 1}`}
                          maxLength={MAX_PARTICIPANT_NAME_LENGTH}
                          className={`input-field text-sm w-full ${idx === 0 ? 'border-blue-300 bg-blue-50/50 font-semibold' : ''}`}
                        />
                        {idx === 0 && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded-full pointer-events-none">You</span>
                        )}
                      </div>
                      {needsParticipantRemoval && idx !== 0 && (
                        <motion.button
                          whileTap={{ scale: 0.9 }}
                          type="button"
                          onClick={() => removeParticipant(idx)}
                          className="w-8 h-8 rounded-xl bg-red-50 border border-red-100 text-red-500 hover:bg-red-100 flex items-center justify-center flex-shrink-0 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </motion.button>
                      )}
                      {needsParticipantRemoval && idx === 0 && (
                        <div className="w-8 h-8 flex-shrink-0" />
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <div className="flex gap-2 pt-1">
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => goToStep('people-count')} className="btn-secondary flex-1">← Back</motion.button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => goToStep('budget')} disabled={participants.length !== peopleNum} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">Next →</motion.button>
              </div>
            </motion.div>
          )}

          {/* STEP 3 — Budget */}
          {step === 'budget' && (
            <motion.div key="budget" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <div className="text-center mb-8">
                <h1 className="text-2xl font-black text-slate-900">Set Budget</h1>
                <p className="text-slate-500 mt-1 text-sm">Per person budget for the trip</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <div className="w-5 h-5 bg-green-100 rounded flex items-center justify-center">
                    <IndianRupee className="w-3 h-3 text-green-600" />
                  </div>
                  Budget per Person
                </label>
                <input type="number" min="1" max={MAX_BUDGET_PER_PERSON} autoFocus value={budget} onChange={(e) => handleBudgetChange(e.target.value)} placeholder="₹" className="input-field text-4xl font-black text-center overflow-hidden" />
                <p className="text-xs text-slate-400 mt-2 text-center">Max {formatCurrency(MAX_BUDGET_PER_PERSON)} per person</p>
              </div>
              <motion.div layout className="bg-gradient-to-br from-blue-50 to-blue-100 p-5 rounded-2xl border-2 border-blue-200">
                <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Total Trip Budget</p>
                <p className="text-3xl font-black text-blue-900">{formatCurrency(totalBudget)}</p>
              </motion.div>
              <div className="flex gap-2">
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => goToStep('people-names')} className="btn-secondary flex-1">← Back</motion.button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => goToStep('dates')} disabled={budgetNum <= 0 || budgetNum > MAX_BUDGET_PER_PERSON} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">Next →</motion.button>
              </div>
            </motion.div>
          )}

          {/* STEP 4 — Dates */}
          {step === 'dates' && (
            <motion.div key="dates" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <div className="text-center mb-6">
                <h1 className="text-2xl font-black text-slate-900">Trip Dates</h1>
                <p className="text-slate-500 mt-1 text-sm">When does the trip happen?</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2.5">Start Date</label>
                  <DatePicker value={startDate} onChange={setStartDate} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2.5">End Date</label>
                  <DatePicker value={endDate} onChange={setEndDate} minDate={startDate} />
                </div>
              </div>
              <div className="flex items-center justify-between bg-gradient-to-r from-slate-50 to-slate-100 p-4 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${lockPrevious ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-400'}`}>
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">Lock Past Days</p>
                    <p className="text-xs text-slate-500">Prevent edits</p>
                  </div>
                </div>
                <button onClick={toggleLockPrevious} className={`w-14 h-7 rounded-full transition-all relative shadow-sm ${lockPrevious ? 'bg-blue-600 shadow-blue-200' : 'bg-slate-300'}`}>
                  <motion.div layout className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${lockPrevious ? 'left-8' : 'left-1'}`} />
                </button>
              </div>
              <div className="flex gap-2">
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => goToStep('budget')} className="btn-secondary flex-1">← Back</motion.button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => goToStep('categories')} className="btn-primary flex-1">Next →</motion.button>
              </div>
            </motion.div>
          )}

          {/* STEP 5 — Categories */}
          {step === 'categories' && (
            <motion.div key="categories" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <div className="text-center mb-6">
                <h1 className="text-2xl font-black text-slate-900">Expense Categories</h1>
                <p className="text-slate-500 mt-1 text-sm">Customize your categories</p>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto px-0.5 py-0.5">
                <AnimatePresence>
                  {categories.map((cat, idx) => (
                    <motion.div
                      key={cat}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200"
                    >
                      <div className="flex items-center gap-2">
                        <Tag className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-sm font-semibold text-slate-700">{cat}</span>
                      </div>
                      {categories.length > 1 && (
                        <button onClick={() => handleRemoveCategory(idx)} className="p-1 text-slate-400 hover:text-red-500 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="flex gap-2">
                <input
                  type="text" value={newCategory}
                  onChange={(e) => handleNewCategoryChange(e.target.value)}
                  placeholder="Add new category..."
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                  maxLength={MAX_CATEGORY_NAME_LENGTH}
                  className="input-field flex-1 text-sm"
                />
                <button onClick={handleAddCategory} disabled={!canAddCategory} className="px-4 py-2 bg-blue-600 disabled:bg-slate-200 text-white rounded-xl hover:bg-blue-700 transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2">
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => goToStep('dates')} className="btn-secondary flex-1">← Back</motion.button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { void handleSave(); }} disabled={saving || peopleNum < MIN_PEOPLE || peopleNum > MAX_PEOPLE || budgetNum <= 0 || budgetNum > MAX_BUDGET_PER_PERSON || endDate < startDate} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {saving ? 'Saving…' : (<>{initialData ? 'Update' : 'Start Trip'} <ArrowRight className="w-4 h-4" /></>)}
                </motion.button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        <AnimatePresence>
          {memberContactPickerOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/45 z-50"
                onClick={closeMemberContactPicker}
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 24, stiffness: 260 }}
                className="fixed bottom-0 left-0 right-0 z-[60] bg-white rounded-t-3xl shadow-2xl max-w-md mx-auto"
                style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
              >
                <div className="px-5 pt-4 pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">Pick Contacts</p>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5">Select multiple members at once</p>
                    </div>
                    <button
                      type="button"
                      onClick={closeMemberContactPicker}
                      className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={memberContactSearch}
                    onChange={(e) => setMemberContactSearch(e.target.value)}
                    placeholder="Search contacts"
                    className="mt-3 w-full input-field text-sm"
                  />
                  {memberContactPickerError && (
                    <p className="mt-2 text-xs text-rose-600 font-medium">{memberContactPickerError}</p>
                  )}
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
                  {memberContactPickerLoading && (
                    <div className="px-4 py-10 text-center text-sm text-slate-500">
                      Loading contacts...
                    </div>
                  )}
                  {filteredContacts.map((contact) => (
                    <button
                      key={contact.contactId}
                      type="button"
                      onClick={() => toggleMemberContactSelection(contact.contactId)}
                      disabled={!selectedMemberContactIds.includes(contact.contactId) && selectedMemberContactIds.length >= maxContactSelections}
                      className={`w-full text-left px-4 py-3 rounded-2xl border transition-colors flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed ${selectedMemberContactIds.includes(contact.contactId) ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                    >
                      <div className="flex-shrink-0 text-blue-600">
                        {selectedMemberContactIds.includes(contact.contactId) ? <Check className="w-4 h-4" /> : <X className="w-4 h-4 opacity-0" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900 text-sm truncate">{contact.name || 'Unnamed contact'}</p>
                        <p className="text-xs text-slate-500 mt-1 truncate">{contact.phoneNumber || 'No phone number'}</p>
                      </div>
                    </button>
                  ))}
                  {!memberContactPickerLoading && filteredContacts.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">
                      No matching contacts.
                    </div>
                  )}
                  {!memberContactPickerLoading && !memberContactPickerError && memberContactChoices.length > 0 && filteredContacts.length === 0 && (
                    <div className="px-4 py-2 text-center text-xs text-slate-400">
                      Try a different search.
                    </div>
                  )}
                </div>
                <div className="px-5 pt-3 border-t border-slate-100 flex items-center gap-3">
                  <div className="flex-1 text-xs text-slate-500">
                    {selectedMemberContacts.length} selected (max {maxContactSelections})
                  </div>
                  <button
                    type="button"
                    onClick={closeMemberContactPicker}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applySelectedMemberContacts}
                    disabled={selectedMemberContacts.length === 0}
                    className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    OK
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
