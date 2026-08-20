import { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    emptyMarketScan,
    evaluateMarketScan,
    startMarketFeeds,
    SUPPORTED_VOLATILITY_MARKETS,
    type TMarketScan,
} from './market-scan-engine';
import './market-hacker.scss';

type TSortMode = 'possibility' | 'name';

const MARKET_LABELS: Record<string, string> = Object.fromEntries(
    SUPPORTED_VOLATILITY_MARKETS.map(market => [market.symbol, market.label])
);

const momentumArrow = (momentum: TMarketScan['momentum']) => {
    if (momentum === 'RISE') return '↑';
    if (momentum === 'FALL') return '↓';
    return '→';
};

const MarketHacker = observer(() => {
    const { dashboard } = useStore();
    const { active_tab } = dashboard;
    const is_active = active_tab === DBOT_TABS.MARKET_HACKER;

    const [scans, setScans] = useState<Record<string, TMarketScan>>(() =>
        Object.fromEntries(
            SUPPORTED_VOLATILITY_MARKETS.map(market => [market.symbol, emptyMarketScan(market.symbol, market.label)])
        )
    );
    const [sort_mode, setSortMode] = useState<TSortMode>('possibility');
    const [is_paused, setIsPaused] = useState(false);
    const [retry_key, setRetryKey] = useState(0);
    const [is_stalled, setIsStalled] = useState(false);
    const digitsRef = useRef<Record<string, number[]>>({});
    const quotesRef = useRef<Record<string, number[]>>({});

    useEffect(() => {
        if (!is_active || is_paused) return undefined;
        setIsStalled(false);

        const stopFeeds = startMarketFeeds({
            onError: (symbol, message) => {
                setScans(current => ({
                    ...current,
                    [symbol]: { ...current[symbol], error: message, isLoading: false },
                }));
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
                    setIsStalled(false);
                } catch (error) {
                    // A bad tick or an edge case in the scoring logic should
                    // never take down the whole grid — surface it on just
                    // this market's card and keep the rest scanning.
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
    }, [is_active, is_paused, retry_key]);

    // If nothing has come back from any market after a generous window —
    // most likely the trading API connection itself hasn't been
    // established yet — surface that plainly instead of leaving every card
    // stuck on its loading spinner indefinitely with no explanation.
    useEffect(() => {
        if (!is_active || is_paused) return undefined;

        const timeout = setTimeout(() => {
            setScans(current => {
                const all_still_loading = Object.values(current).every(scan => scan.isLoading && !scan.error);
                setIsStalled(all_still_loading);
                return current;
            });
        }, 15000);

        return () => clearTimeout(timeout);
    }, [is_active, is_paused, retry_key]);

    const sorted_scans = useMemo(() => {
        const list = SUPPORTED_VOLATILITY_MARKETS.map(market => scans[market.symbol]).filter(Boolean);
        if (sort_mode === 'name') return [...list].sort((a, b) => a.label.localeCompare(b.label));
        return [...list].sort((a, b) => b.topSignal.possibility - a.topSignal.possibility);
    }, [scans, sort_mode]);

    const entry_ready_count = sorted_scans.filter(scan => scan.topSignal.entryReady).length;
    const scanning_count = sorted_scans.filter(scan => !scan.isLoading && !scan.error).length;

    if (!is_active) return null;

    return (
        <div className='market-hacker-page'>
            <div className='market-hacker__hero'>
                <div>
                    <h2 className='market-hacker__title'>Market Hacker</h2>
                    <p className='market-hacker__subtitle'>
                        Live-scans every volatility market for entry points, all at once.
                    </p>
                </div>
                <div className='market-hacker__stats'>
                    <div className='market-hacker__stat'>
                        <span className='market-hacker__stat-value'>{scanning_count}</span>
                        <span className='market-hacker__stat-label'>Markets scanned</span>
                    </div>
                    <div className='market-hacker__stat market-hacker__stat--highlight'>
                        <span className='market-hacker__stat-value'>{entry_ready_count}</span>
                        <span className='market-hacker__stat-label'>Entry ready now</span>
                    </div>
                </div>
            </div>

            <div className='market-hacker__controls'>
                <div className='market-hacker__sort'>
                    <button
                        className={classNames('market-hacker__sort-btn', {
                            'market-hacker__sort-btn--active': sort_mode === 'possibility',
                        })}
                        onClick={() => setSortMode('possibility')}
                        type='button'
                    >
                        Highest possibility
                    </button>
                    <button
                        className={classNames('market-hacker__sort-btn', {
                            'market-hacker__sort-btn--active': sort_mode === 'name',
                        })}
                        onClick={() => setSortMode('name')}
                        type='button'
                    >
                        Market name
                    </button>
                </div>
                <button
                    className={classNames('market-hacker__pause-btn', { 'market-hacker__pause-btn--paused': is_paused })}
                    onClick={() => setIsPaused(current => !current)}
                    type='button'
                >
                    {is_paused ? 'Resume scanning' : 'Pause scanning'}
                </button>
            </div>

            <p className='market-hacker__disclaimer'>
                Possibility scores are statistical bias in recent digit and price history, not a guarantee — markets are
                random and past ticks don&apos;t determine future ones. Use this to spot patterns, not as financial advice.
            </p>

            {is_stalled && (
                <div className='market-hacker__stalled'>
                    <span>
                        Markets haven&apos;t responded yet — this usually means the connection hasn&apos;t finished
                        starting up.
                    </span>
                    <button
                        className='market-hacker__stalled-btn'
                        onClick={() => {
                            setIsStalled(false);
                            setScans(
                                Object.fromEntries(
                                    SUPPORTED_VOLATILITY_MARKETS.map(market => [
                                        market.symbol,
                                        emptyMarketScan(market.symbol, market.label),
                                    ])
                                )
                            );
                            digitsRef.current = {};
                            quotesRef.current = {};
                            setRetryKey(current => current + 1);
                        }}
                        type='button'
                    >
                        Retry scan
                    </button>
                </div>
            )}

            <div className='market-hacker__grid'>
                {sorted_scans.map(scan => (
                    <div
                        className={classNames('market-hacker__card', {
                            'market-hacker__card--ready': scan.topSignal.entryReady,
                            'market-hacker__card--loading': scan.isLoading,
                            'market-hacker__card--error': !!scan.error,
                        })}
                        key={scan.symbol}
                    >
                        <div className='market-hacker__card-header'>
                            <span className='market-hacker__card-market'>{scan.label}</span>
                            <span className='market-hacker__card-price'>{scan.price?.toFixed(2) ?? '—'}</span>
                        </div>

                        {scan.error ? (
                            <p className='market-hacker__card-error'>{scan.error}</p>
                        ) : scan.isLoading ? (
                            <div className='market-hacker__card-skeleton'>
                                <span className='market-hacker__spinner' />
                                <span>Loading tick history…</span>
                            </div>
                        ) : (
                            <>
                                <div className='market-hacker__signal'>
                                    <div className='market-hacker__signal-ring'>
                                        <span className='market-hacker__signal-percent'>{scan.topSignal.possibility}%</span>
                                    </div>
                                    <div className='market-hacker__signal-info'>
                                        <span className='market-hacker__signal-label'>
                                            {scan.topSignal.label}
                                            {scan.topSignal.entryReady && (
                                                <span className='market-hacker__badge market-hacker__badge--ready'>
                                                    Entry ready
                                                </span>
                                            )}
                                        </span>
                                        <span className='market-hacker__signal-detail'>{scan.topSignal.detail}</span>
                                    </div>
                                </div>

                                <div className='market-hacker__breakdown'>
                                    <div className='market-hacker__breakdown-item'>
                                        <span>Momentum</span>
                                        <strong>
                                            {momentumArrow(scan.momentum)} {scan.momentum}
                                        </strong>
                                    </div>
                                    <div className='market-hacker__breakdown-item'>
                                        <span>Even / Odd</span>
                                        <strong>
                                            {scan.evenPercent.toFixed(0)}% / {scan.oddPercent.toFixed(0)}%
                                        </strong>
                                    </div>
                                    <div className='market-hacker__breakdown-item'>
                                        <span>Most frequent</span>
                                        <strong>
                                            {scan.mostFrequentDigit} ({scan.mostFrequentPercent.toFixed(0)}%)
                                        </strong>
                                    </div>
                                    <div className='market-hacker__breakdown-item'>
                                        <span>Least frequent</span>
                                        <strong>
                                            {scan.leastFrequentDigit} ({scan.leastFrequentPercent.toFixed(0)}%)
                                        </strong>
                                    </div>
                                </div>

                                <div className='market-hacker__strategies'>
                                    {scan.strategies.map(strategy => (
                                        <div
                                            className={classNames('market-hacker__strategy', {
                                                'market-hacker__strategy--ready': strategy.entryReady,
                                            })}
                                            key={strategy.id}
                                        >
                                            <span className='market-hacker__strategy-name'>{strategy.alertLabel}</span>
                                            <div className='market-hacker__strategy-bar'>
                                                <div
                                                    className='market-hacker__strategy-bar-fill'
                                                    style={{ width: `${strategy.possibility}%` }}
                                                />
                                            </div>
                                            <span className='market-hacker__strategy-percent'>{strategy.possibility}%</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
});

export default MarketHacker;
