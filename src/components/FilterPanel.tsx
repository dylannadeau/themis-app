'use client';

import { useState } from 'react';
import { Filter, ChevronDown, ChevronUp } from 'lucide-react';

export interface FilterState {
  natureOfSuit: string[];
  sourceSearch: string;
  dateRange: { from: string; to: string };
  favoritesOnly: boolean;
}

interface FilterPanelProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  availableNatures: string[];
}

export const defaultFilters: FilterState = {
  natureOfSuit: [],
  sourceSearch: '',
  dateRange: { from: '', to: '' },
  favoritesOnly: false,
};

function FilterSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-3 text-sm font-semibold text-themis-800"
      >
        {title}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && <div className="pb-3 space-y-2">{children}</div>}
    </div>
  );
}

function CheckboxItem({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded border-gray-300 text-themis-600 focus:ring-themis-500/30 transition"
      />
      <span className="text-sm text-gray-600 group-hover:text-themis-700 transition-colors truncate">
        {label}
      </span>
    </label>
  );
}

export default function FilterPanel({
  filters,
  onChange,
  availableNatures,
}: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeCount =
    filters.natureOfSuit.length +
    (filters.sourceSearch ? 1 : 0) +
    (filters.dateRange.from || filters.dateRange.to ? 1 : 0) +
    (filters.favoritesOnly ? 1 : 0);

  const clearAll = () => onChange(defaultFilters);

  const toggleArrayFilter = (
    key: 'natureOfSuit',
    value: string,
    checked: boolean
  ) => {
    const current = filters[key];
    const updated = checked
      ? [...current, value]
      : current.filter((v) => v !== value);
    onChange({ ...filters, [key]: updated });
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden btn-secondary gap-2 mb-4"
      >
        <Filter className="w-4 h-4" />
        Filters
        {activeCount > 0 && (
          <span className="bg-themis-600 text-white text-xs px-1.5 py-0.5 rounded-full">
            {activeCount}
          </span>
        )}
      </button>

      {/* Filter panel */}
      <div
        className={`lg:block ${isOpen ? 'block' : 'hidden'} w-full lg:w-64 flex-shrink-0`}
      >
        <div className="card p-4 sticky top-24">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-themis-900 flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filters
            </h3>
            {activeCount > 0 && (
              <button onClick={clearAll} className="text-xs text-themis-500 hover:text-themis-700">
                Clear all
              </button>
            )}
          </div>

          {/* Favorites */}
          <FilterSection title="Saved">
            <CheckboxItem
              label="Favorites only"
              checked={filters.favoritesOnly}
              onChange={(checked) => onChange({ ...filters, favoritesOnly: checked })}
            />
          </FilterSection>

          {/* Nature of Suit */}
          {availableNatures.length > 0 && (
            <FilterSection title="Nature of Suit" defaultOpen={false}>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {availableNatures.slice(0, 20).map((n) => (
                  <CheckboxItem
                    key={n}
                    label={n}
                    checked={filters.natureOfSuit.includes(n)}
                    onChange={(checked) => toggleArrayFilter('natureOfSuit', n, checked)}
                  />
                ))}
              </div>
            </FilterSection>
          )}

          {/* Source */}
          <FilterSection title="Source" defaultOpen={false}>
            <input
              type="text"
              value={filters.sourceSearch}
              onChange={(e) => onChange({ ...filters, sourceSearch: e.target.value })}
              placeholder="Search sources..."
              className="input-field text-xs py-1.5"
            />
          </FilterSection>

          {/* Date Range */}
          <FilterSection title="Filed Date" defaultOpen={false}>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500">From</label>
                <input
                  type="date"
                  value={filters.dateRange.from}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      dateRange: { ...filters.dateRange, from: e.target.value },
                    })
                  }
                  className="input-field text-xs py-1.5"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">To</label>
                <input
                  type="date"
                  value={filters.dateRange.to}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      dateRange: { ...filters.dateRange, to: e.target.value },
                    })
                  }
                  className="input-field text-xs py-1.5"
                />
              </div>
            </div>
          </FilterSection>
        </div>
      </div>
    </>
  );
}
