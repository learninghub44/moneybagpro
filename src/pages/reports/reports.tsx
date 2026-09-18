import { standalone_routes } from '@/components/shared/utils/routes/routes';
import './reports.scss';

type TReportLink = { description: string; href: string; title: string };

const REPORT_LINKS: TReportLink[] = [
    {
        description: 'Contracts that are still running right now.',
        href: standalone_routes.positions,
        title: 'Open Positions',
    },
    {
        description: 'Wins and losses for every settled contract, with filters by date and market.',
        href: standalone_routes.profit,
        title: 'Profit Table',
    },
    {
        description: 'Every transaction on your account — deposits, withdrawals, and trades.',
        href: standalone_routes.statement,
        title: 'Statement',
    },
];

const Reports = () => (
    <div className='reports-page'>
        <div className='reports__card'>
            <h2 className='reports__title'>Reports</h2>
            <p className='reports__subtitle'>
                These open on Deriv&apos;s own account reports — the same data your account statement and profit
                table are built from, so it always matches what Deriv shows you directly.
            </p>

            <div className='reports__links'>
                {REPORT_LINKS.map(link => (
                    <a className='reports__link-card' href={link.href} key={link.title} rel='noreferrer' target='_blank'>
                        <span className='reports__link-title'>{link.title}</span>
                        <span className='reports__link-description'>{link.description}</span>
                        <span className='reports__link-arrow'>Open in new tab →</span>
                    </a>
                ))}
            </div>

            <a className='reports__all-link' href={standalone_routes.reports} rel='noreferrer' target='_blank'>
                Open full Reports section on Deriv →
            </a>
        </div>
    </div>
);

export default Reports;
