// Shows the current white-labeled site's own brand name, colored with its domain palette
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { getDomainUIConfig } from '@/components/shared/utils/config/config';
import './app-logo.scss';

export const AppLogo = () => {
    const { isDesktop } = useDevice();

    // Only render on desktop screens
    if (!isDesktop) return null;

    const brandName = getDomainUIConfig().brandName || 'Deriv Bot';

    return (
        <a href='/' className='app-header__logo' aria-label={localize('Home')}>
            <span className='brand-name-text'>{brandName}</span>
        </a>
    );
};
