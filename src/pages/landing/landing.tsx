import type { CSSProperties } from 'react';
import { getDerivSignupUrl, getDomainConfig } from '@/components/shared';
import RiskDisclaimerFloating from '@/components/risk-disclaimer-floating';
import './landing.scss';

const FEATURES = [
    {
        emoji: '\u{1F916}',
        title: 'Drag-and-drop bot builder',
        description: 'Build automated trading strategies visually — no coding required. Start from scratch or a quick strategy.',
    },
    {
        emoji: '\u{26A1}',
        title: 'Free curated bots',
        description: 'Load ready-made, community-tested strategies straight into the builder and start running them in minutes.',
    },
    {
        emoji: '\u{1F4C8}',
        title: 'Live charts & signals',
        description: 'Track real-time price action, digits, and market signals without leaving the platform.',
    },
    {
        emoji: '\u{1F512}',
        title: 'Your account, your control',
        description: 'Trades run on your own Deriv account. We never hold your funds or place trades without your say-so.',
    },
];

const Landing = () => {
    const domain_config = getDomainConfig();
    const signup_url = getDerivSignupUrl();
    const brand_name = domain_config.ui.brandName;

    return (
        <div className='landing' style={{ '--landing-primary': domain_config.ui.primaryColor } as CSSProperties}>
            <header className='landing__header'>
                <div className='landing__brand'>
                    {domain_config.ui.logoUrl ? (
                        <img className='landing__logo' src={domain_config.ui.logoUrl} alt={brand_name} />
                    ) : (
                        <span className='landing__brand-name'>{brand_name}</span>
                    )}
                </div>
                <div className='landing__header-actions'>
                    <a className='landing__link' href='/'>
                        Launch platform
                    </a>
                </div>
            </header>

            <section className='landing__hero'>
                <h1 className='landing__hero-title'>Automate your trades with {brand_name}</h1>
                <p className='landing__hero-subtitle'>
                    Build, run, and manage automated Deriv trading strategies without writing a single line of code —
                    free bots, live charts, and a visual builder, all in one place.
                </p>
                <div className='landing__hero-actions'>
                    <a
                        className='landing__cta landing__cta--primary'
                        href={signup_url}
                        target='_blank'
                        rel='noopener noreferrer'
                    >
                        Create your free Deriv account
                    </a>
                    <a className='landing__cta landing__cta--secondary' href='/'>
                        Explore the platform
                    </a>
                </div>
                <p className='landing__hero-note'>
                    New to Deriv? Creating an account through the link above costs you nothing extra and helps support{' '}
                    {brand_name}.
                </p>
            </section>

            <section className='landing__features'>
                {FEATURES.map(feature => (
                    <div className='landing__feature-card' key={feature.title}>
                        <span className='landing__feature-emoji'>{feature.emoji}</span>
                        <h3 className='landing__feature-title'>{feature.title}</h3>
                        <p className='landing__feature-description'>{feature.description}</p>
                    </div>
                ))}
            </section>

            <section className='landing__cta-band'>
                <h2>Ready to start trading smarter?</h2>
                <p>Open a free Deriv account, then jump into {brand_name} to build your first bot.</p>
                <a
                    className='landing__cta landing__cta--primary'
                    href={signup_url}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    Get started free
                </a>
            </section>

            <footer className='landing__footer'>
                <p>
                    {brand_name} provides tools to build and run trading strategies on Deriv. Trading involves risk of
                    loss and may not be suitable for everyone. Past performance of any strategy or bot does not
                    guarantee future results.
                </p>
            </footer>

            <RiskDisclaimerFloating />
        </div>
    );
};

export default Landing;
