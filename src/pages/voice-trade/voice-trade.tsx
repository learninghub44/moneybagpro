import { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Dialog from '@/components/shared_ui/dialog';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { contractTypeNeedsBarrier, parseVoiceCommand, type TParsedVoiceTrade } from './voice-command-parser';
import './voice-trade.scss';

type TStatus = 'idle' | 'listening' | 'confirming' | 'purchasing';

type TVoiceTradeHistoryItem = {
    id: string;
    label: string;
    profit?: number;
    stake: number;
    status: 'open' | 'won' | 'lost';
};

// Minimal ambient typing for the Web Speech API — not in the standard DOM
// lib, and browser support varies (Chrome/Edge/Safari desktop and Android
// Chrome support it; Firefox and iOS Safari largely don't), so this is
// feature-detected at runtime rather than assumed.
type TSpeechRecognition = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onend: (() => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    start: () => void;
    stop: () => void;
};

const getSpeechRecognitionCtor = (): (new () => TSpeechRecognition) | undefined => {
    const globalWindow = window as unknown as {
        SpeechRecognition?: new () => TSpeechRecognition;
        webkitSpeechRecognition?: new () => TSpeechRecognition;
    };
    return globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition;
};

const buildTradeParameters = (trade: TParsedVoiceTrade, currency: string) => {
    const parameters: Record<string, number | string> = {
        amount: trade.stake,
        basis: 'stake',
        contract_type: trade.contractType,
        currency,
        duration: trade.duration,
        duration_unit: 't',
        symbol: trade.symbol,
    };

    if (contractTypeNeedsBarrier(trade.contractType) && trade.barrier !== undefined) {
        parameters.barrier = trade.barrier;
    }

    return parameters;
};

const VoiceTrade = observer(() => {
    const { client, dashboard, run_panel, summary_card, transactions } = useStore();
    const { active_tab } = dashboard;
    const is_active = active_tab === DBOT_TABS.VOICE_TRADE;
    const currency = client.currency || 'USD';

    const [status, setStatus] = useState<TStatus>('idle');
    const [transcript, setTranscript] = useState('');
    const [manualText, setManualText] = useState('');
    const [parseError, setParseError] = useState('');
    const [micError, setMicError] = useState('');
    const [pendingTrade, setPendingTrade] = useState<TParsedVoiceTrade | null>(null);
    const [tradeMessage, setTradeMessage] = useState('');
    const [history, setHistory] = useState<TVoiceTradeHistoryItem[]>([]);

    const recognitionRef = useRef<TSpeechRecognition | null>(null);
    const isSpeechSupported = Boolean(getSpeechRecognitionCtor());

    useEffect(() => {
        if (!is_active) recognitionRef.current?.stop();
    }, [is_active]);

    useEffect(
        () => () => {
            recognitionRef.current?.stop();
        },
        []
    );

    const handleTranscript = useCallback((text: string) => {
        setTranscript(text);
        setParseError('');

        const result = parseVoiceCommand(text);
        if (!result.ok) {
            setParseError(result.message);
            setPendingTrade(null);
            setStatus('idle');
            return;
        }

        setPendingTrade(result.trade);
        setStatus('confirming');
    }, []);

    const startListening = useCallback(() => {
        const Ctor = getSpeechRecognitionCtor();
        if (!Ctor) {
            setMicError("This browser doesn't support voice input. Type the command below instead.");
            return;
        }

        setMicError('');
        setParseError('');
        setTranscript('');
        setTradeMessage('');

        const recognition = new Ctor();
        recognition.lang = 'en-US';
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onresult = event => {
            const text = event.results?.[0]?.[0]?.transcript ?? '';
            handleTranscript(text);
        };

        recognition.onerror = event => {
            setStatus('idle');
            if (event.error === 'not-allowed' || event.error === 'permission-denied') {
                setMicError('Microphone access was blocked. Allow it in your browser settings and try again.');
            } else if (event.error === 'no-speech') {
                setMicError("Didn't hear anything. Try again.");
            } else {
                setMicError('Voice input failed. Try again or type the command below.');
            }
        };

        recognition.onend = () => {
            setStatus(current => (current === 'listening' ? 'idle' : current));
        };

        recognitionRef.current = recognition;
        setStatus('listening');
        recognition.start();
    }, [handleTranscript]);

    const stopListening = useCallback(() => {
        recognitionRef.current?.stop();
        setStatus('idle');
    }, []);

    const handleManualSubmit = useCallback(() => {
        if (!manualText.trim()) return;
        handleTranscript(manualText);
    }, [manualText, handleTranscript]);

    const pushContract = useCallback(
        (data: Record<string, unknown>) => {
            try {
                transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(data);
                summary_card.onBotContractEvent(data);
            } catch {
                // Voice trading should not fail because a side panel observer is unavailable.
            }
        },
        [run_panel, summary_card, transactions]
    );

    const handleCancel = useCallback(() => {
        setPendingTrade(null);
        setStatus('idle');
        setTranscript('');
    }, []);

    const handleConfirm = useCallback(async () => {
        if (!pendingTrade) return;

        if (!api_base.api) {
            setParseError('Deriv connection is not ready yet.');
            setStatus('idle');
            setPendingTrade(null);
            return;
        }

        const trade = pendingTrade;
        const historyId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const label = `${trade.actionLabel} · ${trade.marketLabel}`;

        setStatus('purchasing');
        setTradeMessage(`Buying ${label} at ${trade.stake.toFixed(2)} ${currency}...`);
        setPendingTrade(null);

        const openHistoryItem: TVoiceTradeHistoryItem = { id: historyId, label, stake: trade.stake, status: 'open' };
        setHistory(current => [openHistoryItem, ...current].slice(0, 10));

        try {
            const parameters = buildTradeParameters(trade, currency);
            const buy = await buyContractForUi({ parameters, price: trade.stake, source: 'VoiceTrade' });

            const fallbackContract = {
                buy_price: buy.buy_price,
                contract_id: buy.contract_id,
                contract_type: trade.contractType,
                currency,
                date_start: Math.floor(Date.now() / 1000),
                display_name: trade.marketLabel,
                shortcode: `VOICE_${trade.contractType}_${trade.symbol}`,
                transaction_ids: { buy: buy.transaction_id },
                underlying_symbol: trade.symbol,
            };

            pushContract(fallbackContract);
            setTradeMessage(`${label} bought at ${trade.stake.toFixed(2)} ${currency}. Waiting for result...`);

            const settled = await streamContractUntilSettled({
                contractId: buy.contract_id,
                fallback: fallbackContract,
                onUpdate: snapshot => pushContract(snapshot),
                source: 'VoiceTrade',
            });

            const profit = Number(settled?.profit ?? 0);
            const won = profit >= 0;

            setHistory(current =>
                current.map(item => (item.id === historyId ? { ...item, profit, status: won ? 'won' : 'lost' } : item))
            );
            setTradeMessage(`${label}: ${won ? 'Won' : 'Lost'} ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${currency}`);
        } catch (error) {
            setHistory(current => current.filter(item => item.id !== historyId));
            setParseError(error instanceof Error ? error.message : 'Trade failed. Try again.');
            setTradeMessage('');
        } finally {
            setStatus('idle');
        }
    }, [pendingTrade, currency, pushContract]);

    return (
        <div className='voice-trade-page'>
            <div className='voice-trade__card'>
                <h2 className='voice-trade__title'>Voice Trade</h2>
                <p className='voice-trade__subtitle'>
                    Say a market, a trade type, and a stake — e.g. <em>&ldquo;Rise on Volatility 75, stake 10&rdquo;</em> or{' '}
                    <em>&ldquo;Over 5 on Volatility 10, stake 2&rdquo;</em>. Every trade is shown to you for confirmation
                    before anything is bought.
                </p>

                <button
                    className={classNames('voice-trade__mic', {
                        'voice-trade__mic--listening': status === 'listening',
                        'voice-trade__mic--disabled': !isSpeechSupported,
                    })}
                    onClick={status === 'listening' ? stopListening : startListening}
                    type='button'
                >
                    <span className='voice-trade__mic-icon' aria-hidden='true' />
                    <span>
                        {status === 'listening'
                            ? 'Listening… tap to stop'
                            : status === 'purchasing'
                              ? 'Placing trade…'
                              : 'Tap to speak'}
                    </span>
                </button>

                {!isSpeechSupported && (
                    <p className='voice-trade__notice'>
                        Voice input isn&apos;t supported in this browser. Type your command instead.
                    </p>
                )}

                {micError && <p className='voice-trade__error'>{micError}</p>}

                <div className='voice-trade__manual'>
                    <input
                        onChange={event => setManualText(event.target.value)}
                        onKeyDown={event => event.key === 'Enter' && handleManualSubmit()}
                        placeholder='Or type a command, e.g. "Rise on Volatility 75, stake 10"'
                        type='text'
                        value={manualText}
                    />
                    <button disabled={!manualText.trim()} onClick={handleManualSubmit} type='button'>
                        Parse
                    </button>
                </div>

                {transcript && <p className='voice-trade__heard'>Heard: &ldquo;{transcript}&rdquo;</p>}
                {parseError && <p className='voice-trade__error'>{parseError}</p>}
                {tradeMessage && <p className='voice-trade__status-message'>{tradeMessage}</p>}
            </div>

            {history.length > 0 && (
                <div className='voice-trade__history'>
                    <h3>Recent voice trades</h3>
                    {history.map(item => (
                        <div className={classNames('voice-trade__history-row', `voice-trade__history-row--${item.status}`)} key={item.id}>
                            <span className='voice-trade__history-label'>{item.label}</span>
                            <span className='voice-trade__history-stake'>
                                {item.stake.toFixed(2)} {currency}
                            </span>
                            <span className='voice-trade__history-status'>
                                {item.status === 'open'
                                    ? 'Open'
                                    : `${item.status === 'won' ? 'Won' : 'Lost'} ${(item.profit ?? 0) >= 0 ? '+' : ''}${(item.profit ?? 0).toFixed(2)}`}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <Dialog
                cancel_button_text='Cancel'
                className='voice-trade-confirm-modal'
                has_close_icon={false}
                is_mobile_full_width={false}
                is_visible={status === 'confirming' && Boolean(pendingTrade)}
                onCancel={handleCancel}
                onConfirm={handleConfirm}
                confirm_button_text='Confirm & Buy'
                login={() => undefined}
                onClose={handleCancel}
                portal_element_id='modal_root'
                title='Confirm voice trade'
            >
                {pendingTrade && (
                    <div className='voice-trade-confirm'>
                        <div className='voice-trade-confirm__row'>
                            <span>Market</span>
                            <strong>{pendingTrade.marketLabel}</strong>
                        </div>
                        <div className='voice-trade-confirm__row'>
                            <span>Trade type</span>
                            <strong>{pendingTrade.actionLabel}</strong>
                        </div>
                        <div className='voice-trade-confirm__row'>
                            <span>Stake</span>
                            <strong>
                                {pendingTrade.stake.toFixed(2)} {currency}
                            </strong>
                        </div>
                        <div className='voice-trade-confirm__row'>
                            <span>Duration</span>
                            <strong>{pendingTrade.duration} ticks</strong>
                        </div>
                        <p className='voice-trade-confirm__disclaimer'>
                            This will place a real trade on your account. Tap Confirm &amp; Buy to proceed, or Cancel to
                            discard it.
                        </p>
                    </div>
                )}
            </Dialog>
        </div>
    );
});

export default VoiceTrade;
