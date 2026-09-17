import { Component, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
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

// A drag beyond this many pixels counts as a drag, not a click — small
// pointer jitter on a tap/click still fires the button's action normally.
const DRAG_THRESHOLD_PX = 6;
const POSITION_STORAGE_PREFIX = 'db_floating_scanner_pos_';

type TPoint = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

const loadSavedPosition = (id: string): TPoint | null => {
    try {
        const raw = localStorage.getItem(`${POSITION_STORAGE_PREFIX}${id}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
    } catch {
        // Ignore malformed/inaccessible storage — falls back to default CSS position.
    }
    return null;
};

const savePosition = (id: string, point: TPoint) => {
    try {
        localStorage.setItem(`${POSITION_STORAGE_PREFIX}${id}`, JSON.stringify(point));
    } catch {
        // Ignore storage failures — dragging still works for this session.
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

type TScanner = (typeof SCANNERS)[number];

const DraggableScannerButton = ({ scanner, onActivate }: { scanner: TScanner; onActivate: () => void }) => {
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const [pos, setPos] = useState<TPoint | null>(() => loadSavedPosition(scanner.id));
    const dragStateRef = useRef<{ startX: number; startY: number; originLeft: number; originTop: number; moved: boolean } | null>(
        null
    );

    // Re-clamp into view on resize (e.g. rotating a phone) so a saved
    // position can never end up off-screen.
    useEffect(() => {
        const handleResize = () => {
            const el = buttonRef.current;
            if (!el || !pos) return;
            const rect = el.getBoundingClientRect();
            const nextX = clamp(pos.x, 0, window.innerWidth - rect.width);
            const nextY = clamp(pos.y, 0, window.innerHeight - rect.height);
            if (nextX !== pos.x || nextY !== pos.y) {
                setPos({ x: nextX, y: nextY });
                savePosition(scanner.id, { x: nextX, y: nextY });
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pos?.x, pos?.y]);

    const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
        const el = buttonRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        dragStateRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originLeft: rect.left,
            originTop: rect.top,
            moved: false,
        };
        el.setPointerCapture(event.pointerId);
    }, []);

    const handlePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
        const drag = dragStateRef.current;
        const el = buttonRef.current;
        if (!drag || !el) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;

        const rect = el.getBoundingClientRect();
        const nextX = clamp(drag.originLeft + deltaX, 0, window.innerWidth - rect.width);
        const nextY = clamp(drag.originTop + deltaY, 0, window.innerHeight - rect.height);
        setPos({ x: nextX, y: nextY });
    }, []);

    const handlePointerUp = useCallback(
        (event: PointerEvent<HTMLButtonElement>) => {
            const drag = dragStateRef.current;
            const el = buttonRef.current;
            if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);

            if (drag?.moved) {
                setPos(current => {
                    if (current) savePosition(scanner.id, current);
                    return current;
                });
            } else {
                // No meaningful movement — treat as a genuine click.
                onActivate();
            }
            dragStateRef.current = null;
        },
        [onActivate, scanner.id]
    );

    const style = pos ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' } : undefined;

    return (
        <button
            ref={buttonRef}
            className={`${styles.trigger} ${pos ? '' : scanner.position} ${scanner.glow} ${styles.draggable}`}
            style={style}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            title={`${scanner.label}: market scanner (drag to move)`}
            type='button'
        >
            <span className={styles.shine} />
            <span className={styles.label}>{scanner.label}</span>
        </button>
    );
};

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
                <DraggableScannerButton
                    key={scanner.id}
                    scanner={scanner}
                    onActivate={() => {
                        setFlag(APEX_BOT_OPEN_SCANNER_FLAG);
                        setActiveTab?.(DBOT_TABS.APEX_BOT);
                    }}
                />
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
