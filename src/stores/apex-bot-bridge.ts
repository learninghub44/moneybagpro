import { makeAutoObservable } from 'mobx';

// Session flags the floating AI button sets right before switching the
// active tab to Apex Bot. Apex Bot consumes (and clears) them the moment it
// becomes the active tab — the same pattern AutoTrades already uses for
// AI_STRATEGY_OPEN_FLAG, kept separate so neither feature has to know about
// the other's internals.
export const APEX_BOT_OPEN_SCANNER_FLAG = 'db_open_apex_bot_scanner';
export const APEX_BOT_AUTO_START_FLAG = 'db_apex_bot_auto_start';

type TApexBotControls = {
    start: () => void;
    stop: () => void;
};

/**
 * Apex Bot registers its start/stop functions here once it mounts (it stays
 * mounted for the lifetime of the app, same as Bulk Trading and AI Hub, and
 * just gates its own internal work on whether its tab is active). The
 * floating AI button — rendered as a sibling, not a child — reads and calls
 * through this bridge instead of needing a prop path or lifting Apex Bot's
 * run loop out of its own page.
 */
class ApexBotBridge {
    isRunning = false;
    pinnedLabel: string | null = null;
    private controls: TApexBotControls | null = null;

    constructor() {
        makeAutoObservable(this);
    }

    get isMounted() {
        return this.controls !== null;
    }

    get hasPinnedSignal() {
        return this.pinnedLabel !== null;
    }

    registerControls(controls: TApexBotControls) {
        this.controls = controls;
    }

    unregisterControls() {
        this.controls = null;
        this.isRunning = false;
    }

    setRunning(isRunning: boolean) {
        this.isRunning = isRunning;
    }

    setPinnedSignal(label: string | null) {
        this.pinnedLabel = label;
    }

    requestStart() {
        this.controls?.start();
    }

    requestStop() {
        this.controls?.stop();
    }
}

export const apexBotBridge = new ApexBotBridge();
