'use client';

export type InteractionTab = 'new' | 'liked' | 'disliked' | 'reviewed' | 'all';

interface InteractionTabsProps {
  activeTab: InteractionTab;
  onTabChange: (tab: InteractionTab) => void;
  counts: { new: number; liked: number; disliked: number; reviewed: number; all: number };
}

const tabs: { key: InteractionTab; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'liked', label: 'Liked' },
  { key: 'disliked', label: 'Disliked' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'all', label: 'All' },
];

export default function InteractionTabs({ activeTab, onTabChange, counts }: InteractionTabsProps) {
  return (
    <div className="p-1 bg-gray-50/80 rounded-xl border border-gray-100 inline-flex gap-1 overflow-x-auto whitespace-nowrap">
      {tabs.map(({ key, label }) => {
        const isActive = activeTab === key;
        const count = counts[key];

        return (
          <button
            key={key}
            onClick={() => onTabChange(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center ${
              isActive
                ? 'bg-white text-themis-700 shadow-sm'
                : 'text-gray-500 hover:text-themis-600 hover:bg-white/50'
            }`}
          >
            {label}
            <span
              className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] inline-flex justify-center ${
                isActive
                  ? 'bg-themis-100 text-themis-600'
                  : 'bg-gray-200/60 text-gray-400'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
