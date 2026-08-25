import { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Dialog from '@/components/shared_ui/dialog';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import {
    contractTypeNeedsBarrier,
    describeVoiceDraftForConfirmation,
    EMPTY_TRADE_DRAFT,
    finalizeVoiceDraft,
    getNextVoiceSlot,
    getVoiceSlotQuestion,
    processVoiceReply,
    type TParsedVoiceTrade,
    type TTradeDraft,
    type TVoiceSlot,
} from './voice-command-parser';
import './voice-trade.scss';

type TPhase = 'awaiting-text' | 'idle' | 'listening' | 'purchasing' | 'speaking';

type TLogEntry = { speaker: 'bot' | 'user'; text: string };

type TVoiceTradeHistoryItem = {
    id: string;
    label: string;
    profit?: number;
    stake: number;
    status: 'open' | 'won' | 'lost';
};

// Minimal ambient typing for the Web Speech API — not in the standard DOM
// lib, and browser support varies (Chrome/Edge/Safari desktop and Android
// Chrome support recognition; TTS via SpeechSynthesis is far more broadly
// supported), so both are feature-detected at runtime rather than assumed.
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

const getSpeechSynthesis = (): SpeechSynthesis | undefined =>
    typeof window !== 'undefined' ? window.speechSynthesis : undefined;

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

type TUtteranceResult = { ok: true; transcript: string } | { ok: false; error: string };

const VoiceTrade = observer(() => {
    const { client, dashboard, run_panel, summary_card, transactions } = useStore();
    const { active_tab } = dashboard;
    const is_active = active_tab === DBOT_TABS.VOICE_TRADE;
    const currency = client.currency || 'USD';

    const [phase, setPhase] = useState<TPhase>('idle');
    const [log, setLog] = useState<TLogEntry[]>([]);
    const [draftDisplay, setDraftDisplay] = useState<TTradeDraft>(EMPTY_TRADE_DRAFT);
    const [pendingTrade, setPendingTrade] = useState<TParsedVoiceTrade | null>(null);
    const [manualText, setManualText] = useState('');
    const [micError, setMicError] = useState('');
    const [history, setHistory] = useState<TVoiceTradeHistoryItem[]>([]);

    const recognitionRef = useRef<TSpeechRecognition | null>(null);
    const stopRequestedRef = useRef(false);
    const pendingManualResolveRef = useRef<((transcript: string) => void) | null>(null);
    const logEndRef = useRef<HTMLDivElement | null>(null);

    const isSpeechSupported = Boolean(getSpeechRecognitionCtor());
    const isTtsSupported = Boolean(getSpeechSynthesis());

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [log]);

    const appendLog = useCallback((speaker: TLogEntry['speaker'], text: string) => {
        setLog(current => [...current, { speaker, text }]);
    }, []);

    const speak = useCallback(
        (text: string): Promise<void> =>
            new Promise(resolve => {
                const synth = getSpeechSynthesis();
                if (!synth) {
                    resolve();
                    return;
                }
                synth.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = 1;
                utterance.onend = () => resolve();
                utterance.onerror = () => resolve();
                synth.speak(utterance);
            }),
        []
    );

    const listenOnce = useCallback((): Promise<TUtteranceResult> => {
        return new Promise(resolve => {
            const Ctor = getSpeechRecognitionCtor();
            if (!Ctor) {
                resolve({ error: 'unsupported', ok: false });
                return;
            }

            let settled = false;
            const settle = (value: TUtteranceResult) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            const recognition = new Ctor();
            recognition.lang = 'en-US';
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.onresult = event => settle({ ok: true, transcript: event.results?.[0]?.[0]?.transcript ?? '' });
            recognition.onerror = event => settle({ error: event.error, ok: false });
            // Some browsers fire onend without a prior result/error when
            // .stop() is called externally — this guarantees the promise
            // still resolves instead of hanging the conversation loop.
            recognition.onend = () => settle({ error: 'aborted', ok: false });

            recognitionRef.current = recognition;
            recognition.start();
        });
    }, []);

    const getNextUtterance = useCallback((): Promise<TUtteranceResult> => {
        if (isSpeechSupported) return listenOnce();

        return new Promise(resolve => {
            pendingManualResolveRef.current = transcript => resolve({ ok: true, transcript });
        });
    }, [isSpeechSupported, listenOnce]);

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

    const executeTrade = useCallback(
        async (trade: TParsedVoiceTrade) => {
            if (!api_base.api) {
                const message = "Deriv connection isn't ready yet. Try again in a moment.";
                appendLog('bot', message);
                setMicError(message);
                return;
            }

            const historyId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            const label = `${trade.actionLabel} · ${trade.marketLabel}`;

            appendLog('bot', `Buying ${label} at ${trade.stake.toFixed(2)} ${currency}.`);

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

                const settled = await streamContractUntilSettled({
                    contractId: buy.contract_id,
                    fallback: fallbackContract,
                    onUpdate: snapshot => pushContract(snapshot),
                    source: 'VoiceTrade',
                });

                const profit = Number(settled?.profit ?? 0);
                const won = profit >= 0;

                setHistory(current =>
                    current.map(item =>
                        item.id === historyId ? { ...item, profit, status: won ? 'won' : 'lost' } : item
                    )
                );

                const resultMessage = `${label}: ${won ? 'You won' : 'You lost'} ${Math.abs(profit).toFixed(2)} ${currency}.`;
                appendLog('bot', resultMessage);
                if (isTtsSupported) await speak(resultMessage);
            } catch (error) {
                setHistory(current => current.filter(item => item.id !== historyId));
                const message = error instanceof Error ? error.message : 'Trade failed. Try again.';
                appendLog('bot', message);
                setMicError(message);
                if (isTtsSupported) await speak('Sorry, that trade failed.');
            }
        },
        [appendLog, currency, pushContract, isTtsSupported, speak]
    );

    const cancelConversation = useCallback(() => {
        stopRequestedRef.current = true;
        recognitionRef.current?.stop();
        pendingManualResolveRef.current = null;
        if (isTtsSupported) getSpeechSynthesis()?.cancel();
        setPendingTrade(null);
        setPhase('idle');
    }, [isTtsSupported]);

    const runConversation = useCallback(
        async (startDraft: TTradeDraft, startSlot: TVoiceSlot | 'confirmation', firstReplyText?: string) => {
            stopRequestedRef.current = false;
            let draft = startDraft;
            let slot = startSlot;
            let skipAsk = Boolean(firstReplyText);

            while (!stopRequestedRef.current) {
                let transcript: string;

                if (skipAsk && firstReplyText) {
                    transcript = firstReplyText;
                    skipAsk = false;
                } else {
                    const isConfirming = slot === 'confirmation';
                    const trade = isConfirming ? finalizeVoiceDraft(draft) : undefined;
                    const prompt = isConfirming && trade ? describeVoiceDraftForConfirmation(trade, currency) : getVoiceSlotQuestion(slot as TVoiceSlot, draft);

                    setPendingTrade(isConfirming ? trade ?? null : null);
                    appendLog('bot', prompt);

                    if (isTtsSupported) {
                        setPhase('speaking');
                        await speak(prompt);
                        if (stopRequestedRef.current) break;
                    }

                    setPhase(isSpeechSupported ? 'listening' : 'awaiting-text');
                    const result = await getNextUtterance();
                    if (stopRequestedRef.current) break;

                    if (!result.ok) {
                        setPhase('idle');
                        if (result.error === 'unsupported') {
                            setMicError("This browser doesn't support voice input. Type below instead.");
                            break;
                        }
                        if (result.error === 'not-allowed' || result.error === 'permission-denied') {
                            setMicError('Microphone access was blocked. Allow it and tap the mic again.');
                            break;
                        }
                        if (result.error === 'no-speech') {
                            appendLog('bot', "I didn't catch that — let's try again.");
                            continue;
                        }
                        if (result.error !== 'aborted') {
                            appendLog('bot', 'Voice input had a problem. Try again or type below.');
                        }
                        break;
                    }

                    transcript = result.transcript;
                }

                appendLog('user', transcript);
                const outcome = processVoiceReply(transcript, draft, slot, currency);

                if (outcome.kind === 'cancelled') {
                    setPendingTrade(null);
                    appendLog('bot', 'Okay, cancelled.');
                    if (isTtsSupported) {
                        setPhase('speaking');
                        await speak('Okay, cancelled.');
                    }
                    draft = EMPTY_TRADE_DRAFT;
                    setDraftDisplay(draft);
                    break;
                }

                if (outcome.kind === 'confirmed') {
                    setPendingTrade(null);
                    setPhase('purchasing');
                    await executeTrade(outcome.trade);
                    draft = EMPTY_TRADE_DRAFT;
                    setDraftDisplay(draft);
                    break;
                }

                draft = outcome.draft;
                slot = outcome.slot;
                setDraftDisplay(draft);
            }

            setPhase('idle');
        },
        [appendLog, currency, executeTrade, getNextUtterance, isSpeechSupported, isTtsSupported, speak]
    );

    useEffect(() => {
        if (!is_active) cancelConversation();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_active]);

    useEffect(() => () => cancelConversation(), [cancelConversation]);

    const handleMicTap = useCallback(() => {
        setMicError('');
        if (phase === 'idle') {
            runConversation(draftDisplay, getNextVoiceSlot(draftDisplay) ?? 'market');
            return;
        }
        cancelConversation();
    }, [phase, draftDisplay, runConversation, cancelConversation]);

    const handleManualSubmit = useCallback(() => {
        const text = manualText.trim();
        if (!text) return;
        setManualText('');

        if (pendingManualResolveRef.current) {
            const resolve = pendingManualResolveRef.current;
            pendingManualResolveRef.current = null;
            resolve(text);
            return;
        }

        if (phase === 'idle') {
            setMicError('');
            runConversation(draftDisplay, getNextVoiceSlot(draftDisplay) ?? 'market', text);
        }
    }, [manualText, phase, draftDisplay, runConversation]);

    const confirmPendingTrade = useCallback(async () => {
        if (!pendingTrade) return;
        const trade = pendingTrade;
        stopRequestedRef.current = true;
        recognitionRef.current?.stop();
        pendingManualResolveRef.current = null;
        if (isTtsSupported) getSpeechSynthesis()?.cancel();
        setPendingTrade(null);
        setPhase('purchasing');
        await executeTrade(trade);
        setDraftDisplay(EMPTY_TRADE_DRAFT);
        setPhase('idle');
    }, [pendingTrade, isTtsSupported, executeTrade]);

    const cancelPendingTrade = useCallback(() => {
        appendLog('bot', 'Okay, cancelled.');
        setDraftDisplay(EMPTY_TRADE_DRAFT);
        cancelConversation();
    }, [appendLog, cancelConversation]);

    const micLabel =
        phase === 'listening'
            ? 'Listening… tap to stop'
            : phase === 'speaking'
              ? 'Speaking…'
              : phase === 'awaiting-text'
                ? 'Your turn — type below'
                : phase === 'purchasing'
                  ? 'Placing trade…'
                  : 'Tap to talk';

    return (
        <div className='voice-trade-page'>
            <div className='voice-trade__card'>
                <h2 className='voice-trade__title'>Voice Trade</h2>
                <p className='voice-trade__subtitle'>
                    Tap the mic and just say <em>&ldquo;trade&rdquo;</em> — it&apos;ll ask you for the market, the trade
                    type, and the stake one at a time, then read the trade back to you and wait for a yes before buying
                    anything.
                </p>

                <button
                    className={classNames('voice-trade__mic', {
                        'voice-trade__mic--listening': phase === 'listening',
                        'voice-trade__mic--speaking': phase === 'speaking',
                        'voice-trade__mic--disabled': !isSpeechSupported && !isTtsSupported,
                    })}
                    onClick={handleMicTap}
                    type='button'
                >
                    <span className='voice-trade__mic-icon' aria-hidden='true' />
                    <span>{micLabel}</span>
                </button>

                {!isSpeechSupported && (
                    <p className='voice-trade__notice'>
                        This browser can&apos;t listen, but it can still talk and read your typed replies — use the box
                        below.
                    </p>
                )}

                {micError && <p className='voice-trade__error'>{micError}</p>}

                {log.length > 0 && (
                    <div className='voice-trade__log'>
                        {log.map((entry, index) => (
                            <div
                                className={classNames('voice-trade__log-row', `voice-trade__log-row--${entry.speaker}`)}
                                key={index}
                            >
                                <span className='voice-trade__log-speaker'>{entry.speaker === 'bot' ? 'App' : 'You'}</span>
                                <span className='voice-trade__log-text'>{entry.text}</span>
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                )}

                <div className='voice-trade__manual'>
                    <input
                        onChange={event => setManualText(event.target.value)}
                        onKeyDown={event => event.key === 'Enter' && handleManualSubmit()}
                        placeholder={
                            phase === 'awaiting-text'
                                ? 'Type your reply…'
                                : 'Or type a command, e.g. "Rise on Volatility 75, stake 10"'
                        }
                        type='text'
                        value={manualText}
                    />
                    <button
                        disabled={!manualText.trim() || phase === 'speaking' || phase === 'purchasing'}
                        onClick={handleManualSubmit}
                        type='button'
                    >
                        Send
                    </button>
                </div>
            </div>

            {history.length > 0 && (
                <div className='voice-trade__history'>
                    <h3>Recent voice trades</h3>
                    {history.map(item => (
                        <div
                            className={classNames('voice-trade__history-row', `voice-trade__history-row--${item.status}`)}
                            key={item.id}
                        >
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
                is_visible={Boolean(pendingTrade)}
                onCancel={cancelPendingTrade}
                onConfirm={confirmPendingTrade}
                confirm_button_text='Confirm & Buy'
                login={() => undefined}
                onClose={cancelPendingTrade}
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
                            Say &ldquo;yes&rdquo; or tap Confirm &amp; Buy to place this trade for real, or say
                            &ldquo;no&rdquo; / tap Cancel to discard it.
                        </p>
                    </div>
                )}
            </Dialog>
        </div>
    );
});

export default VoiceTrade;
