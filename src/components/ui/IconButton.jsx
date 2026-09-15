'use client';

/**
 * Compact icon button for tweet actions (reply, retweet, like, etc).
 */
export default function IconButton({ 
  icon, 
  label, 
  onClick, 
  hoverColor = 'blue',
  active = false 
}) {
  const hoverClasses = {
    blue: 'hover:bg-blue-500/10 hover:text-blue-500',
    green: 'hover:bg-emerald-500/10 hover:text-emerald-500',
    red: 'hover:bg-pink-500/10 hover:text-pink-500',
    neutral: 'hover:bg-white/10 hover:text-white',
  };

  const activeClasses = {
    blue: 'text-blue-500',
    green: 'text-emerald-500',
    red: 'text-pink-500',
    neutral: 'text-white',
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick(e);
      }}
      className={`group flex items-center gap-1.5 transition-colors ${
        active ? activeClasses[hoverColor] : 'text-[var(--text-muted)]'
      }`}
    >
      <div className={`p-1.5 rounded-full transition-colors ${!active && hoverClasses[hoverColor]}`}>
        {icon}
      </div>
      {label !== undefined && (
        <span className={`text-xs font-mono transition-colors ${
          !active && `group-hover:text-${hoverColor === 'neutral' ? 'white' : hoverColor + '-500'}`
        }`}>
          {label > 0 ? label : ''}
        </span>
      )}
    </button>
  );
}
