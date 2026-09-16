import React, { useEffect, useRef, useState } from 'react';
import { useDomainLoaderConfig } from '../useDomainLoaderConfig';
import { useLoaderProgress } from '../useLoaderProgress';
import './WelcomeLoader.scss';

interface WelcomeLoaderProps {
    appReady?: boolean;
    minimumDuration?: number;
    maximumDuration?: number;
    onComplete: () => void;
}

const BOOT_MESSAGES = [
    'Initializing D-Bot...',
    'Connecting to trading services...',
    'Loading market data...',
    'Preparing your dashboard...',
    'Almost ready...',
];

export const WelcomeLoader: React.FC<WelcomeLoaderProps> = ({
    appReady = false,
    minimumDuration = 3200,
    maximumDuration = 6000,
    onComplete,
}) => {
    const config = useDomainLoaderConfig();
    const [isExiting, setIsExiting] = useState(false);

    const { progress } = useLoaderProgress({
        appReady,
        minimumDuration,
        maximumDuration,
    });

    useEffect(() => {
        const originalOverflow = document.body.style.overflow;
        const originalPosition = document.body.style.position;
        const originalWidth = document.body.style.width;

        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';

        return () => {
            document.body.style.overflow = originalOverflow;
            document.body.style.position = originalPosition;
            document.body.style.width = originalWidth;
        };
    }, []);

    const hasExitedRef = useRef(false);
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    useEffect(() => {
        if (progress >= 100 && !hasExitedRef.current) {
            hasExitedRef.current = true;
            setIsExiting(true);
            const exitTimer = window.setTimeout(() => onCompleteRef.current(), 550);
            return () => window.clearTimeout(exitTimer);
        }
    }, [progress]);

    const statusIndex = Math.min(BOOT_MESSAGES.length - 1, Math.floor((progress / 100) * BOOT_MESSAGES.length));

    const cssVariables = {
        '--welcome-accent': config.accentColor,
        '--welcome-primary': config.primaryColor,
        '--welcome-secondary': config.secondaryColor,
        '--welcome-background': config.backgroundColor,
    } as React.CSSProperties;

    return (
        <div className={`welcome-loader ${isExiting ? 'welcome-loader--exiting' : ''}`} style={cssVariables}>
            <div className='welcome-loader__bg' aria-hidden='true'>
                <div className='welcome-loader__grid' />
                <div className='welcome-loader__glow welcome-loader__glow--a' />
                <div className='welcome-loader__glow welcome-loader__glow--b' />
                <div className='welcome-loader__particles'>
                    {Array.from({ length: 24 }).map((_, index) => (
                        <span key={index} className='welcome-loader__particle' style={{ '--i': index } as React.CSSProperties} />
                    ))}
                </div>
            </div>

            <div className='welcome-loader__card'>
                <h1 className='welcome-loader__title'>{config.siteName}</h1>
                <p className='welcome-loader__subtitle'>{config.siteName} Trading Workspace</p>

                <div className='welcome-loader__dots' aria-hidden='true'>
                    <span className='welcome-loader__dot' />
                    <span className='welcome-loader__dot' />
                    <span className='welcome-loader__dot' />
                </div>

                <p className='welcome-loader__status'>{BOOT_MESSAGES[statusIndex]}</p>

                <div className='welcome-loader__progress-wrap'>
                    <div className='welcome-loader__progress-track'>
                        <div className='welcome-loader__progress-fill' style={{ width: `${progress}%` }} />
                    </div>
                    <div className='welcome-loader__progress-meta'>
                        <span>Boot sequence</span>
                        <span>{Math.round(progress)}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
