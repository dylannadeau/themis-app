'use client';

import { useState, useMemo, useEffect } from 'react';
import { X, Sparkles, AlertTriangle } from 'lucide-react';

export interface ScoringOptions {
  viability: ('high' | 'medium' | 'low')[];
  dateRange?: { from?: string; to?: string };
  keyword?: string;
  includeAlreadyScored: boolean;
}

export interface CaseStats {
  total: number;
  highViability: number;
  mediumViability: number;
  lowViability: number;
  alreadyScored: number;
  stale: number;
}

interface ScoreCasesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartScoring: (options: ScoringOptions) => void;
  caseStats: CaseStats;
}

type QuickOption = 'high' | 'high+medium' | 'all' | 'stale';

export default function ScoreCasesModal({
  isOpen,
  onClose,
  onStartScoring,
  caseStats,
}: ScoreCasesModalProps) {
  const [viability, setViability] = useState<('high' | 'medium' | 'low')[]>(['high', 'medium']);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [keyword, setKeyword] = useState('');
  const [includeAlreadyScored, setIncludeAlreadyScored] = useState(false);
  const [activeQuick, setActiveQuick] = useState<QuickOption | null>('high+medium');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setViability(['high', 'medium']);
      setDateFrom('');
      setDateTo('');
      setKeyword('');
      setIncludeAlreadyScored(false);
      setActiveQuick('high+medium');
    }
  }, [isOpen]);

  const handleQuickOption = (option: QuickOption) => {
    setActiveQuick(option);
    switch (option) {
      case 'high':
        setViability(['high']);
        setIncludeAlreadyScored(false);
        setDateFrom('');
        setDateTo('');
        setKeyword('');
        break;
      case 'high+medium':
        setViability(['high', 'medium']);
        setIncludeAlreadyScored(false);
        setDateFrom('');
        setDateTo('');
        setKeyword('');
        break;
      case 'all':
        setViability(['high', 'medium', 'low']);
        setIncludeAlreadyScored(false);
        setDateFrom('');
        setDateTo('');
        setKeyword('');
        break;
      case 'stale':
        setViability(['high', 'medium', 'low']);
        setIncludeAlreadyScored(true);
        setDateFrom('');
        setDateTo('');
        setKeyword('');
        break;
    }
  };

  const toggleViability = (v: 'high' | 'medium' | 'low') => {
    setActiveQuick(null);
    setViability((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  };

  const estimate = useMemo(() => {
    let count = 0;
    if (activeQuick === 'stale') {
      count = caseStats.stale;
    } else {
      if (viability.includes('high')) count += caseStats.highViability;
      if (viability.includes('medium')) count += caseStats.mediumViability;
      if (viability.includes('low')) count += caseStats.lowViability;
      if (!includeAlreadyScored) {
        // Rough estimate: subtract already-scored non-stale proportionally
        const ratio = caseStats.total > 0 ? count / caseStats.total : 0;
        count = Math.max(0, count - Math.round(caseStats.alreadyScored * ratio));
      }
    }
    // Keyword/date filters can only reduce, but we can't compute exactly client-side
    // without access to the full case data, so this is an upper bound
    const minutes = Math.max(0.1, (count / 10) * 2 / 60);
    return { count, minutes };
  }, [viability, includeAlreadyScored, activeQuick, caseStats]);

  const handleStart = () => {
    const options: ScoringOptions = {
      viability,
      includeAlreadyScored: activeQuick === 'stale' ? true : includeAlreadyScored,
    };
    if (dateFrom) options.dateRange = { ...options.dateRange, from: dateFrom };
    if (dateTo) options.dateRange = { ...options.dateRange, to: dateTo };
    if (keyword.trim()) options.keyword = keyword.trim();
    onStartScoring(options);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 p-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg text-themis-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-themis-500" />
            Score Cases
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Options */}
        <div className="mb-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
            Quick Options
          </p>
          <div className="flex flex-wrap gap-2">
            {([
              { key: 'high' as QuickOption, label: 'High Viability Only' },
              { key: 'high+medium' as QuickOption, label: 'High + Medium' },
              { key: 'all' as QuickOption, label: 'All Cases' },
              { key: 'stale' as QuickOption, label: 'Stale Only' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleQuickOption(key)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                  activeQuick === key
                    ? 'bg-themis-50 text-themis-700 border-themis-200'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-themis-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-4 mb-5">
          {/* Viability checkboxes */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Viability</p>
            <div className="flex gap-4">
              {([
                { value: 'high' as const, label: 'High', count: caseStats.highViability },
                { value: 'medium' as const, label: 'Medium', count: caseStats.mediumViability },
                { value: 'low' as const, label: 'Low', count: caseStats.lowViability },
              ]).map(({ value, label, count }) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={viability.includes(value)}
                    onChange={() => toggleViability(value)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-themis-600 focus:ring-themis-500/30"
                  />
                  <span className="text-sm text-gray-600">
                    {label} <span className="text-gray-400">({count})</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Date Range</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Filed after</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setActiveQuick(null); }}
                  className="input-field text-sm py-1.5 mt-0.5"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Filed before</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setActiveQuick(null); }}
                  className="input-field text-sm py-1.5 mt-0.5"
                />
              </div>
            </div>
          </div>

          {/* Keyword filter */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Keyword Filter</p>
            <input
              type="text"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setActiveQuick(null); }}
              placeholder="Only cases matching..."
              className="input-field text-sm py-2"
            />
            <p className="text-xs text-gray-400 mt-1">Filters on case name and summary</p>
          </div>

          {/* Include already scored */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={activeQuick === 'stale' ? true : includeAlreadyScored}
              onChange={(e) => {
                setIncludeAlreadyScored(e.target.checked);
                setActiveQuick(null);
              }}
              disabled={activeQuick === 'stale'}
              className="w-3.5 h-3.5 rounded border-gray-300 text-themis-600 focus:ring-themis-500/30"
            />
            <span className="text-sm text-gray-600">
              Include already-scored cases
              <span className="text-gray-400 ml-1">
                ({caseStats.alreadyScored} scored, {caseStats.stale} stale)
              </span>
            </span>
          </label>
        </div>

        {/* Estimate bar */}
        <div className="bg-gray-50 rounded-xl p-3 mb-5">
          <p className="text-sm text-gray-600">
            Will score ~<strong>{estimate.count}</strong> cases
            {' · '}Estimated ~<strong>{estimate.minutes < 1 ? '<1' : Math.ceil(estimate.minutes)}</strong> minute{estimate.minutes >= 2 ? 's' : ''}
            {' · '}Uses your Gemini API key
          </p>
          {estimate.count > 500 && (
            <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              This may take several minutes and use significant API credits.
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={viability.length === 0 && activeQuick !== 'stale'}
            className="bg-themis-700 text-white hover:bg-themis-800 rounded-xl px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Start Scoring
          </button>
        </div>
      </div>
    </div>
  );
}
