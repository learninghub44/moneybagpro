import { useEffect, useState } from 'react';
import { getDomainConfig } from '@/components/shared';
import './chunk-loader.scss';

// Loading phrases cycle underneath the main status message to keep the
// screen feeling alive during longer waits (e.g. first-time chunk fetches).
const LOADING_PHRASES = ['Connecting to Deriv...', 'Loading free bots...', 'Preparing your workspace...'];

// There's no real progress signal for a dynamic import(), so this is a
// perceived-performance device (same pattern GitHub/Medium use): it climbs
// quickly at first and eases off, but never claims 100% until the real
// content actually mounts and this component unmounts.
const useSimulatedProgress = () => {
    const [progress, setProgress] = useState(4);

    useEffect(() => {
        const timer = setInterval(() => {
            setProgress(prev => {
                if (prev >= 92) return prev;
                const step = prev < 50 ? 6 : prev < 80 ? 3 : 1;
                return Math.min(prev + step, 92);
            });
        }, 220);
        return () => clearInterval(timer);
    }, []);

    return progress;
};

export default function ChunkLoader({ message }: { message: string }) {
    const progress = useSimulatedProgress();
    const [phrase_index, setPhraseIndex] = useState(0);
    const brand_name = getDomainConfig().ui.brandName;

    useEffect(() => {
        const timer = setInterval(() => {
            setPhraseIndex(prev => (prev + 1) % LOADING_PHRASES.length);
        }, 1600);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className='chunk-loader'>
            <div className='chunk-loader__radar' aria-hidden='true'>
                <span className='chunk-loader__ring chunk-loader__ring--1' />
                <span className='chunk-loader__ring chunk-loader__ring--2' />
                <span className='chunk-loader__ring chunk-loader__ring--3' />
                <span className='chunk-loader__percent'>{progress}%</span>
            </div>

            <h1 className='chunk-loader__brand'>{brand_name}</h1>

            {message && <p className='chunk-loader__message'>{message}</p>}

            <div className='chunk-loader__bar-track'>
                <div className='chunk-loader__bar-fill' style={{ width: `${progress}%` }} />
            </div>

            <p className='chunk-loader__phrase'>{LOADING_PHRASES[phrase_index]}</p>
        </div>
    );
}
