'use client';

import { useState } from 'react';
import { MONITORED_ACCOUNTS, CATEGORIES } from '@/lib/accounts';
import Chip from '@/components/ui/Chip';

export default function AccountFilter({
  activeAccount,
  onFilter,
  selectedCategory = 'All',
  onCategoryChange,
  counts = {},
}) {
  const [accountSearch, setAccountSearch] = useState('');

  // Filter accounts by category and search
  const visibleAccounts = MONITORED_ACCOUNTS.filter((acc) => {
    const matchesCat = selectedCategory === 'All' || acc.category === selectedCategory;
    const matchesSearch =
      !accountSearch.trim() ||
      acc.name.toLowerCase().includes(accountSearch.toLowerCase()) ||
      acc.handle.toLowerCase().includes(accountSearch.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-3">
      {/* Category Tabs & Quick Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Horizontal scroll with fade edge for tabs */}
        <div className="relative flex-1 max-w-full">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 hide-scrollbar mask-fade-right pr-12">
            {CATEGORIES.map((cat) => {
              const isCatActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => onCategoryChange(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all whitespace-nowrap ${
                    isCatActive
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-transparent text-[var(--text-secondary)] hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* Account Chips (Horizontal Scroll on Mobile, Wrap on Desktop) */}
      <div className="relative">
        <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap pb-2 pt-1 hide-scrollbar mask-fade-right sm:mask-none pr-8 sm:pr-0">
          {/* All button */}
          <Chip 
            label="All Channels" 
            active={activeAccount === 'all'} 
            onClick={() => onFilter('all')} 
            initial="ALL"
          />

          {/* Individual accounts */}
          {visibleAccounts.map((acc) => (
            <Chip 
              key={acc.handle}
              label={acc.name} 
              active={activeAccount.toLowerCase() === acc.handle.toLowerCase()} 
              onClick={() => onFilter(acc.handle)} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}
