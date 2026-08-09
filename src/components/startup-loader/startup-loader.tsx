import React, { useCallback, useEffect, useState } from 'react';
import { WelcomeLoader } from './welcome-loader';

type TStartupLoaderProps = {
    children: React.ReactNode;
};

const STARTUP_LOADER_DURATION = 4200;

const StartupLoader = ({ children }: TStartupLoaderProps) => {
    const [is_ready, setIsReady] = useState(false);
    const [is_complete, setIsComplete] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setIsReady(true);
        }, STARTUP_LOADER_DURATION);

        return () => window.clearTimeout(timer);
    }, []);

    const handleComplete = useCallback(() => setIsComplete(true), []);

    return (
        <>
            {!is_complete && (
                <WelcomeLoader
                    appReady={is_ready}
                    minimumDuration={STARTUP_LOADER_DURATION}
                    maximumDuration={STARTUP_LOADER_DURATION}
                    onComplete={handleComplete}
                />
            )}
            {is_complete ? children : null}
        </>
    );
};

export default StartupLoader;
