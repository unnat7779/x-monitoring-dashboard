'use client';

import SegmentedControl from '@/components/ui/SegmentedControl';

export default function Header({
  viewMode,
  onViewModeChange,
}) {
  const viewOptions = [
    {
      value: 'unified',
      label: 'Unified',
      icon: (
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      )
    },
    {
      value: 'deck',
      label: 'Deck',
      icon: (
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="5" height="18" rx="1" />
          <rect x="10" y="3" width="5" height="18" rx="1" />
          <rect x="17" y="3" width="5" height="18" rx="1" />
        </svg>
      )
    }
  ];

  return (
    <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-app)]/80 backdrop-blur-xl sticky top-0 z-30">
      {/* Main Navigation Header */}
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-2.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Left: Branding */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[var(--text-primary)] flex items-center justify-center shadow-sm">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-black" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </div>

            <div>
              <h1 className="text-[16px] font-bold tracking-tight text-white leading-none">
                X Monitor
              </h1>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                Market Intelligence Feed
              </p>
            </div>
          </div>
        </div>

        {/* Right: Controls, Side Panel Launcher & View Switcher */}
        <div className="flex items-center gap-2.5 w-full md:w-auto justify-between md:justify-end flex-wrap">
          {/* Side Panel Launcher Button */}
          <button
            onClick={() => {
              window.open(
                '/sidepanel',
                'XMonitorSidePanel',
                'width=380,height=750,menubar=no,toolbar=no,location=no,status=no'
              );
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.2] text-[12px] font-medium text-white transition-all shadow-xs"
            title="Open side panel companion window"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-[var(--accent-primary)]" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
            <span>Side Panel</span>
          </button>

          <SegmentedControl 
            options={viewOptions}
            value={viewMode}
            onChange={onViewModeChange}
          />
        </div>
      </div>
    </header>
  );
}
