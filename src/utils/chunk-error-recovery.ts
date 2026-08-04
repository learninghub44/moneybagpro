// After every deploy, the build's JS is split into hashed chunk files and
// the old ones are removed from the server. Anyone who already had the app
// open (or is loading from a stale cached index.html) can still be holding
// a reference to a chunk hash that no longer exists — the resulting fetch
// 404s and surfaces as a raw "ChunkLoadError" screen, which looks like the
// app itself is broken even though nothing is actually wrong with the code.
//
// The fix is simple and standard: the *current* index.html on the server
// always references the *current* chunk hashes, so a full reload resolves
// it. This module does that reload automatically, once, so the user never
// has to see the raw error or manually hard-refresh.

const RELOAD_FLAG = 'chunk_reload_attempted';

const isChunkLoadError = (error: unknown): boolean => {
    if (!error) return false;

    const name = (error as { name?: string })?.name ?? '';
    const message = (error as { message?: string })?.message ?? String(error);

    if (name === 'ChunkLoadError') return true;
    return /loading (chunk|css chunk) [\w.-]+ failed/i.test(message);
};

const reloadOnce = () => {
    try {
        // Cap at one automatic reload per browser session. If the chunk is
        // still missing after a fresh load, the deploy itself is broken
        // (not just a stale tab), and repeatedly reloading would just loop
        // forever instead of surfacing the real problem.
        if (sessionStorage.getItem(RELOAD_FLAG) === '1') return;
        sessionStorage.setItem(RELOAD_FLAG, '1');
    } catch {
        // If sessionStorage isn't available, fall through and reload anyway
        // — worst case is a single extra reload, which is harmless.
    }

    window.location.reload();
};

export const setupChunkLoadErrorRecovery = (): void => {
    // Dynamic `import()` failures (React.lazy, route-level code splitting)
    // surface as unhandled promise rejections, not as window 'error' events.
    window.addEventListener('unhandledrejection', event => {
        if (isChunkLoadError(event.reason)) {
            event.preventDefault();
            reloadOnce();
        }
    });

    // A directly injected <script> tag failing to load (less common with
    // this build setup, but cheap to also cover) surfaces as a plain error.
    window.addEventListener('error', event => {
        if (isChunkLoadError(event.error)) {
            reloadOnce();
        }
    });
};
