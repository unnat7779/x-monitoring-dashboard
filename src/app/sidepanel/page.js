'use client';

import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { getAccountMeta } from '@/lib/accounts';

const fetcher = (url) => fetch(url).then((res) => res.json());

export default function SidePanel() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [maxCount, setMaxCount] = useState(3);
  const [showUpdateToast, setShowUpdateToast] = useState(false);
  const [newIds, setNewIds] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const knownIdsRef = useRef(new Set());

  const { data, error, mutate, isValidating } = useSWR('/api/tweets', fetcher, {
    refreshInterval: 1500, // 1.5s instant polling
    revalidateOnFocus: true,
    dedupingInterval: 500,
  });

  const rawTweets = data?.tweets || [];

  // Detect new updates for pulse indicator and card animation
  useEffect(() => {
    if (rawTweets.length > 0) {
      const incomingIds = rawTweets.map((t) => t.id);
      if (knownIdsRef.current.size > 0) {
        const fresh = incomingIds.filter((id) => !knownIdsRef.current.has(id));
        if (fresh.length > 0) {
          setShowUpdateToast(true);
          setNewIds(new Set(fresh));
          const timer = setTimeout(() => {
            setShowUpdateToast(false);
            setNewIds(new Set());
          }, 3500);
          rawTweets.forEach((t) => knownIdsRef.current.add(t.id));
          return () => clearTimeout(timer);
        }
      } else {
        // Initial load: populate knownIds without triggering update animation
        rawTweets.forEach((t) => knownIdsRef.current.add(t.id));
      }
    }
  }, [rawTweets]);

  // Filter tweets
  const filteredTweets = rawTweets.filter((t) => {
    const meta = getAccountMeta(t.author?.username || t.author?.name);
    if (activeCategory === 'Wires') return meta.category === 'News Wire';
    if (activeCategory === 'Finance') return meta.category === 'Financial Media';
    if (activeCategory === 'Analysts') return meta.category === 'Journalists & Analysts';
    return true;
  });

  const displayTweets = filteredTweets.slice(0, maxCount);

  return (
    <div className="h-screen w-full bg-[#0a0a0c] text-white flex flex-col font-sans select-none antialiased overflow-hidden">
      {/* ── Fixed Header ── */}
      <header className="flex-none bg-[#0a0a0c]/95 backdrop-blur-md border-b border-white/[0.08] px-3.5 py-2.5 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-white flex items-center justify-center text-black font-black text-[11px]">
            𝕏
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[13px] tracking-tight">X Monitor</span>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Tweet Count Selector (3 vs 5) */}
          <div className="flex items-center bg-white/[0.06] rounded-full p-0.5 border border-white/[0.08] text-[11px] font-medium">
            <button
              onClick={() => setMaxCount(3)}
              className={`px-2.5 py-0.5 rounded-full transition-all cursor-pointer ${
                maxCount === 3 ? 'bg-white text-black font-bold shadow-xs' : 'text-[#71767b] hover:text-white'
              }`}
            >
              3
            </button>
            <button
              onClick={() => setMaxCount(5)}
              className={`px-2.5 py-0.5 rounded-full transition-all cursor-pointer ${
                maxCount === 5 ? 'bg-white text-black font-bold shadow-xs' : 'text-[#71767b] hover:text-white'
              }`}
            >
              5
            </button>
          </div>
        </div>
      </header>

      {/* ── Real-time Update Alert (Fixed) ── */}
      {showUpdateToast && (
        <div className="flex-none bg-emerald-500/15 border-b border-emerald-500/30 px-3 py-1.5 flex items-center justify-between text-[11px] text-emerald-400 font-medium animate-slide-down">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            New breaking post received
          </span>
          <button onClick={() => setShowUpdateToast(false)} className="text-emerald-400/60 hover:text-emerald-400 cursor-pointer">✕</button>
        </div>
      )}

      {/* ── Scrollable Post Feed (Independent scroll container) ── */}
      <main className="flex-1 min-h-0 px-2.5 py-2.5 overflow-y-auto overflow-x-hidden flex flex-col gap-2.5">
        {!data && !error && (
          <div className="flex flex-col gap-2.5 pt-1">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex-none bg-[#111114] border border-white/[0.06] rounded-xl p-3.5 space-y-2.5 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="h-3 w-28 bg-white/[0.08] rounded" />
                  <div className="h-2 w-16 bg-white/[0.04] rounded" />
                </div>
                <div className="space-y-1.5 pt-1">
                  <div className="h-2.5 w-full bg-white/[0.06] rounded" />
                  <div className="h-2.5 w-4/5 bg-white/[0.06] rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {displayTweets.length === 0 && data && (
          <div className="py-12 text-center text-[#71767b] space-y-2">
            <div className="w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto text-sm">
              𝕏
            </div>
            <p className="text-xs">No posts available</p>
          </div>
        )}

        {displayTweets.map((tweet, idx) => (
          <SidePanelTweetCard
            key={tweet.id || idx}
            tweet={tweet}
            index={idx}
            isNew={newIds.has(tweet.id)}
            isExpanded={expandedId === tweet.id}
            onToggleExpand={() => setExpandedId(expandedId === tweet.id ? null : tweet.id)}
          />
        ))}
      </main>

      {/* ── Fixed Footer ── */}
      <footer className="flex-none bg-[#0a0a0c]/95 backdrop-blur-md border-t border-white/[0.08] px-3.5 py-2.5 flex items-center justify-between text-[11px] text-[#71767b] z-10">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
          <span>{rawTweets.length} posts indexed</span>
        </div>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[var(--accent-primary)] hover:underline font-semibold"
        >
          <span>Open Full Terminal</span>
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </footer>
    </div>
  );
}

function SidePanelTweetCard({ tweet, index, isNew = false, isExpanded = false, onToggleExpand }) {
  const { author, text, created_at, media, id } = tweet;
  const [copied, setCopied] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  
  const contentRef = useRef(null);
  const cardRef = useRef(null);

  const rawUsername = author?.username || '';
  const rawName = author?.name || 'Unknown';
  const meta = getAccountMeta(rawUsername || rawName);

  // 3 lines threshold (~20px per line = 62px)
  const COLLAPSED_HEIGHT_LIMIT = 62;

  // Real DOM measurement via ResizeObserver
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const measure = () => {
      const naturalHeight = el.scrollHeight;
      setHasOverflow(naturalHeight > COLLAPSED_HEIGHT_LIMIT);
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(el);

    if (document.fonts) {
      document.fonts.ready.then(measure);
    }

    return () => observer.disconnect();
  }, [text]);

  // When expanding, ensure the card and its controls are comfortably visible without abrupt jumps
  useEffect(() => {
    if (isExpanded && cardRef.current) {
      const timer = setTimeout(() => {
        cardRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isExpanded]);

  const formattedTime = (() => {
    try {
      const d = new Date(created_at);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const diff = Math.floor((Date.now() - d.getTime()) / 1000);
      let rel = 'now';
      if (diff < 60) rel = `${diff}s`;
      else if (diff < 3600) rel = `${Math.floor(diff / 60)}m`;
      else if (diff < 86400) rel = `${Math.floor(diff / 3600)}h`;
      else rel = `${Math.floor(diff / 86400)}d`;
      return `${rel} · ${timeStr}`;
    } catch {
      return 'now';
    }
  })();

  const cleanId = String(id || '').split('?')[0];
  const tweetUrl = `https://x.com/${meta.handle || rawUsername}/status/${cleanId}`;

  const handleCopy = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  let accentColor = '#38bdf8';
  if (meta.category === 'Financial Media') accentColor = '#10b981';
  else if (meta.category === 'News Wire') accentColor = '#06b6d4';
  else if (meta.category === 'Journalists & Analysts') accentColor = '#c084fc';
  if (meta.handle === 'ANI' || meta.handle === 'PTI_News') accentColor = '#ef4444';

  return (
    <article
      ref={cardRef}
      className={`flex-none w-full bg-[#111114] hover:bg-[#16161a] border ${
        isNew ? 'border-[var(--accent-primary)]/50 animate-slide-down' : 'border-white/[0.06]'
      } hover:border-white/[0.12] rounded-xl p-3 relative transition-colors duration-150 flex flex-col gap-2`}
      style={{ animationDelay: isNew ? '0s' : undefined, height: 'auto' }}
    >
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[2.5px] rounded-l-xl" style={{ backgroundColor: accentColor }} />

      {/* Header — clean without logo box and without tag pill */}
      <div className="flex items-center justify-between gap-2 pl-1.5">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[13px] text-white truncate">{meta.name}</span>
            {meta.verified && (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-[var(--accent-primary)] flex-shrink-0" fill="currentColor">
                <path d="m8.6 22.5-1.9-3.2-3.6-.8.4-3.7L1 12l2.5-2.8-.4-3.7 3.6-.8 1.9-3.2L12 2.9l3.4-1.4 1.9 3.2 3.6.8-.4 3.7L23 12l-2.5 2.8.4 3.7-3.6.8-1.9 3.2-3.4-1.4-3.4 1.4zm2.85-6.55 6.35-6.35-1.4-1.45-4.95 4.95-2.15-2.15-1.4 1.4 3.55 3.6z" />
              </svg>
            )}
            <span className="text-[11px] text-[#71767b] truncate">@{meta.handle}</span>
          </div>
        </div>
        <span className="text-[11px] text-[#71767b] font-mono tracking-tight flex-shrink-0">{formattedTime}</span>
      </div>

      {/* Tweet Body — fully natural height when expanded or non-overflowing */}
      <div className="pl-1.5 flex flex-col">
        <div
          id={`post-content-${id}`}
          style={{
            maxHeight: !hasOverflow || isExpanded ? 'none' : `${COLLAPSED_HEIGHT_LIMIT}px`,
            overflow: !hasOverflow || isExpanded ? 'visible' : 'hidden',
          }}
        >
          <p ref={contentRef} className="text-[13px] text-white/90 leading-[1.55] break-words">
            {renderHighlightedContent(text)}
          </p>
        </div>

        {/* Read More / Show Less Button — OUTSIDE the clipped text container */}
        {hasOverflow && (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={`post-content-${id}`}
            onClick={onToggleExpand}
            className="text-[11.5px] text-[var(--accent-primary)] font-semibold self-start flex items-center gap-1 hover:underline focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)] focus:outline-none rounded transition-all cursor-pointer mt-1.5"
          >
            <span>{isExpanded ? 'Show less' : 'Read more'}</span>
            <svg
              viewBox="0 0 24 24"
              className="w-3 h-3 transition-transform duration-250 ease-out"
              style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Media Preview (if exists) */}
      {media && media.length > 0 && (
        <div className="rounded-lg overflow-hidden border border-white/[0.08] max-h-48 ml-1.5 mt-0.5">
          <img src={media[0].preview_url || media[0].url} alt="Media" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Action Footer — Always visible at bottom of the natural height card */}
      <div className="flex items-center justify-between pt-1.5 border-t border-white/[0.06] pl-1.5 text-[11.5px] text-[#71767b] mt-0.5">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
          title="Copy tweet text"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>

        <a
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[var(--accent-primary)] hover:underline font-semibold"
        >
          <span>See on 𝕏</span>
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </article>
  );
}

function renderHighlightedContent(text) {
  if (!text) return null;
  const parts = text.split(/(@\w+|#\w+|https?:\/\/\S+)/g);
  return parts.map((part, i) => {
    if (/^#(WATCH|BREAKING|Breaking)/i.test(part)) {
      return <span key={i} className="text-pink-400 font-bold">{part}</span>;
    }
    if (part.startsWith('#') || part.startsWith('@')) {
      return <span key={i} className="text-[var(--accent-primary)]">{part}</span>;
    }
    if (part.startsWith('http')) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-primary)] hover:underline">
          {part.length > 30 ? part.slice(0, 30) + '…' : part}
        </a>
      );
    }
    return part;
  });
}
