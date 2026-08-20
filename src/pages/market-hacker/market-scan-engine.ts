import { api_base } from '@/external/bot-skeleton';
import {
    calculateDigitPercentagesFromDigits,
    DIGIT_STRATEGIES,
    DigitStrategyId,
    evaluateDigitStrategy,
    SUPPORTED_VOLATILITY_MARKETS,
} from '@/utils/digit-strategy';
import { getLastDigitFromQuote } from '@/utils/market-data';
import { safeSubscribe } from '@/utils/websocket-handler';

export const SCAN_WINDOW = 120;
const STAGGER_MS = 180;

export type TMomentum = 'RISE' | 'FALL' | 'FLAT';

export type TStrategySignal = {
    alertLabel: string;
    barrier: string;
    contractType: 'DIGITOVER' | 'DIGITUNDER';
    entryLabel: string;
    entryReady: boolean;
    id: DigitStrategyId;
    isQualified: boolean;
    possibility: number;
    trailingTriggerCount: number;
    triggerLabel: string;
};

export type TTopSignal = {
    barrier?: string;
    contractType?: 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | 'CALL' | 'PUT';
    detail: string;
    entryReady: boolean;
    label: string;
    possibility: number;
};

export type TMarketScan = {
    digitCount: number;
    error: string | null;
    evenPercent: number;
    isLoading: boolean;
    label: string;
    leastFrequentDigit: number;
    leastFrequentPercent: number;
    momentum: TMomentum;
    momentumPossibility: number;
    mostFrequentDigit: number;
    mostFrequentPercent: number;
    oddPercent: number;
    price: number | null;
    strategies: TStrategySignal[];
    symbol: string;
    topSignal: TTopSignal;
};

const clampPossibility = (value: number) => Math.max(0, Math.min(99, Math.round(value)));

const buildStrategySignal = (
    strategyId: DigitStrategyId,
    digitPercentages: Record<number, number>,
    recentDigits: number[]
): TStrategySignal => {
    const strategy = DIGIT_STRATEGIES[strategyId];
    const evaluation = evaluateDigitStrategy(strategyId, digitPercentages, recentDigits);

    let possibility = 30;
    if (evaluation.entryReady) {
        possibility = 92;
    } else if (evaluation.isQualified && evaluation.trailingTriggerCount > 0) {
        possibility = 58 + evaluation.trailingTriggerCount * 9;
    } else if (evaluation.isQualified) {
        possibility = 55;
    }

    return {
        alertLabel: evaluation.alertLabel,
        barrier: strategy.winBarrier,
        contractType: strategy.contractType,
        entryLabel: strategy.entryLabel,
        entryReady: evaluation.entryReady,
        id: strategyId,
        isQualified: evaluation.isQualified,
        possibility: clampPossibility(possibility),
        trailingTriggerCount: evaluation.trailingTriggerCount,
        triggerLabel: strategy.triggerLabel,
    };
};

const buildMomentum = (quotes: number[]): { momentum: TMomentum; possibility: number } => {
    if (quotes.length < 2) return { momentum: 'FLAT', possibility: 30 };

    let ups = 0;
    let downs = 0;
    for (let index = 1; index < quotes.length; index += 1) {
        if (quotes[index] > quotes[index - 1]) ups += 1;
        else if (quotes[index] < quotes[index - 1]) downs += 1;
    }

    const total = ups + downs || 1;
    const skew = Math.abs(ups - downs) / total;
    const possibility = clampPossibility(45 + skew * 90);

    if (ups === downs) return { momentum: 'FLAT', possibility: clampPossibility(possibility * 0.6) };
    return { momentum: ups > downs ? 'RISE' : 'FALL', possibility };
};

export const evaluateMarketScan = (
    symbol: string,
    label: string,
    digits: number[],
    quotes: number[],
    price: number | null
): TMarketScan => {
    const recentDigits = digits.slice(-SCAN_WINDOW);
    const digitPercentages = calculateDigitPercentagesFromDigits(recentDigits);

    let mostFrequentDigit = 0;
    let leastFrequentDigit = 0;
    let mostFrequentPercent = 0;
    let leastFrequentPercent = 100;
    for (let digit = 0; digit <= 9; digit += 1) {
        const percent = digitPercentages[digit] ?? 0;
        if (percent > mostFrequentPercent) {
            mostFrequentPercent = percent;
            mostFrequentDigit = digit;
        }
        if (percent < leastFrequentPercent) {
            leastFrequentPercent = percent;
            leastFrequentDigit = digit;
        }
    }

    const evenPercent = recentDigits.length
        ? Math.round((recentDigits.filter(digit => digit % 2 === 0).length / recentDigits.length) * 10000) / 100
        : 0;
    const oddPercent = Math.round((100 - evenPercent) * 100) / 100;

    const strategies = (Object.keys(DIGIT_STRATEGIES) as DigitStrategyId[]).map(id =>
        buildStrategySignal(id, digitPercentages, recentDigits)
    );

    const { momentum, possibility: momentumPossibility } = buildMomentum(quotes.slice(-SCAN_WINDOW));

    const evenOddPossibility = clampPossibility(50 + Math.abs(evenPercent - 50) * 1.6);
    const evenOddLabel = evenPercent > oddPercent ? 'Even' : 'Odd';

    const candidates: TTopSignal[] = [
        ...strategies.map(strategy => ({
            barrier: strategy.barrier,
            contractType: strategy.contractType,
            detail: strategy.entryReady
                ? `Entry ready now — ${strategy.entryLabel}`
                : strategy.isQualified
                  ? `Building: ${strategy.trailingTriggerCount}/${DIGIT_STRATEGIES[strategy.id].minWinningDigits} trigger digits seen. ${strategy.triggerLabel}, then enter.`
                  : `Market not qualified yet for ${strategy.alertLabel}.`,
            entryReady: strategy.entryReady,
            label: strategy.alertLabel,
            possibility: strategy.possibility,
        })),
        {
            contractType: momentum === 'RISE' ? 'CALL' : momentum === 'FALL' ? 'PUT' : undefined,
            detail:
                momentum === 'FLAT'
                    ? 'Price is moving sideways — no clear directional edge right now.'
                    : `${momentum === 'RISE' ? 'Upward' : 'Downward'} tick momentum over the last ${Math.min(quotes.length, SCAN_WINDOW)} ticks.`,
            entryReady: false,
            label: momentum === 'FLAT' ? 'Flat' : momentum === 'RISE' ? 'Rise' : 'Fall',
            possibility: momentumPossibility,
        },
        {
            contractType: evenOddLabel === 'Even' ? 'DIGITEVEN' : 'DIGITODD',
            detail: `${evenOddLabel} digits are dominating at ${(evenOddLabel === 'Even' ? evenPercent : oddPercent).toFixed(1)}% of the last ${recentDigits.length} ticks.`,
            entryReady: false,
            label: evenOddLabel,
            possibility: evenOddPossibility,
        },
    ];

    const topSignal = candidates.reduce((best, candidate) =>
        candidate.possibility > best.possibility ? candidate : best
    );

    return {
        digitCount: recentDigits.length,
        error: null,
        evenPercent,
        isLoading: false,
        label,
        leastFrequentDigit,
        leastFrequentPercent,
        momentum,
        momentumPossibility,
        mostFrequentDigit,
        mostFrequentPercent,
        oddPercent,
        price,
        strategies,
        symbol,
        topSignal,
    };
};

export const emptyMarketScan = (symbol: string, label: string): TMarketScan => ({
    digitCount: 0,
    error: null,
    evenPercent: 0,
    isLoading: true,
    label,
    leastFrequentDigit: 0,
    leastFrequentPercent: 0,
    momentum: 'FLAT',
    momentumPossibility: 0,
    mostFrequentDigit: 0,
    mostFrequentPercent: 0,
    oddPercent: 0,
    price: null,
    strategies: [],
    symbol,
    topSignal: { detail: 'Loading market data…', entryReady: false, label: 'Scanning…', possibility: 0 },
});

export type TMarketFeedHandlers = {
    onError: (symbol: string, message: string) => void;
    onUpdate: (symbol: string, digits: number[], quotes: number[], price: number) => void;
};

/**
 * Opens staggered ticks_history + live ticks subscriptions for every
 * supported volatility market. Returns a cleanup function that unsubscribes
 * everything — callers must invoke it on unmount or when the tab is hidden.
 */
export const startMarketFeeds = (handlers: TMarketFeedHandlers): (() => void) => {
    let cancelled = false;
    const subscriptions: Array<{ unsubscribe?: () => void }> = [];
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    SUPPORTED_VOLATILITY_MARKETS.forEach((market, index) => {
        const timeout = setTimeout(async () => {
            if (cancelled || !api_base.api) return;

            try {
                const history = await (api_base.api as any).send({
                    adjust_start_time: 1,
                    count: SCAN_WINDOW,
                    end: 'latest',
                    start: 1,
                    style: 'ticks',
                    ticks_history: market.symbol,
                });
                if (cancelled) return;

                const prices = Array.isArray(history?.history?.prices) ? history.history.prices : [];
                const quotes = prices.map((price: number | string) => Number(price)).filter(Number.isFinite);
                const digits = quotes.map((quote: number) => getLastDigitFromQuote(quote, market.symbol));

                if (quotes.length) {
                    handlers.onUpdate(market.symbol, digits, quotes, quotes[quotes.length - 1]);
                }

                const observable = (api_base.api as any).subscribe({ ticks: market.symbol });
                const subscription = safeSubscribe(
                    observable,
                    (data: any) => {
                        const quote = Number(data?.tick?.quote);
                        if (!Number.isFinite(quote)) return;
                        const digit = getLastDigitFromQuote(quote, market.symbol);
                        handlers.onUpdate(market.symbol, [digit], [quote], quote);
                    },
                    () => handlers.onError(market.symbol, 'Live tick stream lost.')
                );
                subscriptions.push(subscription);
            } catch (error) {
                if (!cancelled) {
                    handlers.onError(
                        market.symbol,
                        error instanceof Error ? error.message : 'Could not load this market.'
                    );
                }
            }
        }, index * STAGGER_MS);

        timeouts.push(timeout);
    });

    return () => {
        cancelled = true;
        timeouts.forEach(clearTimeout);
        subscriptions.forEach(subscription => {
            try {
                subscription.unsubscribe?.();
            } catch {
                // Already closed — nothing to do.
            }
        });
    };
};

export { SUPPORTED_VOLATILITY_MARKETS };
