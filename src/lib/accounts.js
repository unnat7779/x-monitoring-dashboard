/**
 * Monitored Accounts Registry & Metadata
 * Categorized for easy filtering and high-density terminal layout
 */

export const MONITORED_ACCOUNTS = [
  // ── Financial News & Media ──
  {
    handle: 'NDTVProfit',
    name: 'NDTV Profit',
    category: 'Financial Media',
    tag: 'FINANCIAL NEWS',
    color: '#38bdf8', // sky
    verified: true,
  },
  {
    handle: 'NDTVProfitIndia',
    name: 'NDTV Profit',
    category: 'Financial Media',
    tag: 'FINANCIAL NEWS',
    color: '#38bdf8', // sky
    verified: true,
  },
  {
    handle: 'CNBCTV18News',
    name: 'CNBC-TV18',
    category: 'Financial Media',
    tag: 'BUSINESS NEWS',
    color: '#0284c7', // blue
    verified: true,
  },
  {
    handle: 'CNBCTV18Live',
    name: 'CNBC-TV18 Live',
    category: 'Financial Media',
    tag: 'LIVE WIRE',
    color: '#0369a1',
    verified: true,
  },
  {
    handle: 'ETNOWlive',
    name: 'ET NOW',
    category: 'Financial Media',
    tag: 'MARKETS & DEALS',
    color: '#f59e0b', // amber
    verified: true,
  },
  {
    handle: 'ZeeBusiness',
    name: 'Zee Business',
    category: 'Financial Media',
    tag: 'MARKETS HINDI',
    color: '#ef4444', // red
    verified: true,
  },
  {
    handle: 'moneycontrolcom',
    name: 'Moneycontrol',
    category: 'Financial Media',
    tag: 'FINANCE & STOCKS',
    color: '#10b981', // emerald
    verified: true,
  },
  {
    handle: 'livemint',
    name: 'Livemint',
    category: 'Financial Media',
    tag: 'ECONOMY & BIZ',
    color: '#f97316', // orange
    verified: true,
  },
  {
    handle: 'bsindia',
    name: 'Business Standard',
    category: 'Financial Media',
    tag: 'PRINT & DIGITAL',
    color: '#e11d48', // rose
    verified: true,
  },
  {
    handle: 'business',
    name: 'Bloomberg',
    category: 'Financial Media',
    tag: 'GLOBAL MARKETS',
    color: '#8b5cf6', // purple
    verified: true,
  },

  // ── National & Global News Wires ──
  {
    handle: 'ANI',
    name: 'ANI News',
    category: 'News Wire',
    tag: 'NEWS AGENCY',
    color: '#06b6d4', // cyan
    verified: true,
  },
  {
    handle: 'PTI_News',
    name: 'PTI News',
    category: 'News Wire',
    tag: 'NATIONAL WIRE',
    color: '#0ea5e9', // light blue
    verified: true,
  },

  {
    handle: 'LiveLawIndia',
    name: 'Live Law',
    category: 'News Wire',
    tag: 'LEGAL & COURTS',
    color: '#f43f5e', // rose
    verified: true,
  },

  // ── Market Analysts & Senior Journalists ──
  {
    handle: 'YatinMota',
    name: 'Yatin Mota',
    category: 'Journalists & Analysts',
    tag: 'MARKETS & DEALS',
    color: '#34d399', // mint green
    verified: true,
  },
  {
    handle: 'darshanvmehta1',
    name: 'Darshan Mehta',
    category: 'Journalists & Analysts',
    tag: 'MARKETS & DEALS',
    color: '#38bdf8', // sky
    verified: true,
  },
  {
    handle: 'SoumeetSarkar',
    name: 'Soumeet Sarkar',
    category: 'Journalists & Analysts',
    tag: 'IT & TECH DEALS',
    color: '#c084fc', // lavender
    verified: true,
  },
  {
    handle: 'SharadDubey_',
    name: 'Sharad Dubey',
    category: 'Journalists & Analysts',
    tag: 'EQUITY RESEARCH',
    color: '#fbbf24', // yellow
    verified: true,
  },
  {
    handle: 'LakshmanRoy1',
    name: 'Lakshman Roy',
    category: 'Journalists & Analysts',
    tag: 'POLICY & BUDGET',
    color: '#ec4899', // pink
    verified: true,
  },
  {
    handle: 'shukla_tarun',
    name: 'Tarun Shukla',
    category: 'Journalists & Analysts',
    tag: 'INVESTIGATIVE',
    color: '#a855f7', // violet
    verified: true,
  },
];

export const CATEGORIES = [
  'All',
  'Financial Media',
  'News Wire',
  'Journalists & Analysts',
];

/**
 * Helper to get account metadata by handle or name
 */
export function getAccountMeta(handleOrName = '') {
  if (!handleOrName) return getFallbackMeta('unknown');

  const clean = handleOrName.toLowerCase().replace(/[@\s]/g, '');
  const cleanNoUnderscore = clean.replace(/_/g, '');

  const match = MONITORED_ACCOUNTS.find(
    (acc) =>
      acc.handle.toLowerCase() === clean ||
      acc.handle.toLowerCase().replace(/_/g, '') === cleanNoUnderscore ||
      acc.name.toLowerCase().replace(/\s/g, '') === clean ||
      acc.name.toLowerCase().includes(clean)
  );

  if (match) return match;

  return getFallbackMeta(handleOrName);
}

function getFallbackMeta(name) {
  // Generate consistent color from name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#38bdf8', '#34d399', '#c084fc', '#f59e0b', '#ec4899', '#8b5cf6'];
  const color = colors[Math.abs(hash) % colors.length];

  return {
    handle: name.replace(/[@\s]/g, ''),
    name: name,
    category: 'Monitored',
    tag: 'LIVE FEED',
    color,
    verified: true,
  };
}
