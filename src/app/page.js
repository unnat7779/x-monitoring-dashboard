export const metadata = {
  title: 'X Monitor — Extension Backend',
  description: 'API backend for X Monitor Chrome Extension',
};

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#0a0a0f] text-[#f0f0f5]">
      <div className="max-w-md w-full p-8 rounded-2xl bg-[#13141c] border border-white/10 shadow-2xl space-y-6">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Backend Operational
          </span>
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            X Monitor Extension Backend
          </h1>
          <p className="mt-2 text-sm text-neutral-400">
            Dedicated API service powering the X Monitor Chrome Extension.
          </p>
        </div>

        <div className="space-y-3 pt-2">
          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-between">
            <div>
              <div className="text-xs text-neutral-400 font-mono">GET /api/tweets</div>
              <div className="text-sm font-medium text-neutral-200">Extension Tweet Feed</div>
            </div>
            <a
              href="/api/tweets"
              className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              Test
            </a>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-between">
            <div>
              <div className="text-xs text-neutral-400 font-mono">POST /api/twitter-webhook</div>
              <div className="text-sm font-medium text-neutral-200">Tweet Ingestion Webhook</div>
            </div>
            <a
              href="/api/twitter-webhook"
              className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              Status
            </a>
          </div>
        </div>

        <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs text-neutral-500">
          <span>Connected to Chrome Extension</span>
          <span>Vercel Serverless</span>
        </div>
      </div>
    </main>
  );
}
