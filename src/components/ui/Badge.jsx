'use client';

/**
 * A small, muted pill for category tags or accents.
 * 
 * @param {string} children - The badge text
 * @param {string} className - Optional override classes
 * @param {string} variant - 'neutral', 'blue', 'green', 'purple', 'priority'
 */
export default function Badge({ children, className = '', variant = 'neutral' }) {
  const baseClasses = "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase border";
  
  const variants = {
    neutral: "bg-white/[0.04] text-[var(--text-muted)] border-[var(--border-subtle)]",
    blue: "bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20",
    green: "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/20",
    purple: "bg-[#8b5cf6]/10 text-[#8b5cf6] border-[#8b5cf6]/20",
    priority: "bg-red-500/10 text-red-500 border-red-500/20",
  };

  return (
    <span className={`${baseClasses} ${variants[variant] || variants.neutral} ${className}`}>
      {children}
    </span>
  );
}
