import { useMemo, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import {
    getLinkedAccounts,
    runBulkTradeAcrossAccounts,
    runBulkTradesOnActiveAccount,
    type TBulkTradeParameters,
    type TBulkTradeResult,
    type TLinkedAccount,
} from './bulk-trade-executor';
import './bulk-trading.scss';

const CONTRACT_TYPES = [
    { label: 'Rise', value: 'CALL' },
    { label: 'Fall', value: 'PUT' },
    { label: 'Digit Over', value: 'DIGITOVER' },
    { label: 'Digit Under', value: 'DIGITUNDER' },
    { label: 'Digit Even', value: 'DIGITEVEN' },
    { label: 'Digit Odd', value: 'DIGITODD' },
];

const DEFAULT_TRADE: TBulkTradeParameters = {
    symbol: SUPPORTED_VOLATILITY_MARKETS[0].symbol,
    contract_type: 'CALL',
    duration: 5,
    duration_unit: 't',
    stake: 1,
};

type TBatchTrade = TBulkTradeParameters & { id: string };

const newBatchTrade = (): TBatchTrade => ({
    ...DEFAULT_TRADE,
    id: `trade-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
});

const TradeFieldsEditor = ({
    trade,
    onChange,
}: {
    trade: TBulkTradeParameters;
    onChange: (next: TBulkTradeParameters) => void;
}) => {
    const needs_barrier = trade.contract_type === 'DIGITOVER' || trade.contract_type === 'DIGITUNDER';

    return (
        <div className='bulk-trading__fields'>
            <label className='bulk-trading__field'>
                <span>Market</span>
                <select value={trade.symbol} onChange={event => onChange({ ...trade, symbol: event.target.value })}>
                    {SUPPORTED_VOLATILITY_MARKETS.map(market => (
                        <option key={market.symbol} value={market.symbol}>
                            {market.label}
                        </option>
                    ))}
                </select>
            </label>
            <label className='bulk-trading__field'>
                <span>Trade type</span>
                <select
                    value={trade.contract_type}
                    onChange={event => onChange({ ...trade, contract_type: event.target.value })}
                >
                    {CONTRACT_TYPES.map(type => (
                        <option key={type.value} value={type.value}>
                            {type.label}
                        </option>
                    ))}
                </select>
            </label>
            {needs_barrier && (
                <label className='bulk-trading__field'>
                    <span>Digit barrier</span>
                    <input
                        inputMode='numeric'
                        max={9}
                        min={0}
                        value={trade.barrier ?? '5'}
                        onChange={event => onChange({ ...trade, barrier: event.target.value })}
                    />
                </label>
            )}
            <label className='bulk-trading__field'>
                <span>Duration (ticks)</span>
                <input
                    inputMode='numeric'
                    min={1}
                    value={trade.duration}
                    onChange={event => onChange({ ...trade, duration: Number(event.target.value) || 1 })}
                />
            </label>
            <label className='bulk-trading__field'>
                <span>Stake</span>
                <input
                    inputMode='decimal'
                    min={0.35}
                    step={0.01}
                    value={trade.stake}
                    onChange={event => onChange({ ...trade, stake: Number(event.target.value) || 0 })}
                />
            </label>
        </div>
    );
};

const BulkTrading = observer(() => {
    const { client } = useStore();
    const [mode, setMode] = useState<'accounts' | 'batch'>('accounts');

    // Mode 1: same trade, several of the user's own linked accounts.
    const linked_accounts = useMemo<TLinkedAccount[]>(() => getLinkedAccounts(), []);
    const [selectedLoginids, setSelectedLoginids] = useState<string[]>(() =>
        linked_accounts.map(account => account.loginid)
    );
    const [accountsTrade, setAccountsTrade] = useState<TBulkTradeParameters>(DEFAULT_TRADE);
    const [accountsResults, setAccountsResults] = useState<TBulkTradeResult[] | null>(null);
    const [isRunningAccounts, setIsRunningAccounts] = useState(false);

    // Mode 2: several different trades, one account (the one active in the app).
    const [batchTrades, setBatchTrades] = useState<TBatchTrade[]>([newBatchTrade(), newBatchTrade()]);
    const [batchResults, setBatchResults] = useState<Record<string, { ok: boolean; message: string }> | null>(null);
    const [isRunningBatch, setIsRunningBatch] = useState(false);

    const toggleAccount = (loginid: string) => {
        setSelectedLoginids(current =>
            current.includes(loginid) ? current.filter(id => id !== loginid) : [...current, loginid]
        );
    };

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

    const handleRunBatch = async () => {
        if (!batchTrades.length) return;

        setIsRunningBatch(true);
        setBatchResults(null);
        try {
            const results = await runBulkTradesOnActiveAccount(batchTrades);
            setBatchResults(results);
        } finally {
            setIsRunningBatch(false);
        }
    };

    return (
        <div className='bulk-trading-page'>
            <div className='bulk-trading__mode-toggle'>
                <button
                    className={classNames('bulk-trading__mode-btn', { 'bulk-trading__mode-btn--active': mode === 'accounts' })}
                    onClick={() => setMode('accounts')}
                    type='button'
                >
                    Same trade, multiple accounts
                </button>
                <button
                    className={classNames('bulk-trading__mode-btn', { 'bulk-trading__mode-btn--active': mode === 'batch' })}
                    onClick={() => setMode('batch')}
                    type='button'
                >
                    Multiple trades, one account
                </button>
            </div>

            {mode === 'accounts' && (
                <section className='bulk-trading__panel'>
                    <p className='bulk-trading__hint'>
                        Runs the same trade on each account you select below, at the same time, each with its own login. Only
                        accounts currently linked to this browser session are listed.
                    </p>

                    {!linked_accounts.length ? (
                        <p className='bulk-trading__empty'>
                            No linked accounts found. Log in with an account that has multiple accounts linked to use this
                            mode.
                        </p>
                    ) : (
                        <div className='bulk-trading__account-list'>
                            {linked_accounts.map(account => (
                                <label key={account.loginid} className='bulk-trading__account'>
                                    <input
                                        checked={selectedLoginids.includes(account.loginid)}
                                        onChange={() => toggleAccount(account.loginid)}
                                        type='checkbox'
                                    />
                                    <span>
                                        {account.loginid}
                                        {account.currency ? ` · ${account.currency}` : ''}
                                        {account.is_virtual ? ' · Demo' : ''}
                                        {account.loginid === client?.loginid ? ' (current)' : ''}
                                    </span>
                                </label>
                            ))}
                        </div>
                    )}

                    <TradeFieldsEditor trade={accountsTrade} onChange={setAccountsTrade} />

                    <button
                        className='bulk-trading__run-btn'
                        disabled={isRunningAccounts || !selectedLoginids.length}
                        onClick={handleRunAccounts}
                        type='button'
                    >
                        {isRunningAccounts
                            ? 'Placing trades…'
                            : `Place on ${selectedLoginids.length} account${selectedLoginids.length === 1 ? '' : 's'}`}
                    </button>

                    {accountsResults && (
                        <ul className='bulk-trading__results'>
                            {accountsResults.map(result => (
                                <li
                                    key={result.loginid}
                                    className={classNames('bulk-trading__result', {
                                        'bulk-trading__result--ok': result.ok,
                                        'bulk-trading__result--error': !result.ok,
                                    })}
                                >
                                    <strong>{result.loginid}</strong>
                                    <span>{result.ok ? `Bought · payout ${result.payout ?? '—'}` : result.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            {mode === 'batch' && (
                <section className='bulk-trading__panel'>
                    <p className='bulk-trading__hint'>
                        Places several different trades at once on your currently active account.
                    </p>

                    {batchTrades.map((trade, index) => (
                        <div className='bulk-trading__batch-item' key={trade.id}>
                            <div className='bulk-trading__batch-item-header'>
                                <span>Trade {index + 1}</span>
                                {batchTrades.length > 1 && (
                                    <button
                                        className='bulk-trading__remove-btn'
                                        onClick={() => setBatchTrades(current => current.filter(item => item.id !== trade.id))}
                                        type='button'
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>
                            <TradeFieldsEditor
                                trade={trade}
                                onChange={next =>
                                    setBatchTrades(current =>
                                        current.map(item => (item.id === trade.id ? { ...next, id: item.id } : item))
                                    )
                                }
                            />
                            {batchResults?.[trade.id] && (
                                <p
                                    className={classNames('bulk-trading__batch-result', {
                                        'bulk-trading__result--ok': batchResults[trade.id].ok,
                                        'bulk-trading__result--error': !batchResults[trade.id].ok,
                                    })}
                                >
                                    {batchResults[trade.id].message}
                                </p>
                            )}
                        </div>
                    ))}

                    <button
                        className='bulk-trading__add-btn'
                        onClick={() => setBatchTrades(current => [...current, newBatchTrade()])}
                        type='button'
                    >
                        + Add another trade
                    </button>

                    <button
                        className='bulk-trading__run-btn'
                        disabled={isRunningBatch || !batchTrades.length}
                        onClick={handleRunBatch}
                        type='button'
                    >
                        {isRunningBatch ? 'Placing trades…' : `Place ${batchTrades.length} trades`}
                    </button>
                </section>
            )}
        </div>
    );
});

export default BulkTrading;
