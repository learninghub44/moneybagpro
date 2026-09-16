import { useState } from 'react';
import classNames from 'classnames';
import { api_base } from '@/external/bot-skeleton';
import {
    calculateDigitPercentagesFromDigits,
    DIGIT_STRATEGIES,
    evaluateDigitStrategy,
    SUPPORTED_VOLATILITY_MARKETS,
    type DigitStrategyId,
} from '@/utils/digit-strategy';
import { getLastDigitFromQuote } from '@/utils/market-data';
import './entry-scanner-modal.scss';

type TPresetId = 'O1_U8' | 'O2_U7' | 'O3_U6';

const PRESETS: {
    description: string;
    id: TPresetId;
    label: string;
    overId: DigitStrategyId;
    title: string;
    underId: DigitStrategyId;
}[] = [
    {
        description: 'Scans Over 1 and Under 8 with recovery confirmation.',
        id: 'O1_U8',
        label: 'O1 / U8',
        overId: 'OVER_1_MARKET',
        title: 'Over 1 / Under 8 Scanner',
        underId: 'UNDER_8_MARKET',
    },
    {
        description: 'Scans Over 2 and Under 7 with recovery confirmation.',
        id: 'O2_U7',
        label: 'O2 / U7',
        overId: 'OVER_2_MARKET',
        title: 'Over 2 / Under 7 Scanner',
        underId: 'UNDER_7_MARKET',
    },
    {
        description: 'Scans Over 3 and Under 6 with recovery confirmation.',
        id: 'O3_U6',
        label: 'O3 / U6',
        overId: 'OVER_3_MARKET',
        title: 'Over 3 / Under 6 Scanner',
        underId: 'UNDER_6_MARKET',
    },
];

const MIN_SCAN_DEPTH = 200;
const MAX_SCAN_DEPTH = 5000;
const DEFAULT_SCAN_DEPTH = 3000;

const clampScanDepth = (value: number) => {
    if (!Number.isFinite(value)) return DEFAULT_SCAN_DEPTH;
    return Math.min(MAX_SCAN_DEPTH, Math.max(MIN_SCAN_DEPTH, Math.round(value)));
};

export type TEntryScannerResult = {
    barrier: string;
    contractType: 'DIGITOVER' | 'DIGITUNDER';
    marketLabel: string;
    statusLabel: string;
    symbol: string;
    tradeTypeLabel: string;
};

type TEntryScannerModalProps = {
    onClose: () => void;
    onLoad: (result: TEntryScannerResult) => void;
    open: boolean;
};

const EntryScannerModal = ({ onClose, onLoad, open }: TEntryScannerModalProps) => {
    const [presetId, setPresetId] = useState<TPresetId>('O1_U8');
    const [scanDepthInput, setScanDepthInput] = useState(String(DEFAULT_SCAN_DEPTH));
    const [isScanning, setIsScanning] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [result, setResult] = useState<TEntryScannerResult | null>(null);

    if (!open) return null;

    const preset = PRESETS.find(item => item.id === presetId) ?? PRESETS[0];

    const handleScan = async () => {
        if (!api_base.api) {
            setErrorMessage("Deriv connection isn't ready yet. Check your connection and try again.");
            return;
        }

        setIsScanning(true);
        setErrorMessage(null);
        setResult(null);

        const depth = clampScanDepth(Number(scanDepthInput));

        try {
            const marketResults = await Promise.all(
                SUPPORTED_VOLATILITY_MARKETS.map(async market => {
                    const response = await (api_base.api as any).send({
                        adjust_start_time: 1,
                        count: depth,
                        end: 'latest',
                        start: 1,
                        style: 'ticks',
                        ticks_history: market.symbol,
                    });
                    const prices: unknown[] = Array.isArray(response?.history?.prices) ? response.history.prices : [];
                    const digits = prices
                        .map(price => Number(price))
                        .filter(price => Number.isFinite(price))
                        .map(price => getLastDigitFromQuote(price, market.symbol));
                    const percentages = calculateDigitPercentagesFromDigits(digits);
                    return {
                        market,
                        overEval: evaluateDigitStrategy(preset.overId, percentages, digits),
                        underEval: evaluateDigitStrategy(preset.underId, percentages, digits),
                    };
                })
            );

            const scored = marketResults.flatMap(entry => [
                { evaluation: entry.overEval, market: entry.market, strategyId: preset.overId },
                { evaluation: entry.underEval, market: entry.market, strategyId: preset.underId },
            ]);

            const entryReady = scored.filter(item => item.evaluation.entryReady);
            const qualified = scored
                .filter(item => item.evaluation.isQualified)
                .sort((a, b) => b.evaluation.qualifyingWinningDigits.length - a.evaluation.qualifyingWinningDigits.length);
            const closest = [...scored].sort((a, b) => b.evaluation.trailingTriggerCount - a.evaluation.trailingTriggerCount);

            const best = entryReady[0] ?? qualified[0] ?? closest[0];

            if (!best) {
                setErrorMessage('No usable data came back from Deriv for these markets. Try again.');
                return;
            }

            const strategy = DIGIT_STRATEGIES[best.strategyId];
            const statusLabel = best.evaluation.entryReady
                ? 'Entry ready now'
                : best.evaluation.isQualified
                  ? `Qualified — waiting for ${strategy.triggerLabel.toLowerCase()}`
                  : `Not yet qualified (${best.evaluation.trailingTriggerCount}/${strategy.minWinningDigits} trigger digits seen)`;

            setResult({
                barrier: strategy.winBarrier,
                contractType: strategy.contractType,
                marketLabel: best.market.label,
                statusLabel,
                symbol: best.market.symbol,
                tradeTypeLabel: strategy.alertLabel,
            });
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Scan failed. Try again.');
        } finally {
            setIsScanning(false);
        }
    };

    const handleLoad = () => {
        if (!result) return;
        onLoad(result);
    };

    return (
        <div className='entry-scanner-modal__overlay' onClick={onClose} role='presentation'>
            <div className='entry-scanner-modal' onClick={event => event.stopPropagation()} role='dialog'>
                <div className='entry-scanner-modal__header'>
                    <h2>Entry Scanner</h2>
                    <button aria-label='Close' className='entry-scanner-modal__close' onClick={onClose} type='button'>
                        ✕
                    </button>
                </div>

                <div className='entry-scanner-modal__body'>
                    <div className='entry-scanner-modal__banner'>
                        <span className='entry-scanner-modal__banner-badge'>✦ RECOVERY ENGINE</span>
                        <h3>{preset.title}</h3>
                        <p>{preset.description}</p>
                    </div>

                    <div className='entry-scanner-modal__presets'>
                        {PRESETS.map(item => (
                            <button
                                className={classNames('entry-scanner-modal__preset', {
                                    'entry-scanner-modal__preset--active': item.id === presetId,
                                })}
                                disabled={isScanning}
                                key={item.id}
                                onClick={() => {
                                    setPresetId(item.id);
                                    setResult(null);
                                    setErrorMessage(null);
                                }}
                                type='button'
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <div className='entry-scanner-modal__fields'>
                        <label className='entry-scanner-modal__field'>
                            <span>Scan Depth</span>
                            <input
                                disabled={isScanning}
                                inputMode='numeric'
                                onChange={event => setScanDepthInput(event.target.value.replace(/[^0-9]/g, ''))}
                                value={scanDepthInput}
                            />
                        </label>
                        <label className='entry-scanner-modal__field'>
                            <span>Mode</span>
                            <input disabled readOnly value={preset.label} />
                        </label>
                        <label className='entry-scanner-modal__field'>
                            <span>Ticks</span>
                            <input
                                disabled={isScanning}
                                inputMode='numeric'
                                onChange={event => setScanDepthInput(event.target.value.replace(/[^0-9]/g, ''))}
                                value={scanDepthInput}
                            />
                        </label>
                    </div>

                    <div className='entry-scanner-modal__readouts'>
                        <label className='entry-scanner-modal__field'>
                            <span>Selected Market</span>
                            <input disabled readOnly value={result?.marketLabel ?? 'Scan to find the best market'} />
                        </label>
                        <label className='entry-scanner-modal__field'>
                            <span>Trade Type</span>
                            <input disabled readOnly value={result?.tradeTypeLabel ?? 'Waiting for scan'} />
                        </label>
                    </div>

                    <div
                        className={classNames('entry-scanner-modal__status', {
                            'entry-scanner-modal__status--ready': result?.statusLabel === 'Entry ready now',
                            'entry-scanner-modal__status--scanning': isScanning,
                        })}
                    >
                        <span className='entry-scanner-modal__status-icon' />
                        {isScanning ? 'Scanning markets…' : (result?.statusLabel ?? 'Not scanned yet')}
                    </div>

                    {errorMessage && <p className='entry-scanner-modal__error'>{errorMessage}</p>}

                    <div className='entry-scanner-modal__actions'>
                        <button
                            className='entry-scanner-modal__scan-btn'
                            disabled={isScanning}
                            onClick={() => void handleScan()}
                            type='button'
                        >
                            {isScanning ? 'Scanning…' : 'Scan Markets'}
                        </button>
                        <button
                            className='entry-scanner-modal__load-btn'
                            disabled={!result || isScanning}
                            onClick={handleLoad}
                            type='button'
                        >
                            Load Scanner Bot
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EntryScannerModal;
