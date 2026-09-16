import { Component, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { isDomainFeatureEnabled } from '@/components/shared';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { APEX_BOT_OPEN_SCANNER_FLAG } from '@/stores/apex-bot-bridge';
import styles from './ai-strategy-floating.module.scss';

// Session flag read by AutoTrades on mount/tab-activation to auto-open its
// existing AI Strategy modal. Left in place (unused by these buttons) since
// AutoTrades still reads it — kept as a plain sessionStorage flag rather than
// lifting that modal's state out of AutoTrades.
export const AI_STRATEGY_OPEN_FLAG = 'db_open_ai_strategy_modal';

const setFlag = (key: string) => {
    try {
        sessionStorage.setItem(key, '1');
    } catch {
        // Ignore storage failures (private browsing, etc.) — tab switch still works.
    }
};

// Three differently-branded entry points into the same real, rule-based
// market scanner Apex Bot already uses (tick/digit pattern analysis — no
// external AI API or key involved). Deliberately NOT named after real AI
// products/companies (Gemini, Groq, Claude are actual third-party brands) —
// these buttons don't call those services, so labeling them that way would
// mislead traders about what's actually analyzing their trades.
const SCANNERS = [
    { id: 'nova', label: 'Nova', position: styles.posBottomRight, glow: styles.glowViolet },
    { id: 'pulse', label: 'Pulse', position: styles.posBottomLeft, glow: styles.glowTeal },
    { id: 'vantage', label: 'Vantage', position: styles.posMidRight, glow: styles.glowGold },
] as const;

const AiStrategyFloatingButtons = observer(() => {
    const store = useStore();

    // Defensive: if the MobX store context isn't ready for any reason, render
    // nothing rather than throwing — a failure here must never be able to
    // take down the rest of the page, since these buttons are mounted globally.
    if (!store?.dashboard) return null;

    const { active_tab, setActiveTab } = store.dashboard;

    let apex_bot_enabled = true;
    try {
        apex_bot_enabled = isDomainFeatureEnabled('apexBot');
    } catch {
        apex_bot_enabled = true;
    }
    if (!apex_bot_enabled) return null;
    // Already on Apex Bot's own tab — its in-page controls cover this.
    if (active_tab === DBOT_TABS.APEX_BOT) return null;

    return (
        <>
            {SCANNERS.map(scanner => (
                <button
                    key={scanner.id}
                    className={`${styles.trigger} ${scanner.position} ${scanner.glow}`}
                    onClick={() => {
                        setFlag(APEX_BOT_OPEN_SCANNER_FLAG);
                        setActiveTab?.(DBOT_TABS.APEX_BOT);
                    }}
                    title={`${scanner.label}: market scanner`}
                    type='button'
                >
                    <span className={styles.shine} />
                    <span className={styles.label}>{scanner.label}</span>
                </button>
            ))}
        </>
    );
});

// Local error boundary: these buttons are mounted once, globally, on every
// tab. A render error inside them must degrade to "no buttons" rather than
// ever being able to affect the rest of the app.
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
        <AiStrategyFloatingButtons />
    </AiStrategyFloatingBoundary>
);

export default AiStrategyFloating;
