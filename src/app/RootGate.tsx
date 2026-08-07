import { Navigate } from 'react-router-dom';
import Landing from '../pages/landing';

/**
 * Renders at '/'. Deriv's OAuth redirect_uri is registered as the bare
 * domain root for every white-label site, so login callbacks always land
 * here first — this must keep working exactly as before.
 *
 * - First-time / logged-out visitors see the landing page.
 * - Anyone returning from an OAuth callback (code/acct1/error in the query
 *   string) or who already has a session in localStorage is sent straight
 *   through to the trading app at /app, query string intact.
 */
const RootGate = () => {
    const params = new URLSearchParams(window.location.search);
    const isOAuthCallback = params.has('code') || params.has('acct1') || params.has('error');
    const hasExistingSession = Boolean(localStorage.getItem('authToken') || localStorage.getItem('active_loginid'));

    if (isOAuthCallback || hasExistingSession) {
        return <Navigate to={`/app${window.location.search}${window.location.hash}`} replace />;
    }

    return <Landing />;
};

export default RootGate;
