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

type TBarrierKeyword = 'differ' | 'match' | 'over' | 'under';

const BARRIER_KEYWORD_TO_CONTRACT: Record<TBarrierKeyword, TVoiceContractType> = {
    differ: 'DIGITDIFF',
    match: 'DIGITMATCH',
    over: 'DIGITOVER',
    under: 'DIGITUNDER',
};

const BARRIER_KEYWORD_TO_LABEL: Record<TBarrierKeyword, string> = {
    differ: 'Differs',
    match: 'Matches',
    over: 'Over',
    under: 'Under',
};

const normalizeBarrierKeyword = (keyword: string): TBarrierKeyword => {
    if (keyword === 'over') return 'over';
    if (keyword === 'under') return 'under';
    if (keyword.startsWith('match')) return 'match';
    return 'differ';
};

type TActionMatch = { actionLabel: string; barrier?: string; contractType: TVoiceContractType };

/**
 * A barrier action word (over/under/matches/differs) said without its digit
 * — "trade over" with no number yet. Kept separate from a completed
 * TActionMatch so the conversational flow knows to ask specifically for the
 * missing digit next, instead of re-asking the whole trade-type question.
 */
type TPendingBarrier = { keyword: TBarrierKeyword };

const findAction = (normalized: string): TActionMatch | TPendingBarrier | undefined => {
    const barrierMatch = normalized.match(/\b(over|under|match(?:es)?|differ(?:s)?)\s+(\d)\b/);
    if (barrierMatch) {
        const [, rawKeyword, digit] = barrierMatch;
        const keyword = normalizeBarrierKeyword(rawKeyword);
        return {
            actionLabel: `${BARRIER_KEYWORD_TO_LABEL[keyword]} ${digit}`,
            barrier: digit,
            contractType: BARRIER_KEYWORD_TO_CONTRACT[keyword],
        };
    }

    const bareBarrierMatch = normalized.match(/\b(over|under|match(?:es)?|differ(?:s)?)\b/);
    if (bareBarrierMatch) {
        return { keyword: normalizeBarrierKeyword(bareBarrierMatch[1]) };
    }

    if (/\bodd\b/.test(normalized)) return { actionLabel: 'Odd', contractType: 'DIGITODD' };
    if (/\beven\b/.test(normalized)) return { actionLabel: 'Even', contractType: 'DIGITEVEN' };
    if (/\b(rise|call|up|buy high)\b/.test(normalized)) return { actionLabel: 'Rise', contractType: 'CALL' };
    if (/\b(fall|put|down|buy low)\b/.test(normalized)) return { actionLabel: 'Fall', contractType: 'PUT' };

    return undefined;
};

const isPendingBarrier = (action: TActionMatch | TPendingBarrier): action is TPendingBarrier => 'keyword' in action;

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

const findDurationIfSpecified = (normalized: string): number | undefined => {
    const match = normalized.match(/\b(?:duration|for)?\s*(\d+)\s*ticks?\b/);
    if (!match) return undefined;

    const value = Number(match[1]);
    if (!Number.isFinite(value)) return undefined;

    return Math.min(MAX_DURATION_TICKS, Math.max(MIN_DURATION_TICKS, Math.round(value)));
};

/**
 * Parses a raw speech-to-text transcript into a trade the app can actually
 * submit in one shot. Returns a specific, speakable-back error message
 * naming exactly what's missing (market / action / stake) rather than a
 * generic failure. Kept for the "say the whole thing at once" case; the
 * conversational back-and-forth flow uses the draft/slot functions below,
 * which share the same underlying extraction.
 */
export const parseVoiceCommand = (rawTranscript: string): TVoiceParseResult => {
    const normalized = normalizeSpokenNumbers(rawTranscript.toLowerCase().trim());

    if (!normalized) {
        return { ok: false, message: "I didn't catch that. Try again." };
    }

    const market = findMarket(normalized);
    const action = findAction(normalized);
    const resolvedAction = action && !isPendingBarrier(action) ? action : undefined;
    const stake = findStake(normalized);

    const missing: string[] = [];
    if (!market) missing.push('a market, e.g. "Volatility 75 Index"');
    if (!resolvedAction) missing.push('a trade type, e.g. "Rise", "Over 5", "Even"');
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
            actionLabel: resolvedAction!.actionLabel,
            barrier: resolvedAction!.barrier,
            contractType: resolvedAction!.contractType,
            duration: findDurationIfSpecified(normalized) ?? DEFAULT_DURATION_TICKS,
            marketLabel: market!.label,
            stake: stake!,
            symbol: market!.symbol,
        },
    };
};

export const contractTypeNeedsBarrier = (contractType: TVoiceContractType): boolean =>
    BARRIER_CONTRACT_TYPES.has(contractType);

// ---------------------------------------------------------------------------
// Conversational slot-filling: build a trade up over several turns instead of
// requiring one perfectly-formed sentence. Each turn's transcript is merged
// into a growing draft; getNextVoiceSlot says what to ask for next.
// ---------------------------------------------------------------------------

export type TVoiceSlot = 'action' | 'barrier' | 'market' | 'stake';

export type TTradeDraft = {
    actionLabel?: string;
    barrier?: string;
    contractType?: TVoiceContractType;
    duration?: number;
    marketLabel?: string;
    pendingBarrierKeyword?: TBarrierKeyword;
    stake?: number;
    symbol?: string;
};

export const EMPTY_TRADE_DRAFT: TTradeDraft = {};

/**
 * Merges whatever a single utterance contains into the running draft.
 * Later turns overwrite earlier ones field-by-field, so someone can correct
 * themselves mid-conversation ("actually make it 20") without starting over.
 * `expectedSlot` (the slot the app just asked about, if any) enables lenient
 * single-value replies that wouldn't parse on their own — a bare "10" is
 * read as the stake if that's what was asked, a bare "5" is read as the
 * barrier digit if a barrier keyword is already pending, etc.
 */
export const mergeVoiceTranscriptIntoDraft = (
    draft: TTradeDraft,
    rawTranscript: string,
    expectedSlot?: TVoiceSlot | null
): TTradeDraft => {
    const normalized = normalizeSpokenNumbers(rawTranscript.toLowerCase().trim());
    const next: TTradeDraft = { ...draft };

    const market = findMarket(normalized);
    if (market) {
        next.marketLabel = market.label;
        next.symbol = market.symbol;
    } else if (expectedSlot === 'market') {
        // Bare number reply to "which market?" — e.g. just "75" or "ten".
        const bareNumber = normalized.match(/\b(\d+(?:\.\d+)?)\b/);
        if (bareNumber) {
            const impliedIs1s = /\b1s\b|\b1 second\b/.test(normalized);
            const implied = findMarket(impliedIs1s ? `volatility ${bareNumber[1]} 1s` : `volatility ${bareNumber[1]}`);
            if (implied) {
                next.marketLabel = implied.label;
                next.symbol = implied.symbol;
            }
        }
    }

    if (expectedSlot === 'barrier' && draft.pendingBarrierKeyword) {
        const bareDigit = normalized.match(/\b(\d)\b/);
        if (bareDigit) {
            const keyword = draft.pendingBarrierKeyword;
            next.contractType = BARRIER_KEYWORD_TO_CONTRACT[keyword];
            next.actionLabel = `${BARRIER_KEYWORD_TO_LABEL[keyword]} ${bareDigit[1]}`;
            next.barrier = bareDigit[1];
            next.pendingBarrierKeyword = undefined;
        }
    } else {
        const action = findAction(normalized);
        if (action) {
            if (isPendingBarrier(action)) {
                next.pendingBarrierKeyword = action.keyword;
                next.contractType = undefined;
                next.actionLabel = undefined;
                next.barrier = undefined;
            } else {
                next.actionLabel = action.actionLabel;
                next.barrier = action.barrier;
                next.contractType = action.contractType;
                next.pendingBarrierKeyword = undefined;
            }
        }
    }

    const stake = findStake(normalized);
    if (stake !== undefined) {
        next.stake = stake;
    } else if (expectedSlot === 'stake' || expectedSlot === null) {
        const bareNumber = normalized.match(/\b(\d+(?:\.\d+)?)\b/);
        if (bareNumber) next.stake = Number(bareNumber[1]);
    }

    const duration = findDurationIfSpecified(normalized);
    if (duration !== undefined) next.duration = duration;

    return next;
};

/** Which slot to ask about next, or null once the draft is ready to confirm. */
export const getNextVoiceSlot = (draft: TTradeDraft): TVoiceSlot | null => {
    if (!draft.symbol || !draft.marketLabel) return 'market';
    if (draft.pendingBarrierKeyword) return 'barrier';
    if (!draft.contractType) return 'action';
    if (draft.stake === undefined) return 'stake';
    return null;
};

export const getVoiceSlotQuestion = (slot: TVoiceSlot, draft: TTradeDraft): string => {
    if (slot === 'market') return 'Which market? For example, Volatility 75 Index.';
    if (slot === 'barrier') {
        const keyword = draft.pendingBarrierKeyword ? BARRIER_KEYWORD_TO_LABEL[draft.pendingBarrierKeyword] : 'that';
        return `${keyword} which digit, 0 to 9?`;
    }
    if (slot === 'action') return 'What trade type? Rise, Fall, Even, Odd, Over, Under, Matches, or Differs.';
    return 'How much do you want to stake?';
};

export const isVoiceDraftComplete = (draft: TTradeDraft): draft is TTradeDraft & {
    contractType: TVoiceContractType;
    marketLabel: string;
    stake: number;
    symbol: string;
} => getNextVoiceSlot(draft) === null && draft.stake !== undefined && draft.stake > 0;

export const finalizeVoiceDraft = (draft: TTradeDraft): TParsedVoiceTrade | undefined => {
    if (!isVoiceDraftComplete(draft)) return undefined;

    return {
        actionLabel: draft.actionLabel ?? '',
        barrier: draft.barrier,
        contractType: draft.contractType,
        duration: draft.duration ?? DEFAULT_DURATION_TICKS,
        marketLabel: draft.marketLabel,
        stake: draft.stake,
        symbol: draft.symbol,
    };
};

export const describeVoiceDraftForConfirmation = (trade: TParsedVoiceTrade, currency: string): string =>
    `${trade.actionLabel} on ${trade.marketLabel}, stake ${trade.stake} ${currency}, ${trade.duration} ticks. Say yes to confirm, or no to cancel.`;

export type TVoiceYesNo = 'no' | 'yes' | undefined;

export const parseVoiceYesNo = (rawTranscript: string): TVoiceYesNo => {
    const normalized = rawTranscript.toLowerCase().trim();

    // Check negation first — phrases like "don't do it" or "no, don't place it"
    // contain word sequences ("do it", "place it") that would otherwise match
    // the affirmative pattern below. Getting this backwards on a real-money
    // confirmation is exactly the kind of bug that must not ship.
    if (/\b(no|nope|nah|cancel|stop|don'?t|do not|abort)\b/.test(normalized)) return 'no';
    if (/\b(yes|yeah|yep|confirm|correct|go ahead|buy it|place it|do it)\b/.test(normalized)) return 'yes';

    return undefined;
};

export const hasVoiceCancelIntent = (rawTranscript: string): boolean =>
    /\b(cancel|stop|never mind|nevermind|forget it|abort)\b/.test(rawTranscript.toLowerCase().trim());

export type TVoiceReplyOutcome =
    | { kind: 'ask'; draft: TTradeDraft; prompt: string; slot: TVoiceSlot | 'confirmation' }
    | { kind: 'cancelled' }
    | { kind: 'confirmed'; trade: TParsedVoiceTrade };

/**
 * The single place that decides what happens after one turn of conversation,
 * given what was already gathered (draft) and what the app just asked about
 * (slot, or 'confirmation' once the draft is complete). Used identically by
 * the spoken-voice loop and the typed-text fallback so both modes behave the
 * same way — cancel words, yes/no, and mid-flow corrections all work
 * regardless of whether the person is talking or typing.
 */
export const processVoiceReply = (
    rawTranscript: string,
    draft: TTradeDraft,
    slot: TVoiceSlot | 'confirmation',
    currency: string
): TVoiceReplyOutcome => {
    if (hasVoiceCancelIntent(rawTranscript)) return { kind: 'cancelled' };

    if (slot === 'confirmation') {
        const answer = parseVoiceYesNo(rawTranscript);
        if (answer === 'yes') {
            const trade = finalizeVoiceDraft(draft);
            if (trade) return { kind: 'confirmed', trade };
        }
        if (answer === 'no') return { kind: 'cancelled' };

        // Not a clear yes/no — treat it as a correction ("actually make it 20")
        // and re-confirm with the updated draft rather than failing the turn.
        const corrected = mergeVoiceTranscriptIntoDraft(draft, rawTranscript, null);
        const nextSlot = getNextVoiceSlot(corrected);
        if (nextSlot) {
            return { draft: corrected, kind: 'ask', prompt: getVoiceSlotQuestion(nextSlot, corrected), slot: nextSlot };
        }
        const trade = finalizeVoiceDraft(corrected)!;
        return {
            draft: corrected,
            kind: 'ask',
            prompt: describeVoiceDraftForConfirmation(trade, currency),
            slot: 'confirmation',
        };
    }

    const merged = mergeVoiceTranscriptIntoDraft(draft, rawTranscript, slot);
    const nextSlot = getNextVoiceSlot(merged);
    if (nextSlot) {
        return { draft: merged, kind: 'ask', prompt: getVoiceSlotQuestion(nextSlot, merged), slot: nextSlot };
    }
    const trade = finalizeVoiceDraft(merged)!;
    return { draft: merged, kind: 'ask', prompt: describeVoiceDraftForConfirmation(trade, currency), slot: 'confirmation' };
};
