'use client';

/**
 * A sliding segmented control for toggling views.
 */
export default function SegmentedControl({ 
  options = [], 
  value, 
  onChange 
}) {
  return (
    <div className="flex items-center bg-[var(--bg-surface-raised)] p-1 rounded-full border border-[var(--border-subtle)] relative">
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`relative flex items-center justify-center gap-1.5 px-4 h-7 rounded-full text-[13px] font-medium transition-colors z-10 ${
              isActive
                ? 'text-white'
                : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            {option.icon && (
              <span className={`flex items-center ${isActive ? 'text-white' : 'text-[var(--text-muted)]'}`}>
                {option.icon}
              </span>
            )}
            {option.label}
          </button>
        );
      })}
      
      {/* Active pill background */}
      <div 
        className="absolute top-1 bottom-1 bg-[var(--border-medium)] rounded-full transition-all duration-300 ease-out z-0 border border-[var(--border-medium)] shadow-sm"
        style={{
          width: `calc(100% / ${options.length} - 8px)`,
          left: `calc((100% / ${options.length}) * ${options.findIndex(o => o.value === value)} + 4px)`
        }}
      />
    </div>
  );
}
