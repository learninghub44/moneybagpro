import { Component, useState, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { isDomainFeatureEnabled } from '@/components/shared';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { apexBotBridge, APEX_BOT_AUTO_START_FLAG, APEX_BOT_OPEN_SCANNER_FLAG } from '@/stores/apex-bot-bridge';
import styles from './ai-strategy-floating.module.scss';

// Session flag read by AutoTrades on mount/tab-activation to auto-open its
// existing AI Strategy modal. Kept as a plain sessionStorage flag (rather
// than lifting the modal/state out of AutoTrades) so none of the auto-trades
// AI-strategy logic has to move — this only changes where the trigger lives.
export const AI_STRATEGY_OPEN_FLAG = 'db_open_ai_strategy_modal';

const safeSessionStorage = {
    set: (key: string) => {
        try {
            sessionStorage.setItem(key, '1');
        } catch {
            // Ignore storage failures (private browsing, etc.) — tab switch still works.
        }
    },
};

const AiStrategyFloatingButton = observer(() => {
    const store = useStore();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Defensive: if the MobX store context isn't ready for any reason, render
    // nothing rather than throwing — a failure here must never be able to
    // take down the rest of the page, since this button is mounted globally.
    if (!store?.dashboard) return null;

    const { active_tab, setActiveTab } = store.dashboard;

    let auto_trades_enabled = true;
    let apex_bot_enabled = true;
    try {
        auto_trades_enabled = isDomainFeatureEnabled('autoTrades');
    } catch {
        auto_trades_enabled = true;
    }
    try {
        apex_bot_enabled = isDomainFeatureEnabled('apexBot');
    } catch {
        apex_bot_enabled = true;
    }

    if (!auto_trades_enabled && !apex_bot_enabled) return null;
    // Auto Trading already renders its own local AI button — avoid a duplicate.
    if (active_tab === DBOT_TABS.AUTO_TRADES) return null;

    const openAiStrategySetup = () => {
        safeSessionStorage.set(AI_STRATEGY_OPEN_FLAG);
        setActiveTab?.(DBOT_TABS.AUTO_TRADES);
        setIsMenuOpen(false);
    };

    const openEntryScanner = () => {
        safeSessionStorage.set(APEX_BOT_OPEN_SCANNER_FLAG);
        setActiveTab?.(DBOT_TABS.APEX_BOT);
        setIsMenuOpen(false);
    };

    const toggleApexBot = () => {
        if (apexBotBridge.isRunning) {
            apexBotBridge.requestStop();
            setIsMenuOpen(false);
            return;
        }
        if (active_tab === DBOT_TABS.APEX_BOT) {
            // Already there and mounted — no need to round-trip through a
            // session flag, just call straight through the bridge.
            apexBotBridge.requestStart();
        } else {
            safeSessionStorage.set(APEX_BOT_AUTO_START_FLAG);
            setActiveTab?.(DBOT_TABS.APEX_BOT);
        }
        setIsMenuOpen(false);
    };

    // Only one destination (Auto Trades' own AI Strategy setup) — keep the
    // original single-tap behaviour rather than showing a one-item menu.
    if (!apex_bot_enabled) {
        return (
            <button className={styles.trigger} onClick={openAiStrategySetup} title='AI strategy setup' type='button'>
                <span>AI</span>
                <span className={styles.dot} />
            </button>
        );
    }

    return (
        <div className={styles.wrapper}>
            {isMenuOpen && (
                <>
                    <button
                        aria-label='Close menu'
                        className={styles.backdrop}
                        onClick={() => setIsMenuOpen(false)}
                        type='button'
                    />
                    <div className={styles.menu} role='menu'>
                        <button className={styles.menuItem} onClick={openAiStrategySetup} role='menuitem' type='button'>
                            AI Strategy Setup
                        </button>
                        <button className={styles.menuItem} onClick={openEntryScanner} role='menuitem' type='button'>
                            Apex Bot: Entry Scanner
                        </button>
                        <button className={styles.menuItem} onClick={toggleApexBot} role='menuitem' type='button'>
                            {apexBotBridge.isRunning ? 'Apex Bot: Stop Bot' : 'Apex Bot: Start Bot'}
                        </button>
                        {apexBotBridge.pinnedLabel && (
                            <p className={styles.menuHint}>Pinned: {apexBotBridge.pinnedLabel}</p>
                        )}
                    </div>
                </>
            )}
            <button
                className={styles.trigger}
                onClick={() => setIsMenuOpen(open => !open)}
                title='AI actions'
                type='button'
            >
                <span>AI</span>
                <span className={apexBotBridge.isRunning ? styles.dotRunning : styles.dot} />
            </button>
        </div>
    );
});

// Local error boundary: this component is mounted once, globally, on every
// tab. A render error inside it must degrade to "no badge" rather than ever
// being able to affect the rest of the app (this is what protects against a
// repeat of the earlier regression, regardless of root cause).
class AiStrategyFloatingBoundary extends Component<{ children: ReactNode }, { has_error: boolean }> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { has_error: false };
    }

    static getDerivedStateFromError() {
        return { has_error: true };
    }

    componentDidCatch(error: unknown) {
        // eslint-disable-next-line no-console
        console.error('[AiStrategyFloating] suppressed render error:', error);
    }

    render() {
        if (this.state.has_error) return null;
        return this.props.children;
    }
}

const AiStrategyFloating = () => (
    <AiStrategyFloatingBoundary>
        <AiStrategyFloatingButton />
    </AiStrategyFloatingBoundary>
);

export default AiStrategyFloating;
