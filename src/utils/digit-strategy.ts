export type SupportedMarket = {
    label: string;
    pip?: number;
    symbol: string;
};

export type DigitStrategyId =
    | 'OVER_1_MARKET'
    | 'OVER_2_MARKET'
    | 'OVER_3_MARKET'
    | 'UNDER_6_MARKET'
    | 'UNDER_7_MARKET'
    | 'UNDER_8_MARKET';

export type DigitStrategyDefinition = {
    alertLabel: string;
    contractType: 'DIGITOVER' | 'DIGITUNDER';
    entryLabel: string;
    id: DigitStrategyId;
    losingDigits: number[];
    minWinningDigits: number;
    triggerDigits: number[];
    triggerLabel: string;
    winBarrier: string;
    winningDigits: number[];
};

export type DigitStrategyEvaluation = {
    alertLabel: string;
    entryReady: boolean;
    isQualified: boolean;
    qualifyingWinningDigits: number[];
    trailingTriggerCount: number;
};

export const SUPPORTED_VOLATILITY_MARKETS: SupportedMarket[] = [
    { label: 'Volatility 10 (1s) Index', pip: 2, symbol: '1HZ10V' },
    { label: 'Volatility 25 (1s) Index', pip: 2, symbol: '1HZ25V' },
    { label: 'Volatility 50 (1s) Index', pip: 2, symbol: '1HZ50V' },
    { label: 'Volatility 75 (1s) Index', pip: 2, symbol: '1HZ75V' },
    { label: 'Volatility 100 (1s) Index', pip: 2, symbol: '1HZ100V' },
    { label: 'Volatility 10 Index', pip: 3, symbol: 'R_10' },
    { label: 'Volatility 25 Index', pip: 3, symbol: 'R_25' },
    { label: 'Volatility 50 Index', pip: 3, symbol: 'R_50' },
    { label: 'Volatility 75 Index', pip: 3, symbol: 'R_75' },
    { label: 'Volatility 100 Index', pip: 2, symbol: 'R_100' },
];

export const DIGIT_STRATEGIES: Record<DigitStrategyId, DigitStrategyDefinition> = {
    OVER_1_MARKET: {
        alertLabel: 'Over 1 Market',
        contractType: 'DIGITOVER',
        entryLabel: 'Wait for one winning digit from 2-9 after 3 trigger digits.',
        id: 'OVER_1_MARKET',
        losingDigits: [0, 1],
        minWinningDigits: 3,
        triggerDigits: [0, 1],
        triggerLabel: '3 consecutive digits below 2',
        winBarrier: '1',
        winningDigits: [2, 3, 4, 5, 6, 7, 8, 9],
    },
    OVER_2_MARKET: {
        alertLabel: 'Over 2 Market',
        contractType: 'DIGITOVER',
        entryLabel: 'Wait for one winning digit from 3-9 after 3 trigger digits.',
        id: 'OVER_2_MARKET',
        losingDigits: [0, 1, 2],
        minWinningDigits: 3,
        triggerDigits: [0, 1, 2],
        triggerLabel: '3 consecutive digits below 3',
        winBarrier: '2',
        winningDigits: [3, 4, 5, 6, 7, 8, 9],
    },
    OVER_3_MARKET: {
        alertLabel: 'Over 3 Market',
        contractType: 'DIGITOVER',
        entryLabel: 'Wait for one winning digit from 4-9 after 3 trigger digits.',
        id: 'OVER_3_MARKET',
        losingDigits: [0, 1, 2, 3],
        minWinningDigits: 3,
        triggerDigits: [0, 1, 2, 3],
        triggerLabel: '3 consecutive digits below 4',
        winBarrier: '3',
        winningDigits: [4, 5, 6, 7, 8, 9],
    },
    UNDER_6_MARKET: {
        alertLabel: 'Under 6 Market',
        contractType: 'DIGITUNDER',
        entryLabel: 'Wait for one winning digit from 0-5 after 3 trigger digits.',
        id: 'UNDER_6_MARKET',
        losingDigits: [6, 7, 8, 9],
        minWinningDigits: 3,
        triggerDigits: [6, 7, 8, 9],
        triggerLabel: '3 consecutive digits above 5',
        winBarrier: '6',
        winningDigits: [0, 1, 2, 3, 4, 5],
    },
    UNDER_7_MARKET: {
        alertLabel: 'Under 7 Market',
        contractType: 'DIGITUNDER',
        entryLabel: 'Wait for one winning digit from 0-6 after 3 trigger digits.',
        id: 'UNDER_7_MARKET',
        losingDigits: [7, 8, 9],
        minWinningDigits: 3,
        triggerDigits: [7, 8, 9],
        triggerLabel: '3 consecutive digits above 6',
        winBarrier: '7',
        winningDigits: [0, 1, 2, 3, 4, 5, 6],
    },
    UNDER_8_MARKET: {
        alertLabel: 'Under 8 Market',
        contractType: 'DIGITUNDER',
        entryLabel: 'Wait for one winning digit from 0-7 after 3 trigger digits.',
        id: 'UNDER_8_MARKET',
        losingDigits: [8, 9],
        minWinningDigits: 3,
        triggerDigits: [8, 9],
        triggerLabel: '3 consecutive digits above 7',
        winBarrier: '8',
        winningDigits: [0, 1, 2, 3, 4, 5, 6, 7],
    },
};

const toPercent = (value: number) => Math.round(value * 100) / 100;

export const calculateDigitPercentagesFromDigits = (digits: number[]): Record<number, number> => {
    const counts = new Array(10).fill(0);

    digits.forEach(digit => {
        if (digit >= 0 && digit <= 9) counts[digit] += 1;
    });

    if (digits.length === 0) {
        return Object.fromEntries(counts.map((_, digit) => [digit, 0]));
    }

    return Object.fromEntries(counts.map((count, digit) => [digit, toPercent((count / digits.length) * 100)]));
};

export const evaluateDigitStrategy = (
    strategyId: DigitStrategyId,
    digitPercentages: Record<number, number>,
    recentDigits: number[]
): DigitStrategyEvaluation => {
    const strategy = DIGIT_STRATEGIES[strategyId];

    const losingDigitsOk = strategy.losingDigits.every(digit => (digitPercentages[digit] ?? 0) < 10.5);
    const qualifyingWinningDigits = strategy.winningDigits.filter(digit => (digitPercentages[digit] ?? 0) >= 10.5);
    const isQualified = losingDigitsOk && qualifyingWinningDigits.length >= strategy.minWinningDigits;

    let trailingTriggerCount = 0;
    for (let index = recentDigits.length - 1; index >= 0; index -= 1) {
        if (!strategy.triggerDigits.includes(recentDigits[index])) break;
        trailingTriggerCount += 1;
    }

    const lastFourDigits = recentDigits.slice(-4);
    const entryReady =
        isQualified &&
        lastFourDigits.length === 4 &&
        lastFourDigits.slice(0, 3).every(digit => strategy.triggerDigits.includes(digit)) &&
        strategy.winningDigits.includes(lastFourDigits[3]);

    return {
        alertLabel: strategy.alertLabel,
        entryReady,
        isQualified,
        qualifyingWinningDigits,
        trailingTriggerCount,
    };
};

// A frequency reading from 15 ticks is noise; one from 100+ is at least a
// real recent sample. This scales confidence down for thin samples instead
// of treating every "qualified" reading as equally trustworthy regardless
// of how much data it's actually built on.
export const MIN_RELIABLE_SAMPLE_SIZE = 80;

export const getSampleConfidence = (sampleSize: number, minReliableSize = MIN_RELIABLE_SAMPLE_SIZE): number => {
    if (!Number.isFinite(sampleSize) || sampleSize <= 0) return 0.3;
    return Math.max(0.3, Math.min(1, sampleSize / minReliableSize));
};

export type TColdestDigitSignal = { digit: number; percent: number; possibility: number };

/**
 * A Differs bet against ANY single digit wins whenever the actual digit
 * isn't that one — a structural ~90% base win rate that comes from the
 * contract's own payout structure, not from reading history. Picking the
 * currently coldest digit doesn't materially change that win rate; it's
 * included because a real trader would still rather differ against the
 * digit least likely to repeat right now than an arbitrary one, and it
 * keeps the strategy set from being only streak-trigger Over/Under bets.
 * Gated on a minimum sample so "coldest" reflects an actual recent read,
 * not the first few ticks after the feed connects.
 */
export const findColdestDigitDiffersSignal = (
    digitPercentages: Record<number, number>,
    sampleSize: number,
    minSampleSize = MIN_RELIABLE_SAMPLE_SIZE
): TColdestDigitSignal | null => {
    if (sampleSize < minSampleSize) return null;

    let coldestDigit = 0;
    let coldestPercent = 100;
    for (let digit = 0; digit <= 9; digit += 1) {
        const percent = digitPercentages[digit] ?? 0;
        if (percent < coldestPercent) {
            coldestPercent = percent;
            coldestDigit = digit;
        }
    }

    const deviationBelowExpected = Math.max(0, 10 - coldestPercent);
    const possibility = Math.max(0, Math.min(99, Math.round(88 + deviationBelowExpected * 0.6)));

    return { digit: coldestDigit, percent: coldestPercent, possibility };
};
