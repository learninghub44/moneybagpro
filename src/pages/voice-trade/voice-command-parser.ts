import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';

export type TVoiceContractType = 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';

export type TParsedVoiceTrade = {
    actionLabel: string;
    barrier?: string;
    contractType: TVoiceContractType;
    duration: number;
    marketLabel: string;
    stake: number;
    symbol: string;
};

export type TVoiceParseResult = { ok: true; trade: TParsedVoiceTrade } | { ok: false; message: string };

const DEFAULT_DURATION_TICKS = 5;
const MIN_DURATION_TICKS = 1;
const MAX_DURATION_TICKS = 10;

// Contract types that require a 0-9 barrier digit alongside the action word
// (e.g. "over 5", "matches 7") — mirrors BARRIER_TRADE_GROUPS in manual-trading.tsx.
const BARRIER_CONTRACT_TYPES = new Set<TVoiceContractType>(['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF']);

const NUMBER_WORDS: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100,
};

const TENS_WORDS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ONES_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * Converts spoken number words to digits so downstream regexes only ever
 * have to deal with numerals. Most speech-to-text engines already transcribe
 * numbers as digits, but this is here as a safety net for engines/locales
 * that spell them out.
 */
export const normalizeSpokenNumbers = (text: string): string => {
    let normalized = text;

    // Compound numbers first — "seventy five" -> "75" — before the single-word
    // pass below turns them into "70 5".
    TENS_WORDS.forEach(tensWord => {
        ONES_WORDS.forEach(onesWord => {
            const pattern = new RegExp(`\\b${tensWord}[- ]${onesWord}\\b`, 'g');
            normalized = normalized.replace(pattern, String(NUMBER_WORDS[tensWord] + NUMBER_WORDS[onesWord]));
        });
    });

    Object.entries(NUMBER_WORDS).forEach(([word, digit]) => {
        const pattern = new RegExp(`\\b${word}\\b`, 'g');
        normalized = normalized.replace(pattern, String(digit));
    });

    return normalized;
};

type TMarketAlias = { aliases: string[]; label: string; symbol: string };

const buildMarketAliases = (): TMarketAlias[] =>
    SUPPORTED_VOLATILITY_MARKETS.map(({ label, symbol }) => {
        const is1s = /\(1s\)/i.test(label);
        const number = label.match(/\d+/)?.[0] ?? '';
        const aliases = is1s
            ? [
                  `volatility ${number} 1s`,
                  // "one second" becomes "1 second" by the time this runs,
                  // since normalizeSpokenNumbers already converted "one" -> "1".
                  `volatility ${number} 1 second`,
                  `v${number} 1s`,
                  `volatility ${number}1s`,
              ]
            : [`volatility ${number}`, `v${number}`, `vol ${number}`];

        return { aliases, label, symbol };
    });

const MARKET_ALIASES = buildMarketAliases();

const findMarket = (normalized: string): TMarketAlias | undefined => {
    // Prefer the longest alias match so "volatility 10 1s" doesn't get
    // shadowed by the shorter "volatility 10" (the non-1s market) alias.
    const matches = MARKET_ALIASES.filter(market => market.aliases.some(alias => normalized.includes(alias)));
    if (matches.length === 0) return undefined;

    return matches.reduce((longest, candidate) => {
        const longestAliasLength = Math.max(...longest.aliases.map(alias => alias.length));
        const candidateAliasLength = Math.max(...candidate.aliases.map(alias => alias.length));
        return candidateAliasLength > longestAliasLength ? candidate : longest;
    });
};

type TActionMatch = { actionLabel: string; barrier?: string; contractType: TVoiceContractType };

const findAction = (normalized: string): TActionMatch | undefined => {
    const barrierMatch = normalized.match(/\b(over|under|match(?:es)?|differ(?:s)?)\s+(\d)\b/);
    if (barrierMatch) {
        const [, keyword, digit] = barrierMatch;
        if (keyword === 'over') return { actionLabel: `Over ${digit}`, barrier: digit, contractType: 'DIGITOVER' };
        if (keyword === 'under') return { actionLabel: `Under ${digit}`, barrier: digit, contractType: 'DIGITUNDER' };
        if (keyword.startsWith('match'))
            return { actionLabel: `Matches ${digit}`, barrier: digit, contractType: 'DIGITMATCH' };
        return { actionLabel: `Differs ${digit}`, barrier: digit, contractType: 'DIGITDIFF' };
    }

    if (/\bodd\b/.test(normalized)) return { actionLabel: 'Odd', contractType: 'DIGITODD' };
    if (/\beven\b/.test(normalized)) return { actionLabel: 'Even', contractType: 'DIGITEVEN' };
    if (/\b(rise|call|up|buy high)\b/.test(normalized)) return { actionLabel: 'Rise', contractType: 'CALL' };
    if (/\b(fall|put|down|buy low)\b/.test(normalized)) return { actionLabel: 'Fall', contractType: 'PUT' };

    return undefined;
};

const findStake = (normalized: string): number | undefined => {
    const patterns = [
        /\b(?:stake|amount)\s*(?:of|is)?\s*\$?(\d+(?:\.\d+)?)/,
        /\$(\d+(?:\.\d+)?)/,
        /\b(\d+(?:\.\d+)?)\s*dollars?\b/,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match) return Number(match[1]);
    }

    return undefined;
};

const findDuration = (normalized: string): number => {
    const match = normalized.match(/\b(?:duration|for)?\s*(\d+)\s*ticks?\b/);
    if (!match) return DEFAULT_DURATION_TICKS;

    const value = Number(match[1]);
    if (!Number.isFinite(value)) return DEFAULT_DURATION_TICKS;

    return Math.min(MAX_DURATION_TICKS, Math.max(MIN_DURATION_TICKS, Math.round(value)));
};

/**
 * Parses a raw speech-to-text transcript into a trade the app can actually
 * submit. Returns a specific, speakable-back error message naming exactly
 * what's missing (market / action / stake) rather than a generic failure, so
 * the UI can prompt the person to just repeat that one part.
 */
export const parseVoiceCommand = (rawTranscript: string): TVoiceParseResult => {
    const normalized = normalizeSpokenNumbers(rawTranscript.toLowerCase().trim());

    if (!normalized) {
        return { ok: false, message: "I didn't catch that. Try again." };
    }

    const market = findMarket(normalized);
    const action = findAction(normalized);
    const stake = findStake(normalized);

    const missing: string[] = [];
    if (!market) missing.push('a market, e.g. "Volatility 75 Index"');
    if (!action) missing.push('a trade type, e.g. "Rise", "Over 5", "Even"');
    if (stake === undefined) missing.push('a stake, e.g. "stake 10"');

    if (missing.length > 0) {
        return { ok: false, message: `Missing ${missing.join(' and ')}.` };
    }

    if (stake !== undefined && stake <= 0) {
        return { ok: false, message: 'Stake must be greater than 0.' };
    }

    return {
        ok: true,
        trade: {
            actionLabel: action!.actionLabel,
            barrier: action!.barrier,
            contractType: action!.contractType,
            duration: findDuration(normalized),
            marketLabel: market!.label,
            stake: stake!,
            symbol: market!.symbol,
        },
    };
};

export const contractTypeNeedsBarrier = (contractType: TVoiceContractType): boolean =>
    BARRIER_CONTRACT_TYPES.has(contractType);
