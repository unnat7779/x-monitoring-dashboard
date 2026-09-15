'use client';

import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import Header from '@/components/Header';
import AccountFilter from '@/components/AccountFilter';
import TweetCard from '@/components/TweetCard';
import { MONITORED_ACCOUNTS, getAccountMeta } from '@/lib/accounts';
import IconButton from '@/components/ui/IconButton';

const fetcher = (url) => fetch(url).then((res) => res.json());

export default function Dashboard() {
  const [activeAccount, setActiveAccount] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('unified'); // 'unified' | 'deck'
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUpdateBadge, setShowUpdateBadge] = useState(false);
  const [newIds, setNewIds] = useState(new Set());
  const searchInputRef = useRef(null);
  const knownIdsRef = useRef(new Set());

  // Poll /api/tweets every 5s
  const { data, error, mutate, isValidating } = useSWR(
    `/api/tweets?account=${activeAccount}`,
    fetcher,
    {
      refreshInterval: 1500, // 1.5s instant polling
      revalidateOnFocus: true,
      dedupingInterval: 500,
    }
  );

  const rawTweets = data?.tweets || [];

  // Trigger indicator and card animation ONLY when brand new tweets actually arrive
  useEffect(() => {
    if (rawTweets.length > 0) {
      const incomingIds = rawTweets.map((t) => t.id);
      if (knownIdsRef.current.size > 0) {
        const fresh = incomingIds.filter((id) => !knownIdsRef.current.has(id));
        if (fresh.length > 0) {
          setShowUpdateBadge(true);
          setNewIds(new Set(fresh));
          const timer = setTimeout(() => {
            setShowUpdateBadge(false);
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
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleRefresh();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Compute counts dynamically per account
  const counts = { all: rawTweets.length };
  rawTweets.forEach((t) => {
    const meta = getAccountMeta(t.author?.username || t.author?.name);
    counts[meta.handle] = (counts[meta.handle] || 0) + 1;
  });

  // Filter tweets by category, account, and search query
  const filteredTweets = rawTweets.filter((t) => {
    const meta = getAccountMeta(t.author?.username || t.author?.name);

    if (selectedCategory !== 'All' && meta.category !== selectedCategory) {
      return false;
    }

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.text?.toLowerCase().includes(q) ||
      meta.name.toLowerCase().includes(q) ||
      meta.handle.toLowerCase().includes(q) ||
      t.author?.name?.toLowerCase().includes(q) ||
      t.author?.username?.toLowerCase().includes(q)
    );
  });

  // Split into categories for Category Deck view
  const finMediaTweets = rawTweets.filter((t) => getAccountMeta(t.author?.username || t.author?.name).category === 'Financial Media');
  const wireTweets = rawTweets.filter((t) => getAccountMeta(t.author?.username || t.author?.name).category === 'News Wire');
  const analystTweets = rawTweets.filter((t) => getAccountMeta(t.author?.username || t.author?.name).category === 'Journalists & Analysts');

  const latestTweet = rawTweets[0];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await mutate();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(rawTweets, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `x-tweets-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Check if latest tweet is high priority
  const isHighPriority = latestTweet && (getAccountMeta(latestTweet.author?.username || latestTweet.author?.name).handle === 'ANI' || getAccountMeta(latestTweet.author?.username || latestTweet.author?.name).handle === 'PTI_News');

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-[var(--accent-primary)]/30 text-[var(--text-primary)] relative">
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Executive Header */}
        <Header
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        {/* Breaking / Latest Event Ticker */}
        {latestTweet && (
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] h-11 flex items-center px-4 sm:px-6 overflow-hidden hover:bg-[var(--bg-surface-raised)] transition-colors cursor-pointer group">
            <div className="max-w-[1600px] w-full mx-auto flex items-center justify-between gap-4 text-[13px] relative z-10">
              <div className="flex items-center gap-2.5 flex-1 min-w-0 mask-fade-right">
                <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded border ${isHighPriority ? 'border-red-500/30 text-red-400' : 'border-[var(--border-subtle)] text-[var(--text-primary)]'} font-semibold font-sans text-[11px] tracking-wide uppercase flex-shrink-0 relative overflow-hidden group-hover:border-[var(--accent-primary)]/50 transition-colors`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isHighPriority ? 'bg-red-500 animate-pulse-priority' : 'bg-[var(--accent-primary)] animate-pulse-live'}`} />
                  LATEST
                </span>
                <span className="font-bold text-[var(--text-primary)] flex-shrink-0 group-hover:text-[var(--accent-primary)] transition-colors">
                  @{getAccountMeta(latestTweet.author?.username || latestTweet.author?.name).handle}:
                </span>
                <span className="text-[var(--text-secondary)] whitespace-nowrap group-hover:text-[var(--text-primary)] transition-colors">
                  {latestTweet.text}
                </span>
              </div>
              <span className="text-[var(--text-muted)] font-mono text-[11px] flex-shrink-0 hidden md:flex items-center">
                {new Date(latestTweet.created_at).toLocaleTimeString()}
              </span>
            </div>
          </div>
        )}

        {/* Main Dashboard Workspace */}
        <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">

          {/* Command Toolbar & Account Filters */}
          <div className="glass-panel p-3.5 space-y-3 hover:border-white/10 transition-colors">
            <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
              
              {/* Filter Area */}
              <div className="flex-1 w-full overflow-hidden">
                <AccountFilter
                  activeAccount={activeAccount}
                  onFilter={setActiveAccount}
                  selectedCategory={selectedCategory}
                  onCategoryChange={setSelectedCategory}
                  counts={counts}
                />
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center gap-2.5 xl:mt-[38px] xl:self-start w-full xl:w-auto overflow-x-auto hide-scrollbar">
                
                <div className="relative flex-1 min-w-[200px]">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-[13px] rounded-full bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--border-focus)] transition-all font-sans"
                  />
                  <svg
                    viewBox="0 0 24 24"
                    className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Refresh Button */}
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing || isValidating}
                  className="p-1.5 px-3 rounded-full bg-[var(--bg-app)] hover:bg-[var(--bg-surface-raised)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-all disabled:opacity-50 flex items-center gap-1.5 text-[13px] font-medium hover:border-[var(--border-medium)] hover:text-[var(--text-primary)] whitespace-nowrap"
                  title="Manual refresh (R)"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className={`w-3.5 h-3.5 ${isRefreshing || isValidating ? 'animate-spin text-[var(--accent-primary)]' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 21h5v-5" />
                  </svg>
                  <span className="hidden md:inline">Refresh</span>
                </button>

                {/* Export JSON Button */}
                <button
                  onClick={handleExportJSON}
                  className="p-1.5 px-3 rounded-full bg-[var(--bg-app)] hover:bg-[var(--bg-surface-raised)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-all flex items-center gap-1.5 text-[13px] font-medium hover:border-[var(--border-medium)] hover:text-[var(--text-primary)] whitespace-nowrap"
                  title="Export all stored tweets to JSON"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span className="hidden md:inline">Export</span>
                </button>
              </div>

            </div>
          </div>

          {/* Real-time Update notification - only appears when new tweets actually arrive */}
          {showUpdateBadge && (
            <div className="flex justify-center -my-2 relative z-20 animate-slide-down">
               <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-lg backdrop-blur-md">
                 <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                 New Updates Received
               </span>
            </div>
          )}

          {/* ═══ VIEW MODE 1: UNIFIED CHRONOLOGICAL STREAM ═══ */}
          {viewMode === 'unified' && (
            <section className="space-y-3">
              {/* Loading skeletons */}
              {(!data && !error) && (
                <div className="space-y-3">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="tweet-card p-5 space-y-4 shimmer">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded bg-[var(--border-subtle)]" />
                        <div className="space-y-2 flex-1">
                          <div className="h-4 w-32 bg-[var(--border-subtle)] rounded" />
                          <div className="h-3 w-20 bg-[var(--border-subtle)] rounded opacity-50" />
                        </div>
                      </div>
                      <div className="space-y-2 pt-2">
                        <div className="h-4 w-full bg-[var(--border-subtle)] rounded opacity-70" />
                        <div className="h-4 w-4/5 bg-[var(--border-subtle)] rounded opacity-70" />
                        <div className="h-4 w-1/2 bg-[var(--border-subtle)] rounded opacity-70" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty State */}
              {data && filteredTweets.length === 0 && (
                <div className="glass-panel p-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-transparent border border-[var(--border-subtle)] flex items-center justify-center mx-auto mb-3 text-[var(--text-primary)]">
                    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">No posts in this channel</h3>
                  <p className="text-sm text-[var(--text-secondary)] max-w-sm mx-auto mt-1">
                    {searchQuery
                      ? `No matching posts for "${searchQuery}".`
                      : 'Awaiting incoming webhook payloads.'}
                  </p>
                </div>
              )}

              {/* Feed Cards */}
              {filteredTweets.map((tweet, idx) => (
                <TweetCard
                  key={tweet.id || idx}
                  tweet={{ ...tweet, isNew: newIds.has(tweet.id) }}
                  index={idx}
                />
              ))}
            </section>
          )}

          {/* ═══ VIEW MODE 2: CATEGORY COMMAND DECK ═══ */}
          {viewMode === 'deck' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Column 1: Financial Media */}
              <DeckColumn
                title="Financial Media"
                subtitle="CNBC, NDTV Profit, ET Now, Zee, Mint"
                color="var(--cat-finance)"
                tweets={finMediaTweets.filter((t) => !searchQuery || t.text?.toLowerCase().includes(searchQuery.toLowerCase()))}
              />

              {/* Column 2: News Wires */}
              <DeckColumn
                title="National News Wires"
                subtitle="ANI & PTI Live Feeds"
                color="var(--cat-news)"
                tweets={wireTweets.filter((t) => !searchQuery || t.text?.toLowerCase().includes(searchQuery.toLowerCase()))}
              />

              {/* Column 3: Journalists & Analysts */}
              <DeckColumn
                title="Analysts & Senior Journalists"
                subtitle="Yatin Mota, Soumeet, Sharad, Tarun, Lakshman"
                color="var(--cat-analyst)"
                tweets={analystTweets.filter((t) => !searchQuery || t.text?.toLowerCase().includes(searchQuery.toLowerCase()))}
              />
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="mt-auto py-5 border-t border-[var(--border-subtle)] text-center text-xs text-[var(--text-muted)] bg-[var(--bg-surface)]">
          <p>X Monitor · High-Frequency Intelligence · Connected to AWS S3</p>
        </footer>
      </div>
    </div>
  );
}

/**
 * Deck column component for 3-Column multi-stream view
 */
function DeckColumn({ title, subtitle, color, tweets = [] }) {
  return (
    <div className={`glass-panel flex flex-col min-h-[550px] hover:border-[var(--border-medium)] transition-colors`}>
      {/* Column Header */}
      <div className="p-3 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface-raised)] rounded-t-[11px]">
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] leading-tight">{title}</h3>
            <p className="text-[11px] text-[var(--text-muted)] truncate max-w-[200px] mt-0.5">{subtitle}</p>
          </div>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--bg-app)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] cursor-default">
          {tweets.length} posts
        </span>
      </div>

      {/* Column Posts Feed */}
      <div className="p-3 space-y-3 flex-1 overflow-y-auto max-h-[75vh] hide-scrollbar">
        {tweets.length === 0 ? (
          <div className="py-16 text-center text-sm text-[var(--text-muted)]">
            No posts recorded in this category yet.
          </div>
        ) : (
          tweets.map((tweet, idx) => (
            <TweetCard
              key={tweet.id || idx}
              tweet={{ ...tweet, isNew: tweet.isNew }}
              index={idx}
              compact={true}
            />
          ))
        )}
      </div>
    </div>
  );
}
