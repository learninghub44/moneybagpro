import type { CSSProperties } from 'react';
import { getDerivSignupUrl, getDomainConfig } from '@/components/shared';
import RiskDisclaimerFloating from '@/components/risk-disclaimer-floating';
import './landing.scss';

const TRUST_BADGES = ['Free to use', 'Your own Deriv account', 'No card required'];

const FEATURES = [
    {
        tag: 'BUILD',
        title: 'Drag-and-drop bot builder',
        description: 'Snap blocks together to define entry rules, stakes, and stop conditions — no code required.',
    },
    {
        tag: 'BOTS',
        title: '60+ free bots',
        description: 'Load a ready-made strategy straight into the builder and see exactly how it works before you run it.',
    },
    {
        tag: 'SIGNALS',
        title: 'Live digits & charts',
        description: 'Watch the same tick stream your bots trade on — even/odd, over/under, rise/fall — in real time.',
    },
    {
        tag: 'CONTROL',
        title: 'Your account, your rules',
        description: 'Every trade runs on your own Deriv account. Nothing executes without a strategy you approved first.',
    },
];

const STEPS = [
    {
        step: '01',
        title: 'Create your Deriv account',
        description: 'Free, and takes about two minutes. Your funds stay with Deriv — we never touch them directly.',
    },
    {
        step: '02',
        title: 'Load or build a bot',
        description: 'Pick a free strategy from the library, or drag your own together in the visual builder.',
    },
    {
        step: '03',
        title: 'Run it and watch the ticks',
        description: 'Start the bot, track every trade live, and stop it any time — you stay in control throughout.',
    },
];

// A sample of real strategy names pulled from the bot library, used for the
// scrolling preview strip below the hero. Duplicated once for a seamless loop.
const BOT_PREVIEWS = [
    'Even/Odd Digit Bot',
    'Over/Under Speed Bot',
    'Rise & Fall Momentum',
    'Double Under Bot',
    'Percentage Over Bot',
    'Matches/Differs Scanner',
];

// Interim testimonial copy — appreciation-toned, no specific profit/return
// claims (kept vague on purpose for compliance reasons). Swap each entry for
// a real quote as they come in from Telegram/WhatsApp.
const TESTIMONIALS = [
    {
        initials: 'JK',
        quote: 'The bot builder is so much easier than I expected. I set up my first strategy in one evening and it just runs in the background now.',
        name: 'James K.',
        role: 'Nairobi',
        rating: 5,
    },
    {
        initials: 'AM',
        quote: 'What I like most is how clean the dashboard is. I can see exactly what my bots are doing without digging through menus.',
        name: 'Amina M.',
        role: 'Mombasa',
        rating: 5,
    },
    {
        initials: 'DO',
        quote: 'Support actually responds fast when I have a question. That alone makes it worth sticking with this platform.',
        name: 'David O.',
        role: 'Kisumu',
        rating: 5,
    },
    {
        initials: 'FW',
        quote: 'Switching between my accounts used to be a hassle. Now everything is in one place and I can check all my bots at a glance.',
        name: 'Faith W.',
        role: 'Eldoret',
        rating: 5,
    },
    {
        initials: 'SM',
        quote: 'I appreciate that the platform is straightforward. No clutter, no confusing settings, just what I need to run my strategies.',
        name: 'Samuel M.',
        role: 'Nakuru',
        rating: 5,
    },
    {
        initials: 'GN',
        quote: 'Been using this for a few months now and it has been reliable. Uptime is good and I rarely run into issues.',
        name: 'Grace N.',
        role: 'Kisii',
        rating: 5,
    },
];

const Landing = () => {
    const domain_config = getDomainConfig();
    const signup_url = getDerivSignupUrl();
    const brand_name = domain_config.ui.brandName;

    return (
        <div className='landing' style={{ '--landing-accent': domain_config.ui.primaryColor } as CSSProperties}>
            <header className='landing__header'>
                <div className='landing__brand'>
                    {domain_config.ui.logoUrl ? (
                        <img className='landing__logo' src={domain_config.ui.logoUrl} alt={brand_name} />
                    ) : (
                        <span className='landing__brand-name'>{brand_name}</span>
                    )}
                </div>
                <a className='landing__link' href='/app'>
                    Launch platform
                </a>
            </header>

            <section className='landing__hero'>
                <div className='landing__trust-row'>
                    {TRUST_BADGES.map(badge => (
                        <span className='landing__trust-badge' key={badge}>
                            <svg viewBox='0 0 16 16' width='14' height='14' aria-hidden='true'>
                                <path
                                    d='M13.5 4.5 6.5 11.5 2.5 7.5'
                                    fill='none'
                                    stroke='currentColor'
                                    strokeWidth='1.8'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                />
                            </svg>
                            {badge}
                        </span>
                    ))}
                </div>
                <h1 className='landing__hero-title'>
                    Automate your trades.
                    <br />
                    Watch the ticks work.
                </h1>
                <p className='landing__hero-subtitle'>
                    {brand_name} is a free, visual bot builder for Deriv — load a ready-made strategy or build your
                    own, then let it trade on your rules while you watch every tick live.
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
                    <a className='landing__cta landing__cta--secondary' href='/app'>
                        Explore the platform
                    </a>
                </div>
                <p className='landing__hero-note'>
                    New to Deriv? Signing up through the link above costs you nothing extra and helps keep{' '}
                    {brand_name} free.
                </p>
            </section>

            <div className='landing__carousel' aria-hidden='true'>
                <div className='landing__carousel-track'>
                    {[...BOT_PREVIEWS, ...BOT_PREVIEWS].map((name, i) => (
                        <span className='landing__carousel-chip' key={i}>
                            {name}
                        </span>
                    ))}
                </div>
            </div>

            <section className='landing__features'>
                <span className='landing__eyebrow'>Platform</span>
                <h2 className='landing__section-title'>Everything you need, built in</h2>
                <div className='landing__feature-grid'>
                    {FEATURES.map(feature => (
                        <div className='landing__feature-card' key={feature.title}>
                            <span className='landing__feature-tag'>{feature.tag}</span>
                            <h3 className='landing__feature-title'>{feature.title}</h3>
                            <p className='landing__feature-description'>{feature.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className='landing__testimonials'>
                <span className='landing__eyebrow'>Reviews</span>
                <h2 className='landing__section-title'>What traders are saying</h2>
                <div className='landing__testimonial-track'>
                    {TESTIMONIALS.map(t => (
                        <div className='landing__testimonial-card' key={t.name}>
                            <span className='landing__testimonial-avatar'>{t.initials}</span>
                            <p className='landing__testimonial-quote'>&ldquo;{t.quote}&rdquo;</p>
                            <p className='landing__testimonial-name'>{t.name}</p>
                            <p className='landing__testimonial-role'>{t.role}</p>
                            <div className='landing__testimonial-stars' aria-label={`${t.rating} out of 5 stars`}>
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <span key={i} className={i < t.rating ? 'is-filled' : ''}>
                                        ★
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className='landing__steps'>
                <span className='landing__eyebrow'>Getting started</span>
                <h2 className='landing__section-title'>How it works</h2>
                <div className='landing__steps-grid'>
                    {STEPS.map(item => (
                        <div className='landing__step' key={item.step}>
                            <span className='landing__step-number'>{item.step}</span>
                            <h3 className='landing__step-title'>{item.title}</h3>
                            <p className='landing__step-description'>{item.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className='landing__cta-band'>
                <h2>Ready to see it trade?</h2>
                <p>Open a free Deriv account, then jump into {brand_name} and run your first bot in minutes.</p>
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
