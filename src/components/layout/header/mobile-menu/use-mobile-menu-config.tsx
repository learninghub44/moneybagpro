import { ComponentProps, ReactNode, useMemo } from 'react';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import RootStore from '@/stores/root-store';
import { getDomainConfig } from '@/components/shared';
import { LegacyLogout1pxIcon, LegacyTheme1pxIcon } from '@/components/shared_ui/figma-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import { ToggleSwitch } from '@deriv-com/ui';

type TMenuIconProps = { className?: string; width?: number; height?: number };

const WhatsAppMenuIcon = ({ className, width = 16, height = 16 }: TMenuIconProps) => (
    <svg className={className} width={width} height={height} viewBox='0 0 24 24' aria-hidden='true'>
        <path
            fill='#25d366'
            d='M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z'
        />
        <path
            fill='#25d366'
            d='M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.85.5 3.58 1.37 5.07L2 22l5.19-1.46a9.87 9.87 0 0 0 4.85 1.27h.005c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.02h-.004a8.1 8.1 0 0 1-4.13-1.13l-.297-.176-3.083.868.822-3.005-.193-.308a8.08 8.08 0 0 1-1.24-4.36c0-4.47 3.638-8.11 8.126-8.11 2.17 0 4.21.846 5.744 2.383a8.06 8.06 0 0 1 2.377 5.734c0 4.47-3.638 8.107-8.122 8.107Z'
        />
    </svg>
);

const TelegramMenuIcon = ({ className, width = 16, height = 16 }: TMenuIconProps) => (
    <svg className={className} width={width} height={height} viewBox='0 0 24 24' aria-hidden='true'>
        <path
            fill='#26a5e4'
            d='M21.94 4.6 18.6 20.36c-.25 1.12-.9 1.4-1.83.87l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.16 9.39-8.49c.41-.36-.09-.57-.63-.2L6.02 13.1l-5.02-1.57c-1.09-.34-1.11-1.09.23-1.61L20.6 3.06c.91-.33 1.7.22 1.34 1.54Z'
        />
    </svg>
);

export type TSubmenuSection = 'accountSettings' | 'cashier' | 'reports';

//IconTypes
type TMenuConfig = {
    LeftComponent: React.ElementType;
    RightComponent?: ReactNode;
    as: 'a' | 'button';
    href?: string;
    label: ReactNode;
    onClick?: () => void;
    removeBorderBottom?: boolean;
    submenu?: TSubmenuSection;
    target?: ComponentProps<'a'>['target'];
    isActive?: boolean;
}[];

const useMobileMenuConfig = (
    client?: RootStore['client'],
    onLogout?: () => void,
    enableThemeToggle: boolean = true
) => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();

    const menuConfig = useMemo((): TMenuConfig[] => {
        return [
            [
                // ========================================
                // CUSTOM MENU ITEMS PLACEHOLDER
                // ========================================
                //
                // Add your custom menu items here.
                //
                // EXAMPLE:
                // {
                //     as: 'a',
                //     label: localize('Your Page'),
                //     LeftComponent: YourIcon,
                //     href: '/your-page',
                // },
                //
                // For desktop menu items, see:
                // src/components/layout/header/header-config.tsx

                // Conditionally include theme toggle based on brand config
                enableThemeToggle && {
                    as: 'button',
                    label: localize('Dark theme'),
                    LeftComponent: LegacyTheme1pxIcon,
                    RightComponent: <ToggleSwitch value={is_dark_mode_on} onChange={toggleTheme} />,
                },
            ].filter(Boolean) as TMenuConfig,
            [
                client?.is_logged_in &&
                    onLogout && {
                        as: 'button',
                        label: localize('Log out'),
                        LeftComponent: LegacyLogout1pxIcon,
                        onClick: onLogout,
                        removeBorderBottom: true,
                    },
            ].filter(Boolean) as TMenuConfig,
            // WhatsApp/Telegram community links — shown as proper labeled rows
            // (not just small footer icons) so they're actually noticeable inside
            // the app, not just on the marketing landing page.
            (() => {
                const { whatsapp, telegram } = getDomainConfig().ui.socialLinks ?? {};
                return [
                    whatsapp && {
                        as: 'a' as const,
                        label: localize('Join our WhatsApp community'),
                        LeftComponent: WhatsAppMenuIcon,
                        href: whatsapp,
                        target: '_blank' as const,
                    },
                    telegram && {
                        as: 'a' as const,
                        label: localize('Join our Telegram community'),
                        LeftComponent: TelegramMenuIcon,
                        href: telegram,
                        target: '_blank' as const,
                        removeBorderBottom: true,
                    },
                ].filter(Boolean) as TMenuConfig;
            })(),
        ].filter(section => section.length > 0);
    }, [
        client,
        onLogout,
        is_dark_mode_on,
        toggleTheme,
        localize,
        enableThemeToggle, // [AI] Added to recalculate menu when theme toggle config changes
    ]);

    // [AI] Check if menu has any items to determine if mobile menu should be shown
    const hasMenuItems = menuConfig.some(section => section.length > 0);
    // [/AI]

    return {
        config: menuConfig,
        // [AI] Return flag indicating if menu has any items
        hasMenuItems,
        // [/AI]
    };
};

export default useMobileMenuConfig;
