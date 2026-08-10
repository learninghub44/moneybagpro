import { ComponentProps } from 'react';
import { LegacyMenuHamburger1pxIcon } from '@/components/shared_ui/figma-icons/Legacy';
import './toggle-button.scss';

type TToggleButton = {
    onClick: ComponentProps<'button'>['onClick'];
};

// Hardcoded fill instead of var(--text-general) — that token was resolving to a
// near-invisible color against the header background in some themes (the same
// issue found on the account-switcher balance button), making the drawer hard
// to find. A dedicated background pill guarantees the tap target reads clearly
// regardless of what the surrounding header theme resolves to.
const ToggleButton = ({ onClick }: TToggleButton) => (
    <button className='mobile-menu-toggle-button' onClick={onClick} aria-label='Open menu'>
        <LegacyMenuHamburger1pxIcon iconSize='xs' fill='#ffffff' />
    </button>
);

export default ToggleButton;
