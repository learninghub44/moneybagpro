import { useMemo } from 'react';
import { getDomainUIConfig } from '@/components/shared/utils/config/config';
import { domainLoaderConfig, defaultLoaderConfig, DomainLoaderConfig } from './domainLoaderConfig';
import { normalizeHostname } from './normalizeHostname';

/**
 * Hook to get the domain-specific loader configuration
 * @returns The loader configuration for the current domain
 */
export function useDomainLoaderConfig(): DomainLoaderConfig {
    return useMemo(() => {
        const hostname = normalizeHostname(typeof window !== 'undefined' ? window.location.hostname : 'localhost');

        // The site's actual name always comes from here — the same brandName
        // every other part of the app uses (header, tab title, SEO tags) —
        // rather than this file's own domain map, which needs a manual entry
        // per domain and silently falls back to a generic name if one is
        // missing (as it was for every newly added site).
        let brandName = '';
        try {
            brandName = getDomainUIConfig().brandName || '';
        } catch {
            brandName = '';
        }

        const withWelcomeText = (config: DomainLoaderConfig, domain = hostname): DomainLoaderConfig => {
            const siteName = brandName || config.siteName;
            return {
                ...config,
                domain,
                siteName,
                welcomeText: `Welcome to ${domain}`,
                footerText: `Powered by ${siteName}`,
            };
        };

        // Check for exact match
        if (domainLoaderConfig[hostname]) {
            return withWelcomeText(domainLoaderConfig[hostname]);
        }

        // Check for subdomain match (e.g., app.mrduke.site)
        for (const [domain, config] of Object.entries(domainLoaderConfig)) {
            if (hostname.endsWith(`.${domain}`) || hostname === domain) {
                return withWelcomeText(config, domain);
            }
        }

        // Check for preview deployment patterns
        const previewPatterns = [/^[\w-]+--/, /^preview-/, /^pr-/];

        const isPreview = previewPatterns.some(pattern => pattern.test(hostname));

        if (isPreview) {
            // Extract potential domain from preview URL
            const parts = hostname.split('.');
            if (parts.length > 2) {
                const possibleDomain = parts.slice(-2).join('.');
                if (domainLoaderConfig[possibleDomain]) {
                    return withWelcomeText(domainLoaderConfig[possibleDomain], possibleDomain);
                }
            }
        }

        return withWelcomeText(defaultLoaderConfig);
    }, []);
}
