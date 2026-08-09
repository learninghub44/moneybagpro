import { useEffect, useRef, useState } from 'react';

interface UseTypingEffectOptions {
    phrases: string[];
    typingSpeed?: number;
    deletingSpeed?: number;
    pauseDuration?: number;
    loop?: boolean;
}

/**
 * Cycles through a list of phrases with a classic type -> pause -> delete rhythm.
 */
export function useTypingEffect({
    phrases,
    typingSpeed = 55,
    deletingSpeed = 30,
    pauseDuration = 1400,
    loop = true,
}: UseTypingEffectOptions) {
    const [displayedText, setDisplayedText] = useState('');
    const [phraseIndex, setPhraseIndex] = useState(0);
    const [isDeleting, setIsDeleting] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!phrases.length) return;

        const currentPhrase = phrases[phraseIndex % phrases.length];
        const isLastPhrase = phraseIndex === phrases.length - 1;

        const tick = () => {
            if (!isDeleting) {
                const next = currentPhrase.slice(0, displayedText.length + 1);
                setDisplayedText(next);

                if (next === currentPhrase) {
                    if (!loop && isLastPhrase) return;
                    timeoutRef.current = setTimeout(() => setIsDeleting(true), pauseDuration);
                    return;
                }
                timeoutRef.current = setTimeout(tick, typingSpeed);
            } else {
                const next = currentPhrase.slice(0, displayedText.length - 1);
                setDisplayedText(next);

                if (next === '') {
                    setIsDeleting(false);
                    setPhraseIndex(prev => (prev + 1) % phrases.length);
                    return;
                }
                timeoutRef.current = setTimeout(tick, deletingSpeed);
            }
        };

        timeoutRef.current = setTimeout(tick, isDeleting ? deletingSpeed : typingSpeed);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayedText, isDeleting, phraseIndex, phrases]);

    return { text: displayedText, isDeleting };
}
