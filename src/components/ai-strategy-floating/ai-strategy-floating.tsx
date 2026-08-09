import { Component, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { isDomainFeatureEnabled } from '@/components/shared';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
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

    // Defensive: if the MobX store context isn't ready for any reason, render
    // nothing rather than throwing — a failure here must never be able to
    // take down the rest of the page, since this button is mounted globally.
    if (!store?.dashboard) return null;

    const { active_tab, setActiveTab } = store.dashboard;

    let auto_trades_enabled = true;
    try {
        auto_trades_enabled = isDomainFeatureEnabled('autoTrades');
    } catch {
        auto_trades_enabled = true;
    }

    if (!auto_trades_enabled) return null;
    // Auto Trading already renders its own local AI button — avoid a duplicate.
    if (active_tab === DBOT_TABS.AUTO_TRADES) return null;

    const handleClick = () => {
        safeSessionStorage.set(AI_STRATEGY_OPEN_FLAG);
        setActiveTab?.(DBOT_TABS.AUTO_TRADES);
    };

    return (
        <button className={styles.trigger} onClick={handleClick} type='button' title='AI strategy setup'>
            <span>AI</span>
            <span className={styles.dot} />
        </button>
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
