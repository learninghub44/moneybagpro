import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import {
    getCopyTradingList,
    getTraderStatistics,
    startCopyTrading,
    stopCopyTrading,
    type TCopier,
    type TFollowedTrader,
    type TTraderStatistics,
} from './copy-trade-executor';
import './copy-trading.scss';

const formatPercent = (value?: number) => (typeof value === 'number' ? `${value.toFixed(1)}%` : '—');

const formatDate = (epoch?: number) => (epoch ? new Date(epoch * 1000).toLocaleDateString() : '—');

const CopyTrading = observer(() => {
    const [trader_token, setTraderToken] = useState('');
    const [assets_input, setAssetsInput] = useState('');
    const [trade_types_input, setTradeTypesInput] = useState('');
    const [min_stake, setMinStake] = useState('');
    const [max_stake, setMaxStake] = useState('');
    const [is_starting, setIsStarting] = useState(false);
    const [start_result, setStartResult] = useState<{ ok: boolean; message: string } | null>(null);

    const [trader_id_lookup, setTraderIdLookup] = useState('');
    const [stats, setStats] = useState<TTraderStatistics | null>(null);
    const [is_looking_up, setIsLookingUp] = useState(false);
    const [lookup_error, setLookupError] = useState<string | null>(null);

    const [traders, setTraders] = useState<TFollowedTrader[]>([]);
    const [copiers, setCopiers] = useState<TCopier[]>([]);
    const [is_loading_list, setIsLoadingList] = useState(true);
    const [stopping_token, setStoppingToken] = useState<string | null>(null);

    const refreshList = async () => {
        setIsLoadingList(true);
        const list = await getCopyTradingList();
        setTraders(list?.traders ?? []);
        setCopiers(list?.copiers ?? []);
        setIsLoadingList(false);
    };

    useEffect(() => {
        refreshList();
    }, []);

    const handleLookup = async () => {
        if (!trader_id_lookup.trim()) return;
        setIsLookingUp(true);
        setLookupError(null);
        setStats(null);
        const result = await getTraderStatistics(trader_id_lookup.trim());
        if (!result) {
            setLookupError("Couldn't find performance stats for that trader ID.");
        } else {
            setStats(result);
        }
        setIsLookingUp(false);
    };

    const handleStart = async () => {
        setIsStarting(true);
        setStartResult(null);
        const result = await startCopyTrading({
            trader_token,
            assets: assets_input
                .split(',')
                .map(item => item.trim())
                .filter(Boolean),
            trade_types: trade_types_input
                .split(',')
                .map(item => item.trim().toUpperCase())
                .filter(Boolean),
            min_trade_stake: min_stake ? Number(min_stake) : undefined,
            max_trade_stake: max_stake ? Number(max_stake) : undefined,
        });
        setStartResult(result);
        setIsStarting(false);
        if (result.ok) {
            setTraderToken('');
            setAssetsInput('');
            setTradeTypesInput('');
            setMinStake('');
            setMaxStake('');
            refreshList();
        }
    };

    const handleStop = async (token: string) => {
        setStoppingToken(token);
        await stopCopyTrading(token);
        setStoppingToken(null);
        refreshList();
    };

    return (
        <div className='copy-trading-page'>
            <div className='copy-trading__hero'>
                <div>
                    <h2 className='copy-trading__title'>Copy Trading</h2>
                    <p className='copy-trading__subtitle'>
                        Mirror a trader&apos;s trades onto this account, or see who&apos;s copying you.
                    </p>
                </div>
                <div className='copy-trading__stats'>
                    <div className='copy-trading__stat'>
                        <span className='copy-trading__stat-value'>{traders.length}</span>
                        <span className='copy-trading__stat-label'>Following</span>
                    </div>
                    <div className='copy-trading__stat'>
                        <span className='copy-trading__stat-value'>{copiers.length}</span>
                        <span className='copy-trading__stat-label'>Your copiers</span>
                    </div>
                </div>
            </div>

            <section className='copy-trading__panel'>
                <h3 className='copy-trading__panel-title'>Look up a trader before you copy</h3>
                <p className='copy-trading__hint'>
                    Paste a trader&apos;s ID to check their track record — win rate, average trade size, and how many people
                    already copy them.
                </p>
                <div className='copy-trading__lookup-row'>
                    <input
                        className='copy-trading__lookup-input'
                        onChange={event => setTraderIdLookup(event.target.value)}
                        placeholder='Trader ID (e.g. CR123456)'
                        value={trader_id_lookup}
                    />
                    <button
                        className='copy-trading__lookup-btn'
                        disabled={is_looking_up || !trader_id_lookup.trim()}
                        onClick={handleLookup}
                        type='button'
                    >
                        {is_looking_up ? <span className='copy-trading__spinner' /> : 'Check stats'}
                    </button>
                </div>

                {lookup_error && <p className='copy-trading__lookup-error'>{lookup_error}</p>}

                {stats && (
                    <div className='copy-trading__stats-grid'>
                        <div className='copy-trading__stats-card'>
                            <span className='copy-trading__stats-card-value'>{formatPercent(stats.trades_profitable)}</span>
                            <span className='copy-trading__stats-card-label'>Win rate</span>
                        </div>
                        <div className='copy-trading__stats-card'>
                            <span className='copy-trading__stats-card-value'>{stats.total_trades ?? '—'}</span>
                            <span className='copy-trading__stats-card-label'>Total trades</span>
                        </div>
                        <div className='copy-trading__stats-card'>
                            <span className='copy-trading__stats-card-value'>{stats.copiers ?? '—'}</span>
                            <span className='copy-trading__stats-card-label'>Copiers</span>
                        </div>
                        <div className='copy-trading__stats-card'>
                            <span className='copy-trading__stats-card-value'>{formatDate(stats.active_since)}</span>
                            <span className='copy-trading__stats-card-label'>Trading since</span>
                        </div>
                    </div>
                )}
            </section>

            <section className='copy-trading__panel'>
                <h3 className='copy-trading__panel-title'>Start copying a trader</h3>
                <p className='copy-trading__hint'>
                    Paste the trader&apos;s shared copy-trading API token (not their password or login). Trades will be mirrored
                    onto your currently active account, scaled to your balance.
                </p>

                <div className='copy-trading__fields'>
                    <label className='copy-trading__field copy-trading__field--wide'>
                        <span>Trader&apos;s copy-trading token</span>
                        <input
                            onChange={event => setTraderToken(event.target.value)}
                            placeholder='Paste the token they shared with you'
                            value={trader_token}
                        />
                    </label>
                    <label className='copy-trading__field'>
                        <span>Assets to copy (optional)</span>
                        <input
                            onChange={event => setAssetsInput(event.target.value)}
                            placeholder='R_50, frxUSDJPY'
                            value={assets_input}
                        />
                    </label>
                    <label className='copy-trading__field'>
                        <span>Trade types to copy (optional)</span>
                        <input
                            onChange={event => setTradeTypesInput(event.target.value)}
                            placeholder='CALL, PUT'
                            value={trade_types_input}
                        />
                    </label>
                    <label className='copy-trading__field'>
                        <span>Min trade stake (optional)</span>
                        <input inputMode='decimal' onChange={event => setMinStake(event.target.value)} value={min_stake} />
                    </label>
                    <label className='copy-trading__field'>
                        <span>Max trade stake (optional)</span>
                        <input inputMode='decimal' onChange={event => setMaxStake(event.target.value)} value={max_stake} />
                    </label>
                </div>

                <button
                    className='copy-trading__run-btn'
                    disabled={is_starting || !trader_token.trim()}
                    onClick={handleStart}
                    type='button'
                >
                    {is_starting ? <span className='copy-trading__spinner' /> : 'Start copying'}
                </button>

                {start_result && (
                    <p
                        className={classNames('copy-trading__result', {
                            'copy-trading__result--ok': start_result.ok,
                            'copy-trading__result--error': !start_result.ok,
                        })}
                    >
                        {start_result.message}
                    </p>
                )}
            </section>

            <section className='copy-trading__panel'>
                <h3 className='copy-trading__panel-title'>Traders you&apos;re following</h3>

                {is_loading_list ? (
                    <p className='copy-trading__hint'>Loading…</p>
                ) : !traders.length ? (
                    <p className='copy-trading__empty'>You&apos;re not copying anyone yet.</p>
                ) : (
                    <div className='copy-trading__trader-list'>
                        {traders.map(trader => (
                            <div className='copy-trading__trader-card' key={trader.token ?? trader.loginid}>
                                <div className='copy-trading__trader-info'>
                                    <span className='copy-trading__trader-loginid'>{trader.loginid ?? 'Trader'}</span>
                                    <span className='copy-trading__trader-meta'>
                                        {trader.assets?.length ? `Assets: ${trader.assets.join(', ')}` : 'All assets'}
                                        {trader.trade_types?.length ? ` · Types: ${trader.trade_types.join(', ')}` : ''}
                                    </span>
                                </div>
                                <button
                                    className='copy-trading__stop-btn'
                                    disabled={stopping_token === trader.token}
                                    onClick={() => trader.token && handleStop(trader.token)}
                                    type='button'
                                >
                                    {stopping_token === trader.token ? <span className='copy-trading__spinner' /> : 'Stop copying'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {copiers.length > 0 && (
                <section className='copy-trading__panel'>
                    <h3 className='copy-trading__panel-title'>People copying you</h3>
                    <div className='copy-trading__copier-list'>
                        {copiers.map(copier => (
                            <span className='copy-trading__copier-chip' key={copier.loginid}>
                                {copier.loginid}
                            </span>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
});

export default CopyTrading;
