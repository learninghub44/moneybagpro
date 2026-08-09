import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { getCanonicalHostForHost } from '@/components/shared';
import { AuthWrapper } from './app/AuthWrapper';
import { setupChunkLoadErrorRecovery } from './utils/chunk-error-recovery';
import { setupDiagnostics } from './utils/diagnostics';
import { removeLegacyPwaState } from './utils/remove-legacy-pwa';
// Removed AnalyticsInitializer import - analytics dependency removed
// See migrate-docs/ANALYTICS_IMPLEMENTATION_GUIDE.md for re-implementation
import { performVersionCheck } from './utils/version-check';
import './styles/index.scss';

// Set this up before anything else touches a lazy-loaded chunk, so a stale
// tab from a previous deploy recovers with one silent reload instead of
// showing a raw ChunkLoadError screen.
setupChunkLoadErrorRecovery();

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// Perform version check FIRST - before any other operations
performVersionCheck();

// Set up diagnostics for crash monitoring
setupDiagnostics();

removeLegacyPwaState();

const canonicalHost = getCanonicalHostForHost(window.location.hostname);
const shouldRedirectToCanonicalHost = Boolean(canonicalHost && canonicalHost !== window.location.hostname);

if (shouldRedirectToCanonicalHost && canonicalHost) {
    const canonicalUrl = new URL(window.location.href);
    canonicalUrl.hostname = canonicalHost;
    canonicalUrl.port = '';
    window.location.replace(canonicalUrl.toString());
}

if (shouldRedirectToCanonicalHost) {
    // Stop bootstrapping on the alias host while the browser navigates.
} else {
    // Removed AnalyticsInitializer() call - analytics dependency removed
    ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);
}
