import { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import {
    contractTypeNeedsBarrier,
    evaluateRunStopCondition,
    findBestAiHubSignal,
    getNextMartingaleStake,
    MIN_SIGNAL_POSSIBILITY,
    type TAiHubCategory,
    type TAiHubSignal,
} from './ai-hub-engine';
import {
    emptyMarketScan,
    evaluateMarketScan,
    startMarketFeeds,
    SUPPORTED_VOLATILITY_MARKETS,
    type TMarketScan,
} from '../market-hacker/market-scan-engine';
import './ai-hub.scss';

const MARKET_LABELS: Record<string, string> = Object.fromEntries(
    SUPPORTED_VOLATILITY_MARKETS.map(market => [market.symbol, market.label])
);

const CATEGORY_TABS: { label: string; value: TAiHubCategory }[] = [
    { label: 'Over/Under', value: 'over_under' },
    { label: 'Even/Odd', value: 'even_odd' },
    { label: 'Rise/Fall', value: 'rise_fall' },
    { label: 'Differs', value: 'matches_differs' },
];

type TRunLogEntry = { id: string; text: string; tone: 'info' | 'loss' | 'win' };

const clampTicks = (value: number) => {
    if (!Number.isFinite(value)) return 5;
    return Math.min(10, Math.max(1, Math.round(value)));
};

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

const AiHub = observer(() => {
    const { client, dashboard, run_panel, summary_card, transactions } = useStore();
    const { active_tab } = dashboard;
    const is_active = active_tab === DBOT_TABS.AI_HUB;
    const currency = client.currency || 'USD';

    const [category, setCategory] = useState<TAiHubCategory>('over_under');
    const [stakeInput, setStakeInput] = useState('10');
    const [ticksInput, setTicksInput] = useState('5');
    const [takeProfitInput, setTakeProfitInput] = useState('50');
    const [stopLossInput, setStopLossInput] = useState('20');
    const [martingaleInput, setMartingaleInput] = useState('2');

    const [scans, setScans] = useState<Record<string, TMarketScan>>(() =>
        Object.fromEntries(
            SUPPORTED_VOLATILITY_MARKETS.map(market => [market.symbol, emptyMarketScan(market.symbol, market.label)])
        )
    );
    const [signal, setSignal] = useState<TAiHubSignal | null>(null);
    const [scanMessage, setScanMessage] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [runLog, setRunLog] = useState<TRunLogEntry[]>([]);
    const [runSummary, setRunSummary] = useState('');

    const digitsRef = useRef<Record<string, number[]>>({});
    const quotesRef = useRef<Record<string, number[]>>({});
    const stopRequestedRef = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const logEndRef = useRef<HTMLDivElement | null>(null);

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
        logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [runLog]);

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

    const appendLog = useCallback((text: string, tone: TRunLogEntry['tone'] = 'info') => {
        setRunLog(current => [...current, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text, tone }]);
    }, []);

    const pushContract = useCallback(
        (data: Record<string, unknown>) => {
            try {
                transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(data);
                summary_card.onBotContractEvent(data);
            } catch {
                // The AI Hub run should not fail because a side panel observer is unavailable.
            }
        },
        [run_panel, summary_card, transactions]
    );

    const handleGetSignal = useCallback(() => {
        const best = findBestAiHubSignal(scans, category);
        setSignal(best);
        setRunSummary('');
        setScanMessage(
            best
                ? ''
                : `No qualifying ${CATEGORY_TABS.find(tab => tab.value === category)?.label} signal right now (need ${MIN_SIGNAL_POSSIBILITY}%+). Keep scanning or try another category.`
        );
    }, [scans, category]);

    const handleStop = useCallback(() => {
        stopRequestedRef.current = true;
        // Without this, Stop only took effect once the current trade's tick
        // duration finished settling — which could be several seconds away —
        // instead of ending the wait right away.
        abortControllerRef.current?.abort();
    }, []);

    const handleLoadAndRun = useCallback(async () => {
        if (!signal) return;

        const stake = Number(stakeInput);
        if (!Number.isFinite(stake) || stake <= 0) {
            setScanMessage('Enter a valid stake before running.');
            return;
        }

        if (!api_base.api) {
            setScanMessage("Deriv connection isn't ready yet.");
            return;
        }

        const ticks = clampTicks(Number(ticksInput));
        setTicksInput(String(ticks));
        const takeProfit = Math.max(0, Number(takeProfitInput) || 0);
        const stopLoss = Math.max(0, Number(stopLossInput) || 0);
        const martingaleMultiplier = Number(martingaleInput) || 1;

        setIsRunning(true);
        setRunLog([]);
        setRunSummary('');
        stopRequestedRef.current = false;

        appendLog(
            `Loaded: ${signal.label} on ${signal.marketLabel}, stake ${stake.toFixed(2)} ${currency}, ${ticks} ticks, TP ${takeProfit || '—'}, SL ${stopLoss || '—'}, Martingale ${martingaleMultiplier}x.`
        );

        let totalProfit = 0;
        let consecutiveLosses = 0;
        let runIndex = 0;

        try {
            while (!stopRequestedRef.current) {
                runIndex += 1;
                const effectiveStake = getNextMartingaleStake(stake, martingaleMultiplier, consecutiveLosses);

                appendLog(`Run ${runIndex}: buying at ${effectiveStake.toFixed(2)} ${currency}...`);

                const parameters = buildTradeParameters(signal, ticks, effectiveStake, currency);
                const tradeStartTime = Math.floor(Date.now() / 1000);
                const buy = await buyContractForUi({ parameters, price: effectiveStake, source: 'AiHub' });

                const fallbackContract = {
                    buy_price: buy.buy_price,
                    contract_id: buy.contract_id,
                    contract_type: signal.contractType,
                    currency,
                    date_start: tradeStartTime,
                    display_name: signal.marketLabel,
                    shortcode: `AIHUB_${signal.contractType}_${signal.symbol}_${runIndex}`,
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
                    source: 'AiHub',
                });

                abortControllerRef.current = null;

                if (!settled.is_sold) {
                    // Stopped mid-trade: the contract itself is still live and
                    // will settle on its own (check Transactions later for the
                    // result) — it just isn't counted in this run's total
                    // since we don't yet know if it won or lost.
                    appendLog(
                        `Run ${runIndex} stopped — trade is still open and will settle on its own. Check Transactions for the result.`
                    );
                    setRunSummary(
                        `Stopped manually after ${runIndex} run${runIndex === 1 ? '' : 's'} (last trade still settling). Total P/L: ${totalProfit.toFixed(2)} ${currency}.`
                    );
                    break;
                }

                const profit = Number(settled?.profit ?? 0);
                totalProfit = Number((totalProfit + profit).toFixed(8));
                consecutiveLosses = profit < 0 ? consecutiveLosses + 1 : 0;

                appendLog(
                    `Run ${runIndex} ${profit >= 0 ? 'won' : 'lost'} ${profit.toFixed(2)} ${currency}. Total: ${totalProfit.toFixed(2)} ${currency}.`,
                    profit >= 0 ? 'win' : 'loss'
                );

                if (stopRequestedRef.current) {
                    setRunSummary(
                        `Stopped manually after ${runIndex} run${runIndex === 1 ? '' : 's'}. Total P/L: ${totalProfit.toFixed(2)} ${currency}.`
                    );
                    break;
                }

                const stopReason = evaluateRunStopCondition(totalProfit, { stopLoss, takeProfit });
                if (stopReason) {
                    const reasonLabel = stopReason === 'take_profit' ? 'Take profit hit' : 'Stop loss hit';
                    appendLog(`${reasonLabel} — stopping.`);
                    setRunSummary(
                        `${reasonLabel} after ${runIndex} run${runIndex === 1 ? '' : 's'}. Total P/L: ${totalProfit.toFixed(2)} ${currency}.`
                    );
                    break;
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Trade failed.';
            appendLog(`Error: ${message} — stopping.`, 'loss');
            setRunSummary(
                `Stopped due to an error after ${runIndex} run${runIndex === 1 ? '' : 's'}. Total P/L: ${totalProfit.toFixed(2)} ${currency}.`
            );
        } finally {
            setIsRunning(false);
        }
    }, [signal, stakeInput, ticksInput, takeProfitInput, stopLossInput, martingaleInput, currency, appendLog, pushContract]);

    if (!is_active) return null;

    return (
        <div className='ai-hub-page'>
            <div className='ai-hub__card'>
                <h2 className='ai-hub__title'>AI Hub</h2>
                <p className='ai-hub__subtitle'>
                    Configure your risk settings, scan every volatility market for the strongest opportunity, then load and
                    run it — no need to jump back to Bot Builder.
                </p>

                <div className='ai-hub__category-tabs'>
                    {CATEGORY_TABS.map(tab => (
                        <button
                            className={classNames('ai-hub__category-tab', {
                                'ai-hub__category-tab--active': category === tab.value,
                            })}
                            key={tab.value}
                            onClick={() => {
                                setCategory(tab.value);
                                setSignal(null);
                                setScanMessage('');
                            }}
                            type='button'
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className='ai-hub__config-grid'>
                    <label>
                        <span>Stake ({currency})</span>
                        <input onChange={event => setStakeInput(event.target.value)} type='number' value={stakeInput} />
                    </label>
                    <label>
                        <span>Ticks</span>
                        <input onChange={event => setTicksInput(event.target.value)} type='number' value={ticksInput} />
                    </label>
                    <label>
                        <span>Take Profit ({currency})</span>
                        <input
                            onChange={event => setTakeProfitInput(event.target.value)}
                            type='number'
                            value={takeProfitInput}
                        />
                    </label>
                    <label>
                        <span>Stop Loss ({currency})</span>
                        <input onChange={event => setStopLossInput(event.target.value)} type='number' value={stopLossInput} />
                    </label>
                    <label>
                        <span>Martingale (×)</span>
                        <input
                            onChange={event => setMartingaleInput(event.target.value)}
                            step='0.1'
                            type='number'
                            value={martingaleInput}
                        />
                    </label>
                </div>

                <button className='ai-hub__scan-button' disabled={isRunning} onClick={handleGetSignal} type='button'>
                    Get AI Signal
                </button>

                {scanMessage && <p className='ai-hub__message'>{scanMessage}</p>}

                {signal && (
                    <div className='ai-hub__signal-card'>
                        <div className='ai-hub__signal-header'>
                            <span>Signal Found!</span>
                            <span className='ai-hub__signal-possibility'>{signal.possibility}%</span>
                        </div>
                        <div className='ai-hub__signal-row'>
                            <span>Market</span>
                            <strong>{signal.marketLabel}</strong>
                        </div>
                        <div className='ai-hub__signal-row'>
                            <span>Action</span>
                            <strong>{signal.label}</strong>
                        </div>
                        <p className='ai-hub__signal-detail'>{signal.detail}</p>

                        {!isRunning && (
                            <button className='ai-hub__run-button' onClick={handleLoadAndRun} type='button'>
                                Load &amp; Run Signal
                            </button>
                        )}
                        {isRunning && (
                            <button className='ai-hub__stop-button' onClick={handleStop} type='button'>
                                Stop
                            </button>
                        )}
                    </div>
                )}

                {runSummary && <p className='ai-hub__summary'>{runSummary}</p>}

                {runLog.length > 0 && (
                    <div className='ai-hub__log'>
                        {runLog.map(entry => (
                            <div className={classNames('ai-hub__log-row', `ai-hub__log-row--${entry.tone}`)} key={entry.id}>
                                {entry.text}
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                )}

                <p className='ai-hub__disclaimer'>
                    Possibility scores are statistical bias in recent digit and price history, not a guarantee — markets
                    are random and past ticks don&apos;t determine future ones.
                </p>
            </div>
        </div>
    );
});

export default AiHub;
