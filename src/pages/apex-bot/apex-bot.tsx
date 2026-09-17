import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import EntryScannerModal, { type TEntryScannerResult } from '@/components/entry-scanner-modal';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { apexBotBridge, APEX_BOT_AUTO_START_FLAG, APEX_BOT_OPEN_SCANNER_FLAG } from '@/stores/apex-bot-bridge';
import { findBestSignalAcrossAllCategories, formatPl, type TApexTradeLogEntry } from './apex-bot-engine';
import {
    contractTypeNeedsBarrier,
    evaluateRunStopCondition,
    getNextMartingaleStake,
    type TAiHubSignal,
} from '../ai-hub/ai-hub-engine';
import {
    emptyMarketScan,
    evaluateMarketScan,
    startMarketFeeds,
    SUPPORTED_VOLATILITY_MARKETS,
    type TMarketScan,
} from '../market-hacker/market-scan-engine';
import './apex-bot.scss';

const MARKET_LABELS: Record<string, string> = Object.fromEntries(
    SUPPORTED_VOLATILITY_MARKETS.map(market => [market.symbol, market.label])
);
const MARKET_PIPS: Record<string, number> = Object.fromEntries(
    SUPPORTED_VOLATILITY_MARKETS.map(market => [market.symbol, market.pip ?? 2])
);

const DEFAULT_DURATION_TICKS = 5;
const SIGNAL_POLL_MS = 1500;
const NO_MARKET_TIMEOUT_MS = 15000;

const buildTradeParameters = (signal: TAiHubSignal, ticks: number, stake: number, currency: string) => {
    const parameters: Record<string, number | string> = {
        amount: stake,
        basis: 'stake',
        contract_type: signal.contractType,
        currency,
        duration: ticks,
        duration_unit: 't',
        symbol: signal.symbol,
    };
    if (contractTypeNeedsBarrier(signal.contractType) && signal.barrier !== undefined) {
        parameters.barrier = signal.barrier;
    }
    return parameters;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ApexBot = observer(() => {
    const { client, dashboard, run_panel, summary_card, transactions } = useStore();
    const { active_tab } = dashboard;
    const is_active = active_tab === DBOT_TABS.APEX_BOT;
    const currency = client.currency || 'USD';

    const [stakeInput, setStakeInput] = useState('1');
    const [takeProfitInput, setTakeProfitInput] = useState('10');
    const [stopLossInput, setStopLossInput] = useState('30');
    const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(true);
    const [multiplierInput, setMultiplierInput] = useState('2');

    const [isRunning, setIsRunning] = useState(false);
    const [scanningStatus, setScanningStatus] = useState<string | null>(null);
    const [totals, setTotals] = useState({ totalProfit: 0, won: 0, lost: 0 });
    const [lastError, setLastError] = useState<string | null>(null);
    const [tradeHistory, setTradeHistory] = useState<TApexTradeLogEntry[]>([]);
    const [marketFilter, setMarketFilter] = useState('');
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [pinnedSignal, setPinnedSignal] = useState<TEntryScannerResult | null>(null);
    const pinnedSignalRef = useRef<TEntryScannerResult | null>(null);

    useEffect(() => {
        pinnedSignalRef.current = pinnedSignal;
    }, [pinnedSignal]);

    const [scans, setScans] = useState<Record<string, TMarketScan>>(() =>
        Object.fromEntries(
            SUPPORTED_VOLATILITY_MARKETS.map(market => [market.symbol, emptyMarketScan(market.symbol, market.label)])
        )
    );
    const [lastTickAt, setLastTickAt] = useState<number | null>(null);

    const scansRef = useRef(scans);
    const digitsRef = useRef<Record<string, number[]>>({});
    const quotesRef = useRef<Record<string, number[]>>({});
    const stopRequestedRef = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        scansRef.current = scans;
    }, [scans]);

    useEffect(() => {
        if (!is_active) return undefined;

        const stopFeeds = startMarketFeeds({
            onError: (symbol, message) => {
                setScans(current => ({ ...current, [symbol]: { ...current[symbol], error: message, isLoading: false } }));
            },
            onUpdate: (symbol, newDigits, newQuotes, price) => {
                try {
                    const label = MARKET_LABELS[symbol] ?? symbol;
                    const digits = [...(digitsRef.current[symbol] ?? []), ...newDigits].slice(-500);
                    const quotes = [...(quotesRef.current[symbol] ?? []), ...newQuotes].slice(-500);
                    digitsRef.current[symbol] = digits;
                    quotesRef.current[symbol] = quotes;

                    const scan = evaluateMarketScan(symbol, label, digits, quotes, price);
                    setScans(current => ({ ...current, [symbol]: scan }));
                    setLastTickAt(Date.now());
                } catch (error) {
                    setScans(current => ({
                        ...current,
                        [symbol]: {
                            ...current[symbol],
                            error: error instanceof Error ? error.message : 'Could not process this market.',
                            isLoading: false,
                        },
                    }));
                }
            },
        });

        return stopFeeds;
    }, [is_active]);

    useEffect(() => {
        if (!is_active) {
            stopRequestedRef.current = true;
            abortControllerRef.current?.abort();
        }
    }, [is_active]);

    useEffect(
        () => () => {
            stopRequestedRef.current = true;
            abortControllerRef.current?.abort();
        },
        []
    );

    const pushContract = useCallback(
        (data: Record<string, unknown>) => {
            try {
                transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(data);
                summary_card.onBotContractEvent(data);
            } catch {
                // Apex Bot should not fail because a side panel observer is unavailable.
            }
        },
        [run_panel, summary_card, transactions]
    );

    const appendHistory = useCallback((text: string, tone: TApexTradeLogEntry['tone'] = 'info') => {
        setTradeHistory(current =>
            [{ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text, timestamp: Date.now(), tone }, ...current].slice(
                0,
                100
            )
        );
    }, []);

    const handleStop = useCallback(() => {
        stopRequestedRef.current = true;
        abortControllerRef.current?.abort();
    }, []);

    const runBotRef = useRef<() => void>(() => {});

    const runBot = useCallback(async () => {
        const stake = Number(stakeInput);
        if (!Number.isFinite(stake) || stake <= 0) {
            setLastError('Enter a valid stake before starting.');
            return;
        }
        if (!api_base.api) {
            setLastError("Deriv connection isn't ready yet. Check your connection and try again.");
            return;
        }
        if (!client.is_logged_in) {
            setLastError('Please log in to your Deriv account before starting Apex Bot.');
            return;
        }

        const takeProfit = Math.max(0, Number(takeProfitInput) || 0);
        const stopLoss = Math.max(0, Number(stopLossInput) || 0);
        const martingaleMultiplier = isMartingaleEnabled ? Number(multiplierInput) || 1 : 1;

        setIsRunning(true);
        setLastError(null);
        setTotals({ totalProfit: 0, won: 0, lost: 0 });
        stopRequestedRef.current = false;

        let totalProfit = 0;
        let won = 0;
        let lost = 0;
        let consecutiveLosses = 0;
        let noMarketWaitMs = 0;

        try {
            while (!stopRequestedRef.current) {
                const pinned = pinnedSignalRef.current;
                const signal: TAiHubSignal | null = pinned
                    ? {
                          barrier: pinned.barrier,
                          contractType: pinned.contractType,
                          detail: pinned.statusLabel,
                          label: pinned.tradeTypeLabel,
                          marketLabel: pinned.marketLabel,
                          possibility: 100,
                          symbol: pinned.symbol,
                      }
                    : findBestSignalAcrossAllCategories(scansRef.current);

                if (!signal) {
                    const hasAnyLiveMarket = Object.values(scansRef.current).some(scan => scan.price !== null);
                    setScanningStatus(
                        hasAnyLiveMarket
                            ? 'Scanning every market for a qualifying signal…'
                            : 'Connecting to live market data…'
                    );
                    if (!hasAnyLiveMarket) {
                        noMarketWaitMs += SIGNAL_POLL_MS;
                        if (noMarketWaitMs >= NO_MARKET_TIMEOUT_MS) {
                            setLastError('No market subscriptions started. Check your connection and try again.');
                            break;
                        }
                    }
                    await sleep(SIGNAL_POLL_MS);
                    continue;
                }
                noMarketWaitMs = 0;
                setScanningStatus(null);

                const effectiveStake = getNextMartingaleStake(stake, martingaleMultiplier, consecutiveLosses);
                appendHistory(
                    `Buying ${signal.label} on ${signal.marketLabel} at ${effectiveStake.toFixed(2)} ${currency}…`
                );

                const parameters = buildTradeParameters(signal, DEFAULT_DURATION_TICKS, effectiveStake, currency);
                const tradeStartTime = Math.floor(Date.now() / 1000);
                const buy = await buyContractForUi({ parameters, price: effectiveStake, source: 'ApexBot' });

                const fallbackContract = {
                    buy_price: buy.buy_price,
                    contract_id: buy.contract_id,
                    contract_type: signal.contractType,
                    currency,
                    date_start: tradeStartTime,
                    display_name: signal.marketLabel,
                    shortcode: `APEXBOT_${signal.contractType}_${signal.symbol}_${Date.now()}`,
                    transaction_ids: { buy: buy.transaction_id },
                    underlying_symbol: signal.symbol,
                };
                pushContract(fallbackContract);

                const controller = new AbortController();
                abortControllerRef.current = controller;

                const settled = await streamContractUntilSettled({
                    contractId: buy.contract_id,
                    fallback: fallbackContract,
                    onUpdate: snapshot => pushContract(snapshot),
                    signal: controller.signal,
                    source: 'ApexBot',
                });

                abortControllerRef.current = null;

                if (!settled.is_sold) {
                    appendHistory(
                        `Stopped — ${signal.marketLabel} trade is still open and will settle on its own. Check Transactions for the result.`
                    );
                    break;
                }

                const profit = Number(settled?.profit ?? 0);
                totalProfit = Number((totalProfit + profit).toFixed(8));
                consecutiveLosses = profit < 0 ? consecutiveLosses + 1 : 0;
                if (profit >= 0) won += 1;
                else lost += 1;

                setTotals({ totalProfit, won, lost });
                appendHistory(
                    `${signal.marketLabel} · ${signal.label}: ${profit >= 0 ? 'Won' : 'Lost'} ${formatPl(profit, currency)}`,
                    profit >= 0 ? 'win' : 'loss'
                );

                if (stopRequestedRef.current) break;

                const stopReason = evaluateRunStopCondition(totalProfit, { stopLoss, takeProfit });
                if (stopReason) {
                    appendHistory(
                        stopReason === 'take_profit' ? 'Take profit hit — stopping.' : 'Stop loss hit — stopping.'
                    );
                    break;
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Trade failed.';
            setLastError(message);
            appendHistory(`Error: ${message} — stopping.`, 'loss');
        } finally {
            setIsRunning(false);
            setScanningStatus(null);
        }
    }, [
        stakeInput,
        takeProfitInput,
        stopLossInput,
        isMartingaleEnabled,
        multiplierInput,
        currency,
        appendHistory,
        pushContract,
        client.is_logged_in,
    ]);

    useEffect(() => {
        runBotRef.current = () => void runBot();
    }, [runBot]);

    // Let the floating AI button (mounted as a sibling, not a child) drive
    // this bot without needing a prop path down to it.
    useEffect(() => {
        apexBotBridge.registerControls({
            start: () => runBotRef.current(),
            stop: () => handleStop(),
        });
        return () => apexBotBridge.unregisterControls();
    }, [handleStop]);

    useEffect(() => {
        apexBotBridge.setRunning(isRunning);
    }, [isRunning]);

    useEffect(() => {
        apexBotBridge.setPinnedSignal(pinnedSignal ? `${pinnedSignal.marketLabel} · ${pinnedSignal.tradeTypeLabel}` : null);
    }, [pinnedSignal]);

    // Consume one-shot requests the floating AI button left in session
    // storage right before switching us into view.
    useEffect(() => {
        if (!is_active) return;
        try {
            if (sessionStorage.getItem(APEX_BOT_OPEN_SCANNER_FLAG) === '1') {
                sessionStorage.removeItem(APEX_BOT_OPEN_SCANNER_FLAG);
                setIsScannerOpen(true);
            }
            if (sessionStorage.getItem(APEX_BOT_AUTO_START_FLAG) === '1') {
                sessionStorage.removeItem(APEX_BOT_AUTO_START_FLAG);
                runBotRef.current();
            }
        } catch {
            // Ignore storage access failures (private browsing, etc.).
        }
    }, [is_active]);

    const handleToggleBot = () => {
        try {
            if (isRunning) {
                handleStop();
                return;
            }
            runBot().catch(error => {
                setIsRunning(false);
                setLastError(error instanceof Error ? error.message : 'Apex Bot failed to start.');
            });
        } catch (error) {
            // Belt-and-braces: guarantees a click can never fail completely
            // silently, regardless of what throws.
            setLastError(error instanceof Error ? error.message : 'Apex Bot failed to start.');
        }
    };

    const winRate = totals.won + totals.lost > 0 ? (totals.won / (totals.won + totals.lost)) * 100 : 0;

    const marketRows = useMemo(() => {
        const rows = SUPPORTED_VOLATILITY_MARKETS.map(market => {
            const scan = scans[market.symbol];
            const digits = digitsRef.current[market.symbol]?.slice(-3) ?? [];
            return {
                symbol: market.symbol,
                label: market.label,
                price: scan?.price ?? null,
                pip: MARKET_PIPS[market.symbol] ?? 2,
                digits,
                isLive: !scan?.isLoading && !scan?.error && scan?.price !== null,
                error: scan?.error ?? null,
            };
        });

        if (!marketFilter.trim()) return rows;
        const needle = marketFilter.trim().toLowerCase();
        return rows.filter(row => row.label.toLowerCase().includes(needle) || row.symbol.toLowerCase().includes(needle));
    }, [scans, marketFilter]);

    const liveCount = marketRows.filter(row => row.isLive).length;
    const subscribedCount = Object.values(scans).filter(scan => !scan.isLoading).length;

    if (!is_active) return null;

    return (
        <div className='apex-bot-page'>
            <div className='apex-bot__stats-grid'>
                <div className='apex-bot__stat apex-bot__stat--pl'>
                    <span className='apex-bot__stat-label'>Total P/L</span>
                    <span
                        className={classNames('apex-bot__stat-value', {
                            'apex-bot__stat-value--positive': totals.totalProfit > 0,
                            'apex-bot__stat-value--negative': totals.totalProfit < 0,
                        })}
                    >
                        {formatPl(totals.totalProfit, currency)}
                    </span>
                </div>
                <div className='apex-bot__stat apex-bot__stat--won'>
                    <span className='apex-bot__stat-label'>Won</span>
                    <span className='apex-bot__stat-value apex-bot__stat-value--positive'>{totals.won}</span>
                </div>
                <div className='apex-bot__stat apex-bot__stat--lost'>
                    <span className='apex-bot__stat-label'>Lost</span>
                    <span className='apex-bot__stat-value apex-bot__stat-value--negative'>{totals.lost}</span>
                </div>
                <div className='apex-bot__stat apex-bot__stat--rate'>
                    <span className='apex-bot__stat-label'>Win Rate</span>
                    <span className='apex-bot__stat-value apex-bot__stat-value--positive'>{winRate.toFixed(0)}%</span>
                </div>
            </div>

            <button
                className={classNames('apex-bot__start-btn', { 'apex-bot__start-btn--running': isRunning })}
                onClick={handleToggleBot}
                type='button'
            >
                {isRunning ? 'STOP BOT' : 'START BOT'}
            </button>

            {!client.is_logged_in && (
                <p className='apex-bot__login-hint'>Log in to your Deriv account to let Apex Bot place trades.</p>
            )}

            {isRunning && scanningStatus && <p className='apex-bot__scanning-status'>{scanningStatus}</p>}

            <section className='apex-bot__card'>
                <div className='apex-bot__card-header'>
                    <h3>Risk Controls</h3>
                    <span className='apex-bot__card-header-badge'>{currency}</span>
                </div>

                <label className='apex-bot__field apex-bot__field--wide'>
                    <span>Stake</span>
                    <input
                        disabled={isRunning}
                        inputMode='decimal'
                        onChange={event => setStakeInput(event.target.value.replace(/[^0-9.]/g, ''))}
                        value={stakeInput}
                    />
                </label>

                <div className='apex-bot__field-row'>
                    <label className='apex-bot__field'>
                        <span>Take Profit</span>
                        <input
                            disabled={isRunning}
                            inputMode='decimal'
                            onChange={event => setTakeProfitInput(event.target.value.replace(/[^0-9.]/g, ''))}
                            value={takeProfitInput}
                        />
                    </label>
                    <label className='apex-bot__field'>
                        <span>Stop Loss</span>
                        <input
                            disabled={isRunning}
                            inputMode='decimal'
                            onChange={event => setStopLossInput(event.target.value.replace(/[^0-9.]/g, ''))}
                            value={stopLossInput}
                        />
                    </label>
                </div>

                <div className='apex-bot__field-row'>
                    <label className='apex-bot__field apex-bot__field--toggle'>
                        <span>Martingale</span>
                        <button
                            aria-pressed={isMartingaleEnabled}
                            className={classNames('apex-bot__toggle', { 'apex-bot__toggle--on': isMartingaleEnabled })}
                            disabled={isRunning}
                            onClick={() => setIsMartingaleEnabled(current => !current)}
                            type='button'
                        >
                            <span className='apex-bot__toggle-knob' />
                        </button>
                    </label>
                    <label className='apex-bot__field'>
                        <span>Multiplier</span>
                        <input
                            disabled={isRunning || !isMartingaleEnabled}
                            inputMode='decimal'
                            onChange={event => setMultiplierInput(event.target.value.replace(/[^0-9.]/g, ''))}
                            value={multiplierInput}
                        />
                    </label>
                </div>

                <button
                    className='apex-bot__scanner-btn'
                    disabled={isRunning}
                    onClick={() => setIsScannerOpen(true)}
                    type='button'
                >
                    Entry Scanner
                </button>

                {pinnedSignal && (
                    <div className='apex-bot__pinned'>
                        <span>
                            Pinned: <strong>{pinnedSignal.marketLabel}</strong> · {pinnedSignal.tradeTypeLabel}
                        </span>
                        <button
                            className='apex-bot__pinned-clear'
                            disabled={isRunning}
                            onClick={() => setPinnedSignal(null)}
                            type='button'
                        >
                            Clear
                        </button>
                    </div>
                )}
            </section>

            {lastError && (
                <div className='apex-bot__error'>
                    <span className='apex-bot__error-icon'>!</span>
                    <div className='apex-bot__error-body'>
                        <strong>Last Error</strong>
                        <p>{lastError}</p>
                    </div>
                    <button className='apex-bot__error-close' onClick={() => setLastError(null)} type='button'>
                        ✕
                    </button>
                </div>
            )}

            <section className='apex-bot__card'>
                <h3>Trade History</h3>
                {tradeHistory.length === 0 ? (
                    <p className='apex-bot__empty'>Trades will appear here after the bot buys a contract.</p>
                ) : (
                    <ul className='apex-bot__history-list'>
                        {tradeHistory.map(entry => (
                            <li className={classNames('apex-bot__history-item', `apex-bot__history-item--${entry.tone}`)} key={entry.id}>
                                {entry.text}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className='apex-bot__card'>
                <h3>Active Markets ({liveCount}/{SUPPORTED_VOLATILITY_MARKETS.length})</h3>
                <div className='apex-bot__market-badges'>
                    <span className='apex-bot__badge'>
                        Subscribed {subscribedCount}/{SUPPORTED_VOLATILITY_MARKETS.length}
                    </span>
                    <span className='apex-bot__badge apex-bot__badge--live'>Live {liveCount}</span>
                    <span className='apex-bot__badge'>
                        Last tick {lastTickAt ? new Date(lastTickAt).toLocaleTimeString() : '—'}
                    </span>
                </div>

                <input
                    className='apex-bot__market-filter'
                    onChange={event => setMarketFilter(event.target.value)}
                    placeholder='Filter by market or symbol'
                    value={marketFilter}
                />

                <div className='apex-bot__market-table'>
                    <div className='apex-bot__market-table-head'>
                        <span>Market</span>
                        <span>Price</span>
                        <span>Digits</span>
                    </div>
                    {marketRows.map(row => (
                        <div className='apex-bot__market-row' key={row.symbol}>
                            <div className='apex-bot__market-name-cell'>
                                <strong>{row.label}</strong>
                                <span className={classNames('apex-bot__market-status', { 'apex-bot__market-status--live': row.isLive })}>
                                    <span className='apex-bot__market-status-dot' />
                                    {row.error ? 'Error' : row.isLive ? 'Live | Pending' : 'Connecting…'}
                                </span>
                            </div>
                            <span className='apex-bot__market-price'>{row.price !== null ? row.price.toFixed(row.pip) : '—'}</span>
                            <span className='apex-bot__market-digits'>{row.digits.length ? row.digits.join(',') : '—'}</span>
                        </div>
                    ))}
                </div>
            </section>

            <p className='apex-bot__disclaimer'>
                Apex Bot continuously re-scans every market and category and trades whichever signal currently
                qualifies — it is not a prediction, and past ticks don&apos;t determine future ones. Trading involves
                risk of loss.
            </p>

            <EntryScannerModal
                onClose={() => setIsScannerOpen(false)}
                onLoad={loadedSignal => {
                    setPinnedSignal(loadedSignal);
                    setIsScannerOpen(false);
                }}
                open={isScannerOpen}
            />
        </div>
    );
});

export default ApexBot;
