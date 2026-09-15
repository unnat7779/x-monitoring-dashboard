'use client';

import { MONITORED_ACCOUNTS, getAccountMeta } from '@/lib/accounts';

export default function StatsBar({ tweets = [] }) {
  const totalTweets = tweets.length;

  let finMediaCount = 0;
  let wireCount = 0;
  let analystCount = 0;

  tweets.forEach((t) => {
    const meta = getAccountMeta(t.author?.username || t.author?.name);
    if (meta.category === 'Financial Media') finMediaCount++;
    else if (meta.category === 'News Wire') wireCount++;
    else if (meta.category === 'Journalists & Analysts') analystCount++;
  });

  const lastTweet = tweets[0];
  const lastTime = lastTweet?.created_at
    ? new Date(lastTweet.created_at).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {/* Total Ingested */}
      <div className="glass-panel p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-[#71767b]">
          <span className="font-medium">Total Ingested</span>
          <span className="p-1 rounded bg-[#2f3336]/30 text-white">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono-tight text-white">{totalTweets}</span>
          <span className="text-[11px] text-[#71767b] font-medium font-mono">Synced to S3</span>
        </div>
      </div>

      {/* Financial Media */}
      <div className="glass-panel p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-[#71767b]">
          <span className="font-medium text-white">Financial Media</span>
          <span className="text-[10px] font-mono">8 Channels</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-2xl font-bold font-mono-tight text-white">{finMediaCount}</span>
          <span className="text-[10px] text-[#71767b] uppercase font-mono">Markets / TV</span>
        </div>
      </div>

      {/* News Wires */}
      <div className="glass-panel p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-[#71767b]">
          <span className="font-medium text-white">News Wires</span>
          <span className="text-[10px] font-mono">ANI / PTI</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-2xl font-bold font-mono-tight text-white">{wireCount}</span>
          <span className="text-[10px] text-[#71767b] uppercase font-mono">National</span>
        </div>
      </div>

      {/* Analysts & Journalists */}
      <div className="glass-panel p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-[#71767b]">
          <span className="font-medium text-white">Analysts & Tech</span>
          <span className="text-[10px] font-mono">5 Channels</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-2xl font-bold font-mono-tight text-white">{analystCount}</span>
          <span className="text-[10px] text-[#71767b] uppercase font-mono">Exclusive</span>
        </div>
      </div>

      {/* Last Ingestion */}
      <div className="glass-panel p-3.5 col-span-2 sm:col-span-1 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-[#71767b]">
          <span className="font-medium">Last Event</span>
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-base font-bold font-mono-tight text-white">{lastTime}</span>
          <span className="text-[10px] text-[#71767b] font-mono">UTC+5:30</span>
        </div>
      </div>
    </div>
  );
}
