import { getDomainConfig } from '@/components/shared';

type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({ className = '', width, height, fill }: TBrandLogoProps) => {
    const domain_config = getDomainConfig();
    const { brandName, logoUrl } = domain_config.ui;

    if (logoUrl) {
        return (
            <img
                src={logoUrl}
                alt={brandName}
                className={className}
                style={{
                    display: 'block',
                    maxWidth: width ? `${width}px` : '100%',
                    height: height ? `${height}px` : 'auto',
                }}
            />
        );
    }

    return (
        <span
            className={className}
            style={{
                display: 'block',
                fontWeight: 700,
                fontSize: '1.6rem',
                lineHeight: 1,
                color: fill || 'inherit',
                whiteSpace: 'nowrap',
            }}
        >
            {brandName}
        </span>
    );
};
