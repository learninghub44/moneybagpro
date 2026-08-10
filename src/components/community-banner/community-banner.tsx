import './community-banner.scss';

type CommunityBannerProps = {
    whatsapp?: string;
    telegram?: string;
    brandName?: string;
    /** 'bar' = slim full-width strip (landing page). 'card' = compact rounded
     *  card (in-app placements). 'ticker' = scrolling marquee strip for the
     *  top of the in-app dashboard — visually distinct from 'bar' so the two
     *  never get confused with each other. */
    variant?: 'bar' | 'card' | 'ticker';
    className?: string;
};

const WhatsAppIcon = () => (
    <svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true'>
        <path
            fill='currentColor'
            d='M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z'
        />
        <path
            fill='currentColor'
            d='M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.85.5 3.58 1.37 5.07L2 22l5.19-1.46a9.87 9.87 0 0 0 4.85 1.27h.005c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.02h-.004a8.1 8.1 0 0 1-4.13-1.13l-.297-.176-3.083.868.822-3.005-.193-.308a8.08 8.08 0 0 1-1.24-4.36c0-4.47 3.638-8.11 8.126-8.11 2.17 0 4.21.846 5.744 2.383a8.06 8.06 0 0 1 2.377 5.734c0 4.47-3.638 8.107-8.122 8.107Z'
        />
    </svg>
);

const TelegramIcon = () => (
    <svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true'>
        <path
            fill='currentColor'
            d='M21.94 4.6 18.6 20.36c-.25 1.12-.9 1.4-1.83.87l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.16 9.39-8.49c.41-.36-.09-.57-.63-.2L6.02 13.1l-5.02-1.57c-1.09-.34-1.11-1.09.23-1.61L20.6 3.06c.91-.33 1.7.22 1.34 1.54Z'
        />
    </svg>
);

/**
 * Promotional strip inviting visitors to join the brand's WhatsApp/Telegram
 * community. Fully domain-driven: renders only the links present in
 * `domain_config.ui.socialLinks`, and renders nothing at all if neither is
 * set — so it's safe to drop into every white-label site right away and
 * fill in each domain's real invite link later, one at a time.
 */
const CommunityBanner = ({ whatsapp, telegram, brandName, variant = 'bar', className }: CommunityBannerProps) => {
    if (!whatsapp && !telegram) return null;

    const links = (
        <span className='community-banner__links'>
            {whatsapp && (
                <a
                    className='community-banner__link community-banner__link--whatsapp'
                    href={whatsapp}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    <WhatsAppIcon />
                    WhatsApp
                </a>
            )}
            {telegram && (
                <a
                    className='community-banner__link community-banner__link--telegram'
                    href={telegram}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    <TelegramIcon />
                    Telegram
                </a>
            )}
        </span>
    );

    const text = (
        <span className='community-banner__text'>
            <span className='community-banner__badge' aria-hidden='true'>
                ⚡
            </span>
            Join {brandName ? `the ${brandName}` : 'our'} community for signals &amp; updates
        </span>
    );

    if (variant === 'ticker') {
        // Duplicate the content once so the marquee can scroll from 0% to
        // -50% and loop seamlessly (CSS-only, no JS measuring/animation).
        const item = (
            <span className='community-banner__ticker-item'>
                {text}
                {links}
            </span>
        );
        return (
            <div
                className={`community-banner community-banner--ticker${className ? ` ${className}` : ''}`}
                role='note'
                aria-label='Community links'
            >
                <div className='community-banner__ticker-track'>
                    {item}
                    {item}
                </div>
            </div>
        );
    }

    return (
        <div className={`community-banner community-banner--${variant}${className ? ` ${className}` : ''}`}>
            {text}
            {links}
        </div>
    );
};

export default CommunityBanner;
