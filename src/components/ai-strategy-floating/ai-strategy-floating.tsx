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

const AiStrategyFloating = observer(() => {
    const { dashboard } = useStore();
    const { active_tab, setActiveTab } = dashboard;

    if (!isDomainFeatureEnabled('autoTrades')) return null;
    // Auto Trading already renders its own local AI button — avoid a duplicate.
    if (active_tab === DBOT_TABS.AUTO_TRADES) return null;

    const handleClick = () => {
        try {
            sessionStorage.setItem(AI_STRATEGY_OPEN_FLAG, '1');
        } catch {
            // Ignore storage failures (private browsing, etc.) — tab switch still works.
        }
        setActiveTab(DBOT_TABS.AUTO_TRADES);
    };

    return (
        <button className={styles.trigger} onClick={handleClick} type='button' title='AI strategy setup'>
            <span className={styles.dot} />
            <span>AI</span>
        </button>
    );
});

export default AiStrategyFloating;
