import { findBestAiHubSignal, type TAiHubCategory, type TAiHubSignal } from '../ai-hub/ai-hub-engine';
import type { TMarketScan } from '../market-hacker/market-scan-engine';

const ALL_CATEGORIES: TAiHubCategory[] = ['over_under', 'even_odd', 'matches_differs', 'rise_fall'];

/**
 * Apex Bot doesn't ask the user to pick a strategy category up front — it
 * continuously checks every category (Over/Under, Even/Odd, Matches/Differs,
 * Rise/Fall) across every market and trades whichever single signal is
 * currently strongest, wherever it is.
 */
export const findBestSignalAcrossAllCategories = (scans: Record<string, TMarketScan>): TAiHubSignal | null => {
    let best: TAiHubSignal | null = null;

    ALL_CATEGORIES.forEach(category => {
        const candidate = findBestAiHubSignal(scans, category);
        if (candidate && (!best || candidate.possibility > best.possibility)) {
            best = candidate;
        }
    });

    return best;
};

export type TApexTradeLogEntry = {
    id: string;
    text: string;
    timestamp: number;
    tone: 'info' | 'win' | 'loss';
};

export const formatPl = (value: number, currency: string) => {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)} ${currency}`;
};
