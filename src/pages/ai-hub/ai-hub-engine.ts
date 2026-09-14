import type { TMarketScan } from '../market-hacker/market-scan-engine';

export type TAiHubCategory = 'even_odd' | 'over_under' | 'rise_fall';

export type TAiHubContractType = 'CALL' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'PUT';

const CATEGORY_CONTRACT_TYPES: Record<TAiHubCategory, TAiHubContractType[]> = {
    even_odd: ['DIGITEVEN', 'DIGITODD'],
    over_under: ['DIGITOVER', 'DIGITUNDER'],
    rise_fall: ['CALL', 'PUT'],
};

// Below this, a candidate is more noise than edge — matches the qualification
// bar market-scan-engine already treats as "qualified" (55) rather than
// inventing a separate threshold.
export const MIN_SIGNAL_POSSIBILITY = 55;

export type TAiHubSignal = {
    barrier?: string;
    contractType: TAiHubContractType;
    detail: string;
    label: string;
    marketLabel: string;
    possibility: number;
    symbol: string;
};

/**
 * Scans every market's already-computed candidates (from market-scan-engine)
 * for the requested category and returns the single highest-possibility one
 * across all markets, or null if nothing currently clears the minimum bar.
 */
export const findBestAiHubSignal = (
    scans: Record<string, TMarketScan>,
    category: TAiHubCategory
): TAiHubSignal | null => {
    const allowedTypes = CATEGORY_CONTRACT_TYPES[category];
    let best: TAiHubSignal | null = null;

    Object.values(scans).forEach(scan => {
        if (scan.isLoading || scan.error) return;

        scan.candidates.forEach(candidate => {
            if (!candidate.contractType) return;
            if (!allowedTypes.includes(candidate.contractType as TAiHubContractType)) return;
            if (candidate.possibility < MIN_SIGNAL_POSSIBILITY) return;
            if (best && candidate.possibility <= best.possibility) return;

            best = {
                barrier: candidate.barrier,
                contractType: candidate.contractType as TAiHubContractType,
                detail: candidate.detail,
                label: candidate.label,
                marketLabel: scan.label,
                possibility: candidate.possibility,
                symbol: scan.symbol,
            };
        });
    });

    return best;
};

export const contractTypeNeedsBarrier = (contractType: TAiHubContractType): boolean =>
    contractType === 'DIGITOVER' || contractType === 'DIGITUNDER';

export type TAiHubRunConfig = {
    martingaleMultiplier: number;
    stake: number;
    stopLoss: number;
    takeProfit: number;
    ticks: number;
};

const clampMultiplier = (value: number) => (Number.isFinite(value) && value > 1 ? value : 1);

/**
 * Stake for the next run in a Martingale sequence: doubles (or whatever
 * multiplier is configured) after every loss, resets to base stake after a
 * win. A flat multiplier of 1 (or an invalid one) means no Martingale at all
 * — every run uses the base stake.
 */
export const getNextMartingaleStake = (baseStake: number, multiplier: number, consecutiveLossCount: number): number => {
    if (!Number.isFinite(baseStake) || baseStake <= 0) return baseStake;
    const effectiveMultiplier = clampMultiplier(multiplier);
    if (effectiveMultiplier === 1 || consecutiveLossCount <= 0) return baseStake;

    return Number((baseStake * effectiveMultiplier ** consecutiveLossCount).toFixed(2));
};

export type TAiHubStopReason = 'error' | 'manual' | 'stop_loss' | 'take_profit';

/**
 * After a run settles, decides whether the sequence should keep going and
 * why it stopped if not. Pure so the stopping rule is easy to verify without
 * wiring up a fake WebSocket.
 */
export const evaluateRunStopCondition = (
    totalProfit: number,
    config: Pick<TAiHubRunConfig, 'stopLoss' | 'takeProfit'>
): TAiHubStopReason | null => {
    if (config.takeProfit > 0 && totalProfit >= config.takeProfit) return 'take_profit';
    if (config.stopLoss > 0 && totalProfit <= -Math.abs(config.stopLoss)) return 'stop_loss';
    return null;
};
