import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Edit3, Check } from 'lucide-react';
import { TripSetup } from '../utils/calculations.ts';
import { motion, AnimatePresence } from 'motion/react';

interface CategoryManagerProps {
  setup: TripSetup | null;
  onUpdate: (setup: TripSetup) => void;
}

export const CategoryManager: React.FC<CategoryManagerProps> = ({ setup, onUpdate }) => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<string[]>(
    setup?.customCategories || ['Food', 'Travel', 'Stay', 'Misc']
  );
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newCategory, setNewCategory] = useState('');

  if (!setup) {
    return (
      <div className="page-shell">
        <div className="text-slate-600">No trip setup found</div>
      </div>
    );
  }

  useEffect(() => {
    const next = setup.customCategories || ['Food', 'Travel', 'Stay', 'Misc'];
    setCategories(next);
  }, [setup.customCategories]);

  const trimmedNewCategory = useMemo(() => newCategory.trim(), [newCategory]);
  const trimmedEditValue = useMemo(() => editValue.trim(), [editValue]);
  const categoriesSet = useMemo(() => new Set(categories), [categories]);

  const canAddCategory = useMemo(
    () => Boolean(trimmedNewCategory) && !categoriesSet.has(trimmedNewCategory),
    [trimmedNewCategory, categoriesSet]
  );

  const goBack = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleAddCategory = useCallback(() => {
    if (canAddCategory) {
      setCategories([...categories, trimmedNewCategory]);
      setNewCategory('');
    }
  }, [canAddCategory, categories, trimmedNewCategory]);

  const handleEditCategory = useCallback((idx: number) => {
    setEditingIdx(idx);
    setEditValue(categories[idx]);
  }, [categories]);

  const handleSaveEdit = useCallback((idx: number) => {
    const isDuplicateElsewhere = categories.some((category, categoryIdx) => categoryIdx !== idx && category === trimmedEditValue);
    if (trimmedEditValue && !isDuplicateElsewhere) {
      const updated = [...categories];
      updated[idx] = trimmedEditValue;
      setCategories(updated);
      setEditingIdx(null);
    }
  }, [categories, trimmedEditValue]);

  const handleDeleteCategory = useCallback((idx: number) => {
    if (categories.length > 1) {
      setCategories(categories.filter((_, i) => i !== idx));
      if (editingIdx === idx) {
        setEditingIdx(null);
      }
    }
  }, [categories, editingIdx]);

  const handleSave = useCallback(() => {
    onUpdate({
      ...setup,
      customCategories: categories.filter(c => c.trim()),
    });
    navigate('/settings');
  }, [categories, navigate, onUpdate, setup]);

  const handleEditValueChange = useCallback((value: string) => {
    setEditValue(value);
  }, []);

  const handleNewCategoryChange = useCallback((value: string) => {
    setNewCategory(value);
  }, []);

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-center justify-between page-header">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <h1 className="page-title text-2xl">Categories</h1>
        <div className="w-8" />
      </div>

      <div className="space-y-3">
        <AnimatePresence>
          {categories.map((category, idx) => (
            <motion.div
              key={`${idx}-${category}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-3"
            >
              {editingIdx === idx ? (
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => handleEditValueChange(e.target.value)}
                    className="flex-1 input-field text-sm"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveEdit(idx)}
                    className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-sm font-semibold text-slate-700 flex-1">{category}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEditCategory(idx)}
                      className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {categories.length > 1 && (
                      <button
                        onClick={() => handleDeleteCategory(idx)}
                        className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newCategory}
          onChange={(e) => handleNewCategoryChange(e.target.value)}
          placeholder="Add new category..."
          onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
          className="input-field flex-1 text-sm"
        />
        <button
          onClick={handleAddCategory}
          disabled={!canAddCategory}
          className="px-4 py-2 bg-blue-600 disabled:bg-slate-200 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleSave}
        className="btn-primary w-full"
      >
        Save Changes
      </motion.button>
    </div>
  );
};
