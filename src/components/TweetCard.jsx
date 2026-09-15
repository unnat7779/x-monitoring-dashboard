'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { getAccountMeta } from '@/lib/accounts';
import Badge from '@/components/ui/Badge';
import IconButton from '@/components/ui/IconButton';

export default function TweetCard({ tweet, index = 0, compact = false }) {
  const { author, text, created_at, media, metrics, id } = tweet;
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const rawUsername = author?.username || '';
  const rawName = author?.name || 'Unknown';
  const meta = getAccountMeta(rawUsername || rawName);

  const isLong = (text || '').length > (compact ? 140 : 220);
  const displayText = isLong && !isExpanded ? text.slice(0, compact ? 140 : 220) + '...' : text;

  const timeAgo = (() => {
    try {
      return formatDistanceToNow(new Date(created_at), { addSuffix: true });
    } catch {
      return 'just now';
    }
  })();

  const fullDate = (() => {
    try {
      return new Date(created_at).toLocaleString();
    } catch {
      return '';
    }
  })();

  const cleanId = String(id || '').split('?')[0];
  const tweetUrl = `https://x.com/${meta.handle || rawUsername}/status/${cleanId}`;

  const handleCopyText = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Determine accent color and badge variant based on category
  let badgeVariant = 'neutral';
  let accentColor = 'transparent';
  if (meta.category === 'Financial Media') {
    badgeVariant = 'green';
    accentColor = 'var(--cat-finance)';
  } else if (meta.category === 'News Wire') {
    badgeVariant = 'blue';
    accentColor = 'var(--cat-news)';
  } else if (meta.category === 'Journalists & Analysts') {
    badgeVariant = 'purple';
    accentColor = 'var(--cat-analyst)';
  }

  // Override if high priority
  if (meta.handle === 'ANI' || meta.handle === 'PTI_News') {
    badgeVariant = 'priority';
    accentColor = '#ef4444'; // Red for priority wires
  }

  return (
    <article
      className={`tweet-card p-4 sm:p-5 ${tweet.isNew ? 'animate-slide-down border-[var(--accent-primary)]/40 shadow-md' : ''} flex flex-col gap-3 group relative overflow-hidden`}
      style={{
        animationDelay: tweet.isNew ? '0s' : undefined,
      }}
    >
      {/* Category Accent Border */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: accentColor }}
      />

      {/* Author Header */}
      <div className="flex items-start justify-between gap-3 relative z-10 pl-2 sm:pl-1">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Avatar / Branded Initial Icon */}
          <div
            className="w-10 h-10 rounded bg-[var(--bg-surface-raised)] flex-shrink-0 flex items-center justify-center text-[var(--text-primary)] font-bold text-sm shadow-sm border border-[var(--border-subtle)]"
          >
            {meta.name.slice(0, 2).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap leading-tight">
              <span className="font-bold text-[15px] text-[var(--text-primary)] truncate hover:underline cursor-pointer">
                {meta.name}
              </span>

              {meta.verified && (
                <svg viewBox="0 0 24 24" className="w-[16px] h-[16px] text-[var(--accent-primary)] flex-shrink-0" fill="currentColor">
                  <path d="m8.6 22.5-1.9-3.2-3.6-.8.4-3.7L1 12l2.5-2.8-.4-3.7 3.6-.8 1.9-3.2L12 2.9l3.4-1.4 1.9 3.2 3.6.8-.4 3.7L23 12l-2.5 2.8.4 3.7-3.6.8-1.9 3.2-3.4-1.4-3.4 1.4zm2.85-6.55 6.35-6.35-1.4-1.45-4.95 4.95-2.15-2.15-1.4 1.4 3.55 3.6z" />
                </svg>
              )}

              <span className="text-[14px] text-[var(--text-secondary)]">
                @{meta.handle || rawUsername}
              </span>
            </div>

            <div className="mt-1">
              <Badge variant={badgeVariant}>{meta.tag}</Badge>
            </div>
          </div>
        </div>

        {/* Right side: Timestamp & Action */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[13px] text-[var(--text-secondary)] hover:underline cursor-pointer" title={fullDate}>
            {timeAgo}
          </span>
          <a
            href={tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors p-1 flex items-center gap-1 text-xs"
            title="See on X.com"
          >
            <span className="text-[11px] text-[var(--accent-primary)] hidden sm:inline hover:underline">See on 𝕏</span>
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--accent-primary)]" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>
      </div>

      {/* Tweet Body Text */}
      <div className="sm:pl-[52px] pl-2 flex flex-col">
        <div
          style={{
            maxHeight: isLong && !isExpanded ? (compact ? '60px' : '96px') : '1000px',
            overflow: 'hidden',
            transition: 'max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <p className="text-[14px] sm:text-[15px] text-white/85 leading-relaxed font-normal break-words">
            {renderHighlightedText(text)}
          </p>
        </div>

        {/* Read More / Show Less Toggle */}
        {isLong && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-1 text-[12px] text-[var(--accent-primary)] font-semibold flex items-center gap-1 opacity-90 hover:opacity-100 hover:underline transition-all self-start cursor-pointer"
          >
            <span>{isExpanded ? 'Show less' : 'Read more'}</span>
            <svg
              viewBox="0 0 24 24"
              className="w-3 h-3 transition-transform duration-250 ease-out"
              style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
              fill="none" stroke="currentColor" strokeWidth="2.5"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Media Attachments */}
      {media && media.length > 0 && (
        <div className="mt-2 rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] sm:ml-[52px] ml-2">
          {media.map((m, i) => (
            <div key={i} className="relative">
              {m.type === 'video' || m.type === 'animated_gif' ? (
                <video
                  src={m.video_url || m.url}
                  poster={m.preview_url}
                  controls
                  className="w-full max-h-[400px] object-cover"
                />
              ) : (
                <img
                  src={m.preview_url || m.url}
                  alt="Tweet media"
                  className="w-full max-h-[400px] object-cover"
                  loading="lazy"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bottom Bar: Metrics & Utilities */}
      <div className="mt-1 flex items-center justify-between gap-4 sm:gap-6 text-[#71767b] sm:pl-[52px] pl-2 flex-wrap">
        <div className="flex items-center gap-4 sm:gap-6">
          {/* Replies */}
          <IconButton 
            icon={
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            }
            label={metrics?.replies || 0}
            hoverColor="blue"
          />

          {/* Retweets */}
          <IconButton 
            icon={
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="m17 2 4 4-4 4" />
                <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                <path d="m7 22-4-4 4-4" />
                <path d="M21 13v1a4 4 0 0 1-4 4H3" />
              </svg>
            }
            label={metrics?.retweets || 0}
            hoverColor="green"
          />

          {/* Likes */}
          <IconButton 
            icon={
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
            }
            label={metrics?.likes || 0}
            hoverColor="red"
          />

          {/* Copy text button */}
          <IconButton 
            icon={
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            }
            label={copied ? 'Copied' : undefined}
            hoverColor="neutral"
            active={copied}
            onClick={handleCopyText}
          />
        </div>

        {/* See on X Link Button */}
        <a
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] text-[var(--accent-primary)] hover:underline font-semibold flex items-center gap-1"
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

function renderHighlightedText(text) {
  if (!text) return null;

  const parts = text.split(/(@\w+|#\w+|https?:\/\/\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('#WATCH') || part.startsWith('#BREAKING') || part.startsWith('#Breaking')) {
      return (
        <span
          key={i}
          className="text-pink-500 font-bold"
        >
          {part}
        </span>
      );
    }
    if (part.startsWith('#') || part.startsWith('@')) {
      return (
        <span key={i} className="text-[var(--accent-primary)] hover:underline cursor-pointer">
          {part}
        </span>
      );
    }
    if (part.startsWith('http')) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-primary)] hover:underline inline-flex items-center gap-0.5"
        >
          {part.length > 30 ? part.slice(0, 30) + '…' : part}
        </a>
      );
    }
    return part;
  });
}
