import { useEffect, useState } from 'react';
import styles from './pwa-install-prompt.module.scss';

// How long a dismiss suppresses the prompt for, before it starts popping up
// again. Short on purpose — the whole point of this component is to keep
// asking until the user actually installs, not to nag forever on every
// single render.
const DISMISS_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const DISMISS_KEY = 'pwa_install_dismissed_at';
const INSTALLED_KEY = 'pwa_install_completed';

type TBeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const isStandaloneDisplay = () =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's own standalone flag (not in the standard types)
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

const PwaInstallPrompt = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<TBeforeInstallPromptEvent | null>(null);
    const [visible, setVisible] = useState(false);
    const [showIosSteps, setShowIosSteps] = useState(false);

    const dueForReprompt = () => {
        if (localStorage.getItem(INSTALLED_KEY) === '1') return false;
        const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
        return Date.now() - dismissedAt > DISMISS_COOLDOWN_MS;
    };

    useEffect(() => {
        if (isStandaloneDisplay()) return;

        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setDeferredPrompt(event as TBeforeInstallPromptEvent);
            if (dueForReprompt()) setVisible(true);
        };
        const handleInstalled = () => {
            localStorage.setItem(INSTALLED_KEY, '1');
            setVisible(false);
            setDeferredPrompt(null);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleInstalled);

        // beforeinstallprompt never fires on iOS Safari — show manual steps
        // there instead, on the same cooldown/reprompt schedule.
        let iosTimer: ReturnType<typeof setTimeout> | undefined;
        if (isIos() && dueForReprompt()) {
            iosTimer = setTimeout(() => setVisible(true), 1500);
        }

        // Re-check periodically while the tab stays open, so the prompt can
        // come back after the cooldown without needing a full reload.
        const interval = setInterval(() => {
            if ((deferredPrompt || isIos()) && dueForReprompt()) setVisible(true);
        }, 60 * 1000);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleInstalled);
            if (iosTimer) clearTimeout(iosTimer);
            clearInterval(interval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!visible) return null;

    const dismiss = () => {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
        setVisible(false);
        setShowIosSteps(false);
    };

    const handleInstallClick = async () => {
        if (deferredPrompt) {
            await deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                localStorage.setItem(INSTALLED_KEY, '1');
                setVisible(false);
            } else {
                dismiss();
            }
            setDeferredPrompt(null);
            return;
        }
        if (isIos()) {
            setShowIosSteps(true);
            return;
        }
        dismiss();
    };

    return (
        <div className={styles.banner} role='dialog' aria-label='Install app'>
            {!showIosSteps ? (
                <>
                    <span className={styles.text}>Install this app on your device for faster, full-screen access.</span>
                    <div className={styles.actions}>
                        <button type='button' className={styles.install} onClick={handleInstallClick}>
                            Install
                        </button>
                        <button type='button' className={styles.dismiss} onClick={dismiss} aria-label='Dismiss'>
                            ✕
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <span className={styles.text}>
                        Tap the Share icon, then &quot;Add to Home Screen&quot; to install.
                    </span>
                    <div className={styles.actions}>
                        <button type='button' className={styles.dismiss} onClick={dismiss} aria-label='Close'>
                            Got it
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default PwaInstallPrompt;
