import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountsService } from './service.ts';

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

export interface SignUpRequest {
  username: string;
  displayName: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken: string;
}

export interface ChangeDisplayNameRequest {
  displayName: string;
}

export interface AuthResponse {
  success: boolean;
  account?: {
    id: string;
    username: string;
    displayName: string;
    role: string;
  };
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
  error?: string;
}

export function createAccountsHandlers(accountsService: AccountsService): {
  handleSignup: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleLogin: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleRefresh: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleLogout: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleChangeDisplayName: (
    req: IncomingMessage,
    res: ServerResponse,
    accountId: string,
  ) => Promise<void>;
} {
  function getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function getUserAgent(req: IncomingMessage): string | null {
    return req.headers['user-agent'] ?? null;
  }

  async function readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  async function handleSignup(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    const ip = getClientIp(req);
    let body: SignUpRequest;
    try {
      body = (await readBody(req)) as SignUpRequest;
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }

    if (!body.username || !body.displayName || !body.password) {
      sendJson(res, 400, { error: 'username, displayName, and password are required' });
      return;
    }

    const result = await accountsService.createAccount(
      body.username,
      body.displayName,
      body.password,
      ip,
    );

    if ('error' in result) {
      sendJson(res, 400, { success: false, error: result.error });
      return;
    }

    const { account, tokens } = result;
    sendJson(res, 201, {
      success: true,
      account: {
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        role: account.role,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    });
  }

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);
    let body: LoginRequest;
    try {
      body = (await readBody(req)) as LoginRequest;
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }

    if (!body.username || !body.password) {
      sendJson(res, 400, { error: 'username and password are required' });
      return;
    }

    const result = await accountsService.login(body.username, body.password, ip, userAgent);

    if ('error' in result) {
      sendJson(res, 401, { success: false, error: result.error });
      return;
    }

    const { account, tokens } = result;
    sendJson(res, 200, {
      success: true,
      account: {
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        role: account.role,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    });
  }

  async function handleRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    const ip = getClientIp(req);
    let body: RefreshRequest;
    try {
      body = (await readBody(req)) as RefreshRequest;
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }

    if (!body.refreshToken) {
      sendJson(res, 400, { error: 'refreshToken is required' });
      return;
    }

    const result = await accountsService.refreshTokens(body.refreshToken, ip);

    if ('error' in result) {
      sendJson(res, 401, { success: false, error: result.error });
      return;
    }

    sendJson(res, 200, {
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
    });
  }

  async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    const ip = getClientIp(req);
    let body: LogoutRequest;
    try {
      body = (await readBody(req)) as LogoutRequest;
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }

    if (!body.refreshToken) {
      sendJson(res, 400, { error: 'refreshToken is required' });
      return;
    }

    await accountsService.logout(body.refreshToken, ip);
    sendJson(res, 200, { success: true });
  }

  async function handleChangeDisplayName(
    req: IncomingMessage,
    res: ServerResponse,
    accountId: string,
  ): Promise<void> {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    let body: ChangeDisplayNameRequest;
    try {
      body = (await readBody(req)) as ChangeDisplayNameRequest;
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }

    if (!body.displayName) {
      sendJson(res, 400, { error: 'displayName is required' });
      return;
    }

    const result = await accountsService.changeDisplayName(accountId, body.displayName);

    if ('error' in result) {
      sendJson(res, 400, { success: false, error: result.error });
      return;
    }

    sendJson(res, 200, {
      success: true,
      account: {
        id: result.id,
        username: result.username,
        displayName: result.displayName,
        role: result.role,
      },
    });
  }

  return {
    handleSignup,
    handleLogin,
    handleRefresh,
    handleLogout,
    handleChangeDisplayName,
  };
}

export function createAuthMiddleware(accountsService: AccountsService) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      sendJson(res, 401, { error: 'missing_or_invalid_authorization_header' });
      return;
    }

    const token = authHeader.slice(7);
    const result = await accountsService.verifyAccessToken(token);

    if ('error' in result) {
      sendJson(res, 401, { error: result.error });
      return;
    }

    (req as IncomingMessage & { accountId?: string; accountRole?: string }).accountId =
      result.accountId;
    (req as IncomingMessage & { accountId?: string; accountRole?: string }).accountRole =
      result.role;
    next();
  };
}
