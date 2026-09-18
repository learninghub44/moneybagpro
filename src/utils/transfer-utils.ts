import { standalone_routes } from '@/components/shared/utils/routes/routes';
import { getInitialLanguage } from '@deriv-com/translations';
import { navigateToUrl } from './navigation-utils';

/**
 * Navigates to the transfer page with the specified currency and language parameters
 * @param currency The currency to use for the transfer
 */
export const navigateToTransfer = (currency: string): void => {
    try {
        // Get the base URL from standalone_routes
        const baseUrl = standalone_routes.transfer;

        // Get the current language
        const currentLanguage = getInitialLanguage();
        const lang_param = currentLanguage ? `&lang=${currentLanguage}` : '';

        // Generate the transfer URL with currency and language parameters
        const transferUrl = `${baseUrl}&curr=${currency}${lang_param}`;

        // Navigate to the transfer URL
        navigateToUrl(transferUrl, true);
    } catch (error) {
        console.error('Error navigating to transfer page:', error);
        // Fallback to the basic transfer URL
        navigateToUrl(standalone_routes.transfer, true);
    }
};

/**
 * Navigates to Deriv's own cashier deposit page. Third-party OAuth apps like
 * this one can't process deposits directly — Deriv handles all payment
 * methods, KYC, and compliance on their own cashier, so this hands off to it
 * rather than attempting to reimplement any of that here.
 */
export const navigateToDeposit = (): void => {
    try {
        const currentLanguage = getInitialLanguage();
        const lang_param = currentLanguage ? `?lang=${currentLanguage}` : '';
        navigateToUrl(`${standalone_routes.cashier_deposit}${lang_param}`, true);
    } catch (error) {
        console.error('Error navigating to deposit page:', error);
        navigateToUrl(standalone_routes.cashier_deposit, true);
    }
};
