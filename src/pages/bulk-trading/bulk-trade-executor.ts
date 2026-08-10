import { getDomainConfig } from '@/components/shared';
import { getSymbolRequestField } from '@/external/bot-skeleton/services/api/legacy-request';
import { buyContractForUi, normalizeTradeParameters } from '@/utils/trade-purchase';

const LEGACY_WS_SERVER = 'wss://ws.derivws.com/websockets/v3';
const RESPONSE_TIMEOUT_MS = 15000;

export type TLinkedAccount = {
    loginid: string;
    token: string;
    currency?: string;
    is_virtual?: boolean;
};

export type TBulkTradeParameters = {
    symbol: string;
    contract_type: string;
    duration: number;
    duration_unit: string;
    stake: number;
    barrier?: string;
};

export type TBulkTradeResult = {
    loginid: string;
    ok: boolean;
    message: string;
    buy_price?: number;
    payout?: number;
    contract_id?: number;
};

/**
 * Reads the linked-accounts token map that Deriv's OAuth redirect stores in
 * localStorage (loginid -> token), and pairs it with the friendlier account
 * metadata also stored there, so the caller gets a usable, labeled list of
 * every account the current browser session has tokens for.
 */
export const getLinkedAccounts = (): TLinkedAccount[] => {
    try {
        const accounts_list = JSON.parse(localStorage.getItem('accountsList') ?? '{}') as Record<string, string>;
        const client_accounts = JSON.parse(localStorage.getItem('clientAccounts') ?? '{}') as Record<
            string,
            { currency?: string; is_virtual?: boolean }
        >;

        return Object.entries(accounts_list)
            .filter(([, token]) => !!token)
            .map(([loginid, token]) => ({
                loginid,
                token,
                currency: client_accounts[loginid]?.currency,
                is_virtual: client_accounts[loginid]?.is_virtual,
            }));
    } catch {
        return [];
    }
};

const getLegacySocketURL = () => {
    const { appId } = getDomainConfig();
    return `${LEGACY_WS_SERVER}?app_id=${encodeURIComponent(appId)}`;
};

/**
 * Sends a single request/response pair over a plain WebSocket and resolves
 * with the parsed response, matched by `req_id`. Used to run a short-lived,
 * independent connection per linked account for bulk execution — this is
 * deliberately separate from the app's single shared `api_base` connection
 * so bulk trading can never disturb the account the user is actively
 * viewing elsewhere in the app.
 */
const sendOnSocket = (socket: WebSocket, request: Record<string, unknown>): Promise<any> => {
    const req_id = Math.floor(Math.random() * 1_000_000_000);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.removeEventListener('message', onMessage);
            reject(new Error('Request timed out.'));
        }, RESPONSE_TIMEOUT_MS);

        const onMessage = (event: MessageEvent) => {
            let data: any;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            if (data.req_id !== req_id) return;

            clearTimeout(timeout);
            socket.removeEventListener('message', onMessage);
            resolve(data);
        };

        socket.addEventListener('message', onMessage);
        socket.send(JSON.stringify({ ...request, req_id }));
    });
};

const openSocket = (): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
        const socket = new WebSocket(getLegacySocketURL());
        const timeout = setTimeout(() => {
            socket.close();
            reject(new Error('Connection timed out.'));
        }, RESPONSE_TIMEOUT_MS);

        socket.onopen = () => {
            clearTimeout(timeout);
            resolve(socket);
        };
        socket.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Could not connect.'));
        };
    });

const buildTradeRequestParameters = (trade: TBulkTradeParameters, webSocketURL?: string) => {
    // Mode 1 (executeTradeOnAccount) always connects over its own dedicated
    // legacy socket (LEGACY_WS_SERVER, /websockets/v3), independent of
    // whatever connection type the main app session happens to be using
    // right now — that call passes LEGACY_WS_SERVER explicitly. Mode 2
    // (runBulkTradesOnActiveAccount) instead sends over the main app's own
    // live connection via buyContractForUi, so it must NOT be forced to
    // legacy — it leaves webSocketURL undefined and lets
    // getSymbolRequestField fall back to whatever that connection actually
    // is. Without this distinction, forcing legacy everywhere would send
    // { symbol } to a modern PKCE-flow connection that expects
    // { underlying_symbol }, breaking Mode 2 the same way omitting it
    // entirely was breaking Mode 1.
    const symbol_field = getSymbolRequestField(trade.symbol, webSocketURL);

    return normalizeTradeParameters({
        ...symbol_field,
        contract_type: trade.contract_type,
        duration: trade.duration,
        duration_unit: trade.duration_unit,
        amount: trade.stake,
        basis: 'stake',
        barrier: trade.barrier || undefined,
    });
};

/**
 * Runs one trade on one account, over its own short-lived WebSocket
 * connection authorized with that account's own token. Never touches the
 * app's shared session.
 */
export const executeTradeOnAccount = async (
    account: TLinkedAccount,
    trade: TBulkTradeParameters
): Promise<TBulkTradeResult> => {
    let socket: WebSocket | undefined;

    try {
        socket = await openSocket();

        const auth_response = await sendOnSocket(socket, { authorize: account.token });
        if (auth_response.error) {
            return { loginid: account.loginid, ok: false, message: auth_response.error.message || 'Authorization failed.' };
        }

        const parameters = buildTradeRequestParameters(trade, LEGACY_WS_SERVER);
        const proposal_response = await sendOnSocket(socket, { proposal: 1, ...parameters });
        if (proposal_response.error) {
            return { loginid: account.loginid, ok: false, message: proposal_response.error.message || 'Could not get a price.' };
        }

        const proposal = proposal_response.proposal;
        const ask_price = Number(proposal?.ask_price ?? trade.stake);

        const buy_response = await sendOnSocket(socket, { buy: proposal.id, price: ask_price });
        if (buy_response.error) {
            return { loginid: account.loginid, ok: false, message: buy_response.error.message || 'Purchase failed.' };
        }

        const buy = buy_response.buy;
        return {
            loginid: account.loginid,
            ok: true,
            message: 'Purchased.',
            buy_price: Number(buy?.buy_price),
            payout: Number(buy?.payout),
            contract_id: buy?.contract_id,
        };
    } catch (error) {
        return { loginid: account.loginid, ok: false, message: error instanceof Error ? error.message : 'Unknown error.' };
    } finally {
        socket?.close();
    }
};

/**
 * Mode 1: fire the same trade across several of the user's own linked
 * accounts, in parallel, each over its own connection.
 */
export const runBulkTradeAcrossAccounts = async (
    accounts: TLinkedAccount[],
    trade: TBulkTradeParameters
): Promise<TBulkTradeResult[]> => Promise.all(accounts.map(account => executeTradeOnAccount(account, trade)));

/**
 * Mode 2: fire several different trades on the single account the user is
 * currently authorized on in the main app. Reuses the same purchase path as
 * Manual Trading (`buyContractForUi`) so behaviour — proposal, balance
 * checks, error messages — stays identical to a normal single trade.
 */
export const runBulkTradesOnActiveAccount = async (
    trades: (TBulkTradeParameters & { id: string })[]
): Promise<Record<string, { ok: boolean; message: string }>> => {
    const entries = await Promise.all(
        trades.map(async trade => {
            try {
                const parameters = buildTradeRequestParameters(trade);
                await buyContractForUi({ parameters, price: trade.stake, source: 'Bulk Trading' });
                return [trade.id, { ok: true, message: 'Purchased.' }] as const;
            } catch (error) {
                return [trade.id, { ok: false, message: error instanceof Error ? error.message : 'Unknown error.' }] as const;
            }
        })
    );

    return Object.fromEntries(entries);
};
