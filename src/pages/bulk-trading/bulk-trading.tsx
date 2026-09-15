import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { getLastDigitFromQuote, isExpectedStreamInterruption } from '@/utils/market-data';
import { safeSubscribe } from '@/utils/websocket-handler';
import {
    getLinkedAccounts,
    runBulkTradeAcrossAccounts,
    runBulkTradesOnActiveAccount,
    type TBulkTradeParameters,
    type TBulkTradeResult,
    type TLinkedAccount,
} from './bulk-trade-executor';
import './bulk-trading.scss';

// ---------------------------------------------------------------------------
// Digit scanner primitives (mirrors the read/analysis logic manual-trading
// already uses for its own digit dial, kept local here so Bulk Trading can
// evolve its own trade-ticket shape independently).
// ---------------------------------------------------------------------------

type TTickPoint = { epoch: number; quote: number };
type TDigitStat = { digit: number; count: number; percent: number };
type TTradeGroup = 'even_odd' | 'over_under' | 'matches_differs';
type TTradeVariant = {
    contractType: 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';
    label: string;
    tone: 'teal' | 'red';
};

const MARKETS = SUPPORTED_VOLATILITY_MARKETS;
const MIN_SAMPLE_TICKS = 25;
const MAX_SAMPLE_TICKS = 1000;
const DEFAULT_SAMPLE_TICKS = 120;

const TRADE_GROUPS: { value: TTradeGroup; label: string }[] = [
    { value: 'even_odd', label: 'Even/Odd' },
    { value: 'over_under', label: 'Over/Under' },
    { value: 'matches_differs', label: 'Matches/Differs' },
];

const TRADE_VARIANTS: Record<TTradeGroup, TTradeVariant[]> = {
    even_odd: [
        { contractType: 'DIGITEVEN', label: 'Even', tone: 'teal' },
        { contractType: 'DIGITODD', label: 'Odd', tone: 'red' },
    ],
    over_under: [
        { contractType: 'DIGITOVER', label: 'Over', tone: 'teal' },
        { contractType: 'DIGITUNDER', label: 'Under', tone: 'red' },
    ],
    matches_differs: [
        { contractType: 'DIGITMATCH', label: 'Matches', tone: 'teal' },
        { contractType: 'DIGITDIFF', label: 'Differs', tone: 'red' },
    ],
};

const NEEDS_BARRIER = new Set<TTradeGroup>(['over_under', 'matches_differs']);

const RING_COLORS = {
    highest: '#0ba95b',
    secondHighest: '#1868ef',
    least: '#ff3b3b',
    secondLeast: '#f5a623',
    neutral: '#dfe3e6',
};

const OVER_UNDER_PROFIT_PERCENT: Record<'DIGITOVER' | 'DIGITUNDER', Record<number, number>> = {
    DIGITOVER: { 0: 6, 1: 19, 2: 36, 3: 59, 4: 91, 5: 138, 6: 218, 7: 377, 8: 853 },
    DIGITUNDER: { 1: 853, 2: 377, 3: 218, 4: 138, 5: 91, 6: 59, 7: 36, 8: 19, 9: 6 },
};

const getProfitPercent = (contractType: TTradeVariant['contractType'], barrier: string) => {
    if (contractType === 'DIGITEVEN' || contractType === 'DIGITODD') return 85;
    if (contractType === 'DIGITDIFF') return 6;
    if (contractType === 'DIGITMATCH') return 800;

    const digitBarrier = Number(barrier);
    if (!Number.isInteger(digitBarrier)) return null;
    return OVER_UNDER_PROFIT_PERCENT[contractType]?.[digitBarrier] ?? null;
};

const formatMoney = (value: number, currency: string) =>
    Number.isFinite(value) ? `${value.toFixed(2)} ${currency}` : `-- ${currency}`;

const calculateDigitStats = (ticks: TTickPoint[], symbol: string): TDigitStat[] => {
    const counts = new Array(10).fill(0);
    ticks.forEach(tick => {
        counts[getLastDigitFromQuote(tick.quote, symbol)] += 1;
    });
    return counts.map((count, digit) => ({
        digit,
        count,
        percent: ticks.length ? Math.round((count / ticks.length) * 10000) / 100 : 0,
    }));
};

const getSpecialDigitColorMap = (stats: TDigitStat[], hasTicks: boolean) => {
    if (!hasTicks) return {} as Record<number, string>;
    const colorMap: Record<number, string> = {};
    const descending = [...stats].sort((a, b) => b.percent - a.percent || b.digit - a.digit);
    const ascending = [...stats].sort((a, b) => a.percent - b.percent || a.digit - b.digit);
    colorMap[descending[0].digit] = RING_COLORS.highest;
    colorMap[descending[1].digit] = RING_COLORS.secondHighest;
    colorMap[ascending[0].digit] = RING_COLORS.least;
    colorMap[ascending[1].digit] = RING_COLORS.secondLeast;
    return colorMap;
};

const getQuoteFromTick = (data: any): TTickPoint | null => {
    const quote = Number(data?.tick?.quote);
    if (!Number.isFinite(quote)) return null;
    return { epoch: Number(data?.tick?.epoch) || Math.floor(Date.now() / 1000), quote };
};

const clampSampleTicks = (value: number) => {
    if (!Number.isFinite(value)) return DEFAULT_SAMPLE_TICKS;
    return Math.min(MAX_SAMPLE_TICKS, Math.max(MIN_SAMPLE_TICKS, Math.round(value)));
};

const clampCount = (value: number, min: number, max: number) => {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
};

const initials = (loginid: string) =>
    loginid.replace(/[0-9]/g, '').slice(0, 2).toUpperCase() || loginid.slice(0, 2).toUpperCase();

const AiScannerIcon = () => (
    <svg fill='none' height='18' viewBox='0 0 24 24' width='18' xmlns='http://www.w3.org/2000/svg'>
        <rect height='10' rx='2' stroke='currentColor' strokeWidth='1.6' width='10' x='7' y='7' />
        <rect height='4' rx='1' stroke='currentColor' strokeWidth='1.6' width='4' x='10' y='10' />
        <path
            d='M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2'
            stroke='currentColor'
            strokeLinecap='round'
            strokeWidth='1.6'
        />
    </svg>
);

const WarningIcon = () => (
    <svg fill='none' height='16' viewBox='0 0 24 24' width='16' xmlns='http://www.w3.org/2000/svg'>
        <path
            d='M12 3.5 22 20.5H2L12 3.5Z'
            stroke='currentColor'
            strokeLinejoin='round'
            strokeWidth='1.6'
        />
        <path d='M12 10v4.5' stroke='currentColor' strokeLinecap='round' strokeWidth='1.6' />
        <circle cx='12' cy='17.3' fill='currentColor' r='0.9' />
    </svg>
);

const BulkTrading = observer(() => {
    const { client, run_panel, summary_card, transactions } = useStore();
    const currency = client?.currency || 'USD';
    const [mode, setMode] = useState<'scanner' | 'accounts'>('scanner');

    const pushContract = (data: Record<string, any>) => {
        try {
            transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
            run_panel.onBotContractEvent(data);
            summary_card.onBotContractEvent(data);
        } catch {
            // Bulk Trading should not fail because a side panel observer is unavailable.
        }
    };

    // ---------------------------------------------------------------------
    // Scanner mode: one trade, fired as several simultaneous copies on the
    // account currently active in the app, guided by a live digit scanner.
    // ---------------------------------------------------------------------
    const [symbol, setSymbol] = useState(MARKETS[MARKETS.length - 1]?.symbol ?? MARKETS[0].symbol);
    const [tradeGroup, setTradeGroup] = useState<TTradeGroup>('even_odd');
    const [barrier, setBarrier] = useState('5');
    const [sampleTicksInput, setSampleTicksInput] = useState(String(DEFAULT_SAMPLE_TICKS));
    const [ticks, setTicks] = useState<TTickPoint[]>([]);
    const [isLive, setIsLive] = useState(false);
    const [isScannerOpen, setIsScannerOpen] = useState(true);
    const [isWarningOpen, setIsWarningOpen] = useState(false);

    const [durationInput, setDurationInput] = useState('1');
    const [stakeInput, setStakeInput] = useState('0.5');
    const [bulkCountInput, setBulkCountInput] = useState('1');

    const [isAutoTraderArmed, setIsAutoTraderArmed] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [runningSide, setRunningSide] = useState<string | null>(null);
    const [lastRunSummary, setLastRunSummary] = useState<{ ok: number; won: number; lost: number } | null>(null);
    const [scannerError, setScannerError] = useState<string | null>(null);

    const subscriptionRef = useRef<{ unsubscribe?: () => void } | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestVersionRef = useRef(0);
    const autoTraderActiveRef = useRef(false);
    const bulkCountRef = useRef(1);

    const activeSampleTicks = clampSampleTicks(Number(sampleTicksInput));
    const selectedMarket = useMemo(() => MARKETS.find(market => market.symbol === symbol) ?? MARKETS[0], [symbol]);

    const digitStats = useMemo(() => calculateDigitStats(ticks, symbol), [ticks, symbol]);
    const specialDigitColorMap = useMemo(
        () => getSpecialDigitColorMap(digitStats, ticks.length > 0),
        [digitStats, ticks.length]
    );
    const latestTick = ticks[ticks.length - 1] ?? null;
    const recentDigits = useMemo(
        () => ticks.slice(-8).map(tick => getLastDigitFromQuote(tick.quote, symbol)),
        [ticks, symbol]
    );
    const pipSize = selectedMarket.pip ?? 2;

    // Unsubscribe cleanly, e.g. before switching symbol/sample size or unmounting.
    const unsubscribe = useCallback(() => {
        try {
            subscriptionRef.current?.unsubscribe?.();
        } catch {
            // best effort
        }
        subscriptionRef.current = null;
        setIsLive(false);
    }, []);

    const applyTick = useCallback((tick: TTickPoint) => {
        setTicks(previous => {
            const isDuplicate = previous.some(prev => prev.epoch === tick.epoch && prev.quote === tick.quote);
            if (isDuplicate) return previous;
            return [...previous, tick].slice(-activeSampleTicks);
        });
        setIsLive(true);
        setScannerError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSampleTicks]);

    const loadMarketData = useCallback(async () => {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        unsubscribe();

        const requestVersion = requestVersionRef.current + 1;
        requestVersionRef.current = requestVersion;

        if (!api_base.api) {
            setScannerError('Connecting to Deriv market data...');
            retryTimerRef.current = setTimeout(() => void loadMarketData(), 1000);
            return;
        }

        setScannerError(null);

        try {
            const response = await (api_base.api as any).send({
                ticks_history: symbol,
                adjust_start_time: 1,
                end: 'latest',
                count: activeSampleTicks,
                start: 1,
                style: 'ticks',
            });
            if (requestVersionRef.current !== requestVersion) return;

            const prices = Array.isArray(response?.history?.prices) ? response.history.prices : [];
            const times = Array.isArray(response?.history?.times) ? response.history.times : [];
            const historyTicks: TTickPoint[] = prices
                .map((price: unknown, index: number) => ({
                    epoch: Number(times[index]) || Math.floor(Date.now() / 1000),
                    quote: Number(price),
                }))
                .filter((tick: TTickPoint) => Number.isFinite(tick.quote))
                .slice(-activeSampleTicks);

            setTicks(historyTicks);

            const tickObservable = (api_base.api as any).subscribe({ ticks: symbol });
            subscriptionRef.current = safeSubscribe(
                tickObservable,
                (data: any) => {
                    if (requestVersionRef.current !== requestVersion) return;
                    if (data?.error) {
                        if (!isExpectedStreamInterruption(data.error)) {
                            setScannerError(data.error.message || 'Deriv tick stream error.');
                        }
                        return;
                    }
                    const tick = getQuoteFromTick(data);
                    if (tick) applyTick(tick);
                },
                () => {
                    if (requestVersionRef.current !== requestVersion) return;
                    retryTimerRef.current = setTimeout(() => void loadMarketData(), 1500);
                }
            );
            setIsLive(true);
        } catch (loadError) {
            if (requestVersionRef.current !== requestVersion) return;
            setScannerError(loadError instanceof Error ? loadError.message : 'Unable to load Deriv market data.');
            retryTimerRef.current = setTimeout(() => void loadMarketData(), 1500);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSampleTicks, applyTick, symbol, unsubscribe]);

    useEffect(() => {
        void loadMarketData();
        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            unsubscribe();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, activeSampleTicks]);

    useEffect(() => {
        bulkCountRef.current = clampCount(Number(bulkCountInput), 1, 20);
    }, [bulkCountInput]);

    useEffect(
        () => () => {
            autoTraderActiveRef.current = false;
        },
        []
    );

    const handleApplySampleTicks = () => {
        setSampleTicksInput(String(clampSampleTicks(Number(sampleTicksInput))));
    };

    // Live implied frequency of each side, read straight off the current sample —
    // not a fixed number, so it moves as the scanner's digit stats move.
    const oddsBySide = useMemo(() => {
        if (tradeGroup === 'even_odd') {
            const even = digitStats
                .filter(stat => stat.digit % 2 === 0)
                .reduce((sum, stat) => sum + stat.percent, 0);
            return { DIGITEVEN: even, DIGITODD: Math.max(0, 100 - even) };
        }
        if (tradeGroup === 'over_under') {
            const barrierDigit = Number(barrier);
            const over = digitStats.filter(stat => stat.digit > barrierDigit).reduce((sum, s) => sum + s.percent, 0);
            const under = digitStats.filter(stat => stat.digit < barrierDigit).reduce((sum, s) => sum + s.percent, 0);
            return { DIGITOVER: over, DIGITUNDER: under };
        }
        const barrierDigit = Number(barrier);
        const match = digitStats.find(stat => stat.digit === barrierDigit)?.percent ?? 0;
        return { DIGITMATCH: match, DIGITDIFF: Math.max(0, 100 - match) };
    }, [tradeGroup, barrier, digitStats]);

    const buildTrade = (contractType: TTradeVariant['contractType']): TBulkTradeParameters => ({
        symbol,
        contract_type: contractType,
        duration: clampCount(Number(durationInput), 1, 10),
        duration_unit: 't',
        stake: Number(stakeInput) || 0.5,
        barrier: NEEDS_BARRIER.has(tradeGroup) ? barrier : undefined,
    });

    const fireBulkBatch = async (contractType: TTradeVariant['contractType']) => {
        const count = clampCount(Number(bulkCountInput), 1, 20);
        const trades = Array.from({ length: count }, (_, index) => ({
            ...buildTrade(contractType),
            id: `${contractType}-${Date.now()}-${index}`,
        }));

        const results = await runBulkTradesOnActiveAccount(trades, {
            onBuy: (_id, snapshot) => pushContract(snapshot),
            onSettled: (_id, snapshot) => pushContract(snapshot),
        });

        const values = Object.values(results);
        setLastRunSummary({
            ok: values.filter(result => result.ok).length,
            won: values.filter(result => result.won).length,
            lost: values.filter(result => result.ok && result.won === false).length,
        });
    };

    const handleTradeClick = async (variant: TTradeVariant) => {
        if (isRunning) return;

        if (!isAutoTraderArmed) {
            setIsRunning(true);
            setRunningSide(variant.contractType);
            try {
                await fireBulkBatch(variant.contractType);
            } finally {
                setIsRunning(false);
                setRunningSide(null);
            }
            return;
        }

        autoTraderActiveRef.current = true;
        setIsRunning(true);
        setRunningSide(variant.contractType);
        try {
            while (autoTraderActiveRef.current) {
                await fireBulkBatch(variant.contractType);
                if (!autoTraderActiveRef.current) break;
            }
        } finally {
            setIsRunning(false);
            setRunningSide(null);
        }
    };

    const handleStopAutoTrader = () => {
        autoTraderActiveRef.current = false;
    };

    const handleToggleAutoTraderArmed = () => {
        if (isRunning) {
            handleStopAutoTrader();
            return;
        }
        setIsAutoTraderArmed(previous => !previous);
    };

    // ---------------------------------------------------------------------
    // Accounts mode: unchanged — same trade fired across several linked
    // accounts at once, each on its own login.
    // ---------------------------------------------------------------------
    const linked_accounts = useMemo<TLinkedAccount[]>(() => getLinkedAccounts(), []);
    const [selectedLoginids, setSelectedLoginids] = useState<string[]>(() =>
        linked_accounts.map(account => account.loginid)
    );
    const all_selected = linked_accounts.length > 0 && selectedLoginids.length === linked_accounts.length;
    const [accountsTrade, setAccountsTrade] = useState<TBulkTradeParameters>({
        symbol,
        contract_type: 'DIGITEVEN',
        duration: 1,
        duration_unit: 't',
        stake: 0.5,
    });
    const [accountsResults, setAccountsResults] = useState<TBulkTradeResult[] | null>(null);
    const [isRunningAccounts, setIsRunningAccounts] = useState(false);

    const toggleAccount = (loginid: string) => {
        setSelectedLoginids(current =>
            current.includes(loginid) ? current.filter(id => id !== loginid) : [...current, loginid]
        );
    };
    const toggleAll = () => setSelectedLoginids(all_selected ? [] : linked_accounts.map(account => account.loginid));

    const handleRunAccounts = async () => {
        const accounts = linked_accounts.filter(account => selectedLoginids.includes(account.loginid));
        if (!accounts.length) return;
        setIsRunningAccounts(true);
        setAccountsResults(null);
        try {
            const results = await runBulkTradeAcrossAccounts(accounts, accountsTrade);
            setAccountsResults(results);
        } finally {
            setIsRunningAccounts(false);
        }
    };

    return (
        <div className='bulk-trading-page'>
            <div className='bulk-trading__mode-toggle'>
                <button
                    className={classNames('bulk-trading__mode-btn', { 'bulk-trading__mode-btn--active': mode === 'scanner' })}
                    onClick={() => setMode('scanner')}
                    type='button'
                >
                    Bulk Trader
                </button>
                <button
                    className={classNames('bulk-trading__mode-btn', { 'bulk-trading__mode-btn--active': mode === 'accounts' })}
                    onClick={() => setMode('accounts')}
                    type='button'
                >
                    Multiple accounts
                </button>
            </div>

            {mode === 'scanner' && (
                <section className='bt-scanner'>
                    <div className='bt-scanner__row'>
                        <label className='bt-scanner__field'>
                            <span>Market</span>
                            <select value={symbol} onChange={event => setSymbol(event.target.value)}>
                                {MARKETS.map(market => (
                                    <option key={market.symbol} value={market.symbol}>
                                        {market.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className='bt-scanner__field'>
                            <span>Trade type</span>
                            <select
                                value={tradeGroup}
                                onChange={event => setTradeGroup(event.target.value as TTradeGroup)}
                            >
                                {TRADE_GROUPS.map(group => (
                                    <option key={group.value} value={group.value}>
                                        {group.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {NEEDS_BARRIER.has(tradeGroup) && (
                        <label className='bt-scanner__field bt-scanner__field--barrier'>
                            <span>Barrier digit</span>
                            <div className='bt-scanner__barrier-row'>
                                {Array.from({ length: 10 }, (_, digit) => String(digit)).map(digit => (
                                    <button
                                        className={classNames('bt-scanner__barrier-digit', {
                                            'bt-scanner__barrier-digit--active': barrier === digit,
                                        })}
                                        key={digit}
                                        type='button'
                                        onClick={() => setBarrier(digit)}
                                    >
                                        {digit}
                                    </button>
                                ))}
                            </div>
                        </label>
                    )}

                    <label className='bt-scanner__field'>
                        <span>Number of ticks</span>
                        <input
                            className='bt-scanner__sample-input'
                            inputMode='numeric'
                            value={sampleTicksInput}
                            onBlur={handleApplySampleTicks}
                            onChange={event => setSampleTicksInput(event.target.value.replace(/[^0-9]/g, ''))}
                        />
                    </label>

                    <div className='bt-scanner__current-tick'>
                        <span className='bt-scanner__current-tick-label'>
                            Current tick {isLive && <span className='bt-scanner__live-dot' />}
                        </span>
                        <span className='bt-scanner__current-tick-value'>
                            {latestTick ? latestTick.quote.toFixed(pipSize) : '—'}
                        </span>
                    </div>

                    {scannerError && <p className='bt-scanner__error'>{scannerError}</p>}

                    <button
                        className={classNames('bt-scanner__toggle', { 'bt-scanner__toggle--open': isScannerOpen })}
                        onClick={() => setIsScannerOpen(open => !open)}
                        type='button'
                    >
                        <span className='bt-scanner__toggle-icon'>
                            <AiScannerIcon />
                        </span>
                        AI SCANNER
                        <span className='bt-scanner__toggle-caret' />
                    </button>

                    {isScannerOpen && (
                        <>
                            <div className='bt-digits'>
                                {digitStats.map(stat => {
                                    const ringColor = specialDigitColorMap[stat.digit];
                                    return (
                                        <div className='bt-digit' key={stat.digit}>
                                            <div
                                                className={classNames('bt-digit__circle', {
                                                    'bt-digit__circle--special': Boolean(ringColor),
                                                })}
                                                style={{ '--ring-color': ringColor ?? RING_COLORS.neutral } as CSSProperties}
                                            >
                                                <span className='bt-digit__number'>{stat.digit}</span>
                                                <span className='bt-digit__percent'>{stat.percent.toFixed(2)}%</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className='bt-eo-strip'>
                                {recentDigits.map((digit, index) => {
                                    const isEven = digit % 2 === 0;
                                    const isCurrent = index === recentDigits.length - 1;
                                    return (
                                        <div className='bt-eo-strip__item' key={`${digit}-${index}`}>
                                            <span
                                                className={classNames('bt-eo-strip__chip', {
                                                    'bt-eo-strip__chip--even': isEven,
                                                    'bt-eo-strip__chip--odd': !isEven,
                                                })}
                                            >
                                                {isEven ? 'E' : 'O'}
                                            </span>
                                            {isCurrent && <span className='bt-eo-strip__arrow' />}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    <div className='bt-scanner__row bt-scanner__row--three'>
                        <label className='bt-scanner__field'>
                            <span>Ticks</span>
                            <input
                                inputMode='numeric'
                                value={durationInput}
                                onChange={event => setDurationInput(event.target.value.replace(/[^0-9]/g, ''))}
                            />
                        </label>
                        <label className='bt-scanner__field'>
                            <span>Stake</span>
                            <input
                                inputMode='decimal'
                                value={stakeInput}
                                onChange={event => setStakeInput(event.target.value.replace(/[^0-9.]/g, ''))}
                            />
                        </label>
                        <label className='bt-scanner__field'>
                            <span>No. of bulk trades</span>
                            <input
                                inputMode='numeric'
                                value={bulkCountInput}
                                onChange={event => setBulkCountInput(event.target.value.replace(/[^0-9]/g, ''))}
                            />
                        </label>
                    </div>

                    <button
                        className={classNames('bt-autotrader', { 'bt-autotrader--armed': isAutoTraderArmed })}
                        onClick={handleToggleAutoTraderArmed}
                        type='button'
                    >
                        <span className='bt-autotrader__gear' />
                        {isRunning ? 'Stop auto trader' : isAutoTraderArmed ? 'Auto trader armed · tap a side to start' : 'Auto trader'}
                    </button>

                    <div className='bt-buy-buttons'>
                        {TRADE_VARIANTS[tradeGroup].map(variant => {
                            const profitPercent = getProfitPercent(variant.contractType, barrier);
                            const stake = Number(stakeInput) || 0;
                            const payout = profitPercent !== null ? stake * (1 + profitPercent / 100) : NaN;
                            const percentChance = oddsBySide[variant.contractType as keyof typeof oddsBySide] ?? 0;
                            const isBusy = isRunning && runningSide === variant.contractType;

                            return (
                                <button
                                    className={`bt-buy-buttons__btn bt-buy-buttons__btn--${variant.tone}`}
                                    disabled={isRunning && !isBusy}
                                    key={variant.contractType}
                                    type='button'
                                    onClick={() => void handleTradeClick(variant)}
                                >
                                    <span className='bt-buy-buttons__label'>{variant.label}</span>
                                    <span className='bt-buy-buttons__payout'>
                                        {isBusy ? 'Running…' : formatMoney(payout, currency)}
                                    </span>
                                    <span className='bt-buy-buttons__percent'>{percentChance.toFixed(2)}%</span>
                                </button>
                            );
                        })}
                    </div>

                    <button
                        className='bt-warning'
                        onClick={() => setIsWarningOpen(open => !open)}
                        type='button'
                    >
                        <WarningIcon />
                    </button>
                    {isWarningOpen && (
                        <p className='bt-warning__text'>
                            Trading involves risk of loss and may not be suitable for everyone. The digit scanner
                            reflects recent tick history only — it is not a prediction and past ticks do not
                            determine future ones. Past performance does not guarantee future results.
                        </p>
                    )}

                    {lastRunSummary && !isRunning && (
                        <p className='bt-scanner__summary'>
                            Last run: {lastRunSummary.ok} placed · {lastRunSummary.won} won · {lastRunSummary.lost} lost
                        </p>
                    )}

                    <div className='bt-status-bar'>
                        <span className={classNames('bt-status-bar__dot', { 'bt-status-bar__dot--live': isRunning })} />
                        {isRunning ? `Bot is running${runningSide ? ` · ${runningSide}` : ''}` : 'Bot is not running'}
                    </div>
                </section>
            )}

            {mode === 'accounts' && (
                <section className='bulk-trading__panel'>
                    <p className='bulk-trading__hint'>
                        Runs the same trade on each account you select below, at the same time, each with its own
                        login. Only accounts currently linked to this browser session are listed.
                    </p>

                    {!linked_accounts.length ? (
                        <p className='bulk-trading__empty'>
                            No linked accounts found. Log in with an account that has multiple accounts linked to use
                            this mode.
                        </p>
                    ) : (
                        <>
                            <div className='bulk-trading__account-list-header'>
                                <span>
                                    {linked_accounts.length} account{linked_accounts.length === 1 ? '' : 's'} available
                                </span>
                                <button className='bulk-trading__select-all-btn' onClick={toggleAll} type='button'>
                                    {all_selected ? 'Deselect all' : 'Select all'}
                                </button>
                            </div>
                            <div className='bulk-trading__account-list'>
                                {linked_accounts.map(account => {
                                    const checked = selectedLoginids.includes(account.loginid);
                                    return (
                                        <label
                                            key={account.loginid}
                                            className={classNames('bulk-trading__account', {
                                                'bulk-trading__account--checked': checked,
                                            })}
                                        >
                                            <input checked={checked} onChange={() => toggleAccount(account.loginid)} type='checkbox' />
                                            <span className='bulk-trading__account-avatar'>{initials(account.loginid)}</span>
                                            <span className='bulk-trading__account-info'>
                                                <span className='bulk-trading__account-loginid'>{account.loginid}</span>
                                                <span className='bulk-trading__account-meta'>
                                                    {account.currency ?? ''}
                                                    {account.loginid === client?.loginid ? ' · Current' : ''}
                                                </span>
                                            </span>
                                            {account.is_virtual && (
                                                <span className='bulk-trading__badge bulk-trading__badge--demo'>Demo</span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    <div className='bulk-trading__fields'>
                        <label className='bulk-trading__field'>
                            <span>Market</span>
                            <select
                                value={accountsTrade.symbol}
                                onChange={event => setAccountsTrade({ ...accountsTrade, symbol: event.target.value })}
                            >
                                {MARKETS.map(market => (
                                    <option key={market.symbol} value={market.symbol}>
                                        {market.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className='bulk-trading__field'>
                            <span>Trade type</span>
                            <select
                                value={accountsTrade.contract_type}
                                onChange={event =>
                                    setAccountsTrade({ ...accountsTrade, contract_type: event.target.value })
                                }
                            >
                                <option value='DIGITEVEN'>Even</option>
                                <option value='DIGITODD'>Odd</option>
                                <option value='DIGITOVER'>Digit Over</option>
                                <option value='DIGITUNDER'>Digit Under</option>
                                <option value='CALL'>Rise</option>
                                <option value='PUT'>Fall</option>
                            </select>
                        </label>
                        <label className='bulk-trading__field'>
                            <span>Duration (ticks)</span>
                            <input
                                inputMode='numeric'
                                min={1}
                                value={accountsTrade.duration}
                                onChange={event =>
                                    setAccountsTrade({ ...accountsTrade, duration: Number(event.target.value) || 1 })
                                }
                            />
                        </label>
                        <label className='bulk-trading__field'>
                            <span>Stake</span>
                            <input
                                inputMode='decimal'
                                min={0.35}
                                step={0.01}
                                value={accountsTrade.stake}
                                onChange={event =>
                                    setAccountsTrade({ ...accountsTrade, stake: Number(event.target.value) || 0 })
                                }
                            />
                        </label>
                    </div>

                    <button
                        className='bulk-trading__run-btn'
                        disabled={isRunningAccounts || !selectedLoginids.length}
                        onClick={handleRunAccounts}
                        type='button'
                    >
                        {isRunningAccounts ? (
                            <span className='bulk-trading__spinner' />
                        ) : (
                            `Place on ${selectedLoginids.length} account${selectedLoginids.length === 1 ? '' : 's'}`
                        )}
                    </button>

                    {accountsResults && (
                        <ul className='bulk-trading__results'>
                            {accountsResults.map(result => (
                                <li
                                    key={result.loginid}
                                    className={classNames('bulk-trading__result', {
                                        'bulk-trading__result--ok': result.won || (result.ok && result.won === undefined),
                                        'bulk-trading__result--error': !result.ok || result.won === false,
                                    })}
                                >
                                    <span className='bulk-trading__result-icon'>
                                        {result.ok ? (result.won ? '✓' : result.is_sold ? '✕' : '…') : '✕'}
                                    </span>
                                    <strong>{result.loginid}</strong>
                                    <span>{result.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
        </div>
    );
});

export default BulkTrading;
