// Re-export shim so existing `@/lib/store` imports keep working.
// The implementation lives in store.mjs so that plain-Node scripts
// (scripts/stream-listener.mjs) can import it directly as ESM.
export * from './store.mjs';
