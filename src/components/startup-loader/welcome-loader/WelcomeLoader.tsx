import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDomainLoaderConfig } from '../useDomainLoaderConfig';
import { useLoaderProgress } from '../useLoaderProgress';
import { useTypingEffect } from './useTypingEffect';
import './WelcomeLoader.scss';

interface WelcomeLoaderProps {
    appReady?: boolean;
    minimumDuration?: number;
    maximumDuration?: number;
    onComplete: () => void;
}

const BACKGROUND_IMAGE_URL =
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1920&q=80';

const STATUS_MESSAGES = [
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
    const [imageLoaded, setImageLoaded] = useState(false);

    const phrases = useMemo(
        () => ['Welcome, Trader', 'Trade With Confidence', `Powered by ${config.siteName}`, 'Master The Markets'],
        [config.siteName]
    );

    const { text: typedText } = useTypingEffect({ phrases, pauseDuration: 1500 });

    const { progress } = useLoaderProgress({
        appReady,
        minimumDuration,
        maximumDuration,
    });

    useEffect(() => {
        const img = new Image();
        img.src = BACKGROUND_IMAGE_URL;
        img.onload = () => setImageLoaded(true);
        // Fall back gracefully even if the image fails to load
        img.onerror = () => setImageLoaded(true);
    }, []);

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

    const statusIndex = Math.min(STATUS_MESSAGES.length - 1, Math.floor((progress / 100) * STATUS_MESSAGES.length));

    const cssVariables = {
        '--welcome-accent': config.accentColor,
        '--welcome-primary': config.primaryColor,
        '--welcome-secondary': config.secondaryColor,
        '--welcome-background': config.backgroundColor,
    } as React.CSSProperties;

    return (
        <div
            className={`welcome-loader ${isExiting ? 'welcome-loader--exiting' : ''} ${
                imageLoaded ? 'welcome-loader--image-loaded' : ''
            }`}
            style={cssVariables}
        >
            <div className='welcome-loader__bg' style={{ backgroundImage: `url(${BACKGROUND_IMAGE_URL})` }} />
            <div className='welcome-loader__overlay' />
            <div className='welcome-loader__vignette' />

            <div className='welcome-loader__content'>
                <div className='welcome-loader__brand'>{config.siteName}</div>

                <h1 className='welcome-loader__headline'>
                    <span>{typedText}</span>
                    <span className='welcome-loader__cursor' aria-hidden='true' />
                </h1>

                <p className='welcome-loader__subtitle'>{config.subtitle}</p>

                <div className='welcome-loader__progress-wrap'>
                    <div className='welcome-loader__progress-track'>
                        <div className='welcome-loader__progress-fill' style={{ width: `${progress}%` }} />
                    </div>
                    <div className='welcome-loader__progress-meta'>
                        <span className='welcome-loader__status'>{STATUS_MESSAGES[statusIndex]}</span>
                        <span className='welcome-loader__percent'>{Math.round(progress)}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
