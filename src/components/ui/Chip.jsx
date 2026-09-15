'use client';

/**
 * Filter Chip for channels, using monochrome initial/icon instead of color dots.
 */
export default function Chip({ 
  label, 
  active = false, 
  onClick, 
  count = 0,
  initial = '' 
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-full text-[13px] whitespace-nowrap transition-all border ${
        active
          ? 'bg-[var(--bg-surface-raised)] text-white border-[var(--border-medium)] shadow-sm font-medium'
          : 'bg-transparent text-[var(--text-secondary)] border-transparent hover:border-[var(--border-subtle)] hover:bg-white/[0.02] hover:text-[var(--text-primary)]'
      }`}
    >
      {/* Neutral Avatar / Initial */}
      <div className={`min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-bold transition-colors ${
        active 
          ? 'bg-white text-black' 
          : 'bg-[var(--border-medium)] text-[var(--text-primary)] group-hover:bg-white/[0.2]'
      }`}>
        {initial || label.charAt(0).toUpperCase()}
      </div>

      <span className="truncate max-w-[140px]">{label}</span>
      
      {count > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono transition-colors ${
          active 
            ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' 
            : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}
