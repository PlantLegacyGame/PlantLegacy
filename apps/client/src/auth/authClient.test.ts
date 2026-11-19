import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accessTokenExpiresAt,
  describeAuthError,
  ensureFreshSession,
  type FetchLike,
  refreshSession,
  signIn,
  signOut,
  signUp,
} from './authClient.ts';

function fakeJwt(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds }), 'utf8').toString('base64url');
  return `header.${payload}.signature`;
}

interface Recorded {
  url: string;
  body: Record<string, unknown>;
}

function makeFetch(
  response: { ok?: boolean; status?: number; payload: unknown },
  calls: Recorded[] = [],
): FetchLike {
  return async (url, init) => {
    calls.push({ url, body: JSON.parse(init?.body ?? '{}') });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.payload,
    };
  };
}

describe('authClient', () => {
  it('signs in and reads camelCase tokens and display name', async () => {
    const calls: Recorded[] = [];
    const session = await signIn(
      makeFetch(
        {
          payload: {
            success: true,
            accessToken: 'a',
            refreshToken: 'r',
            account: { displayName: 'Fern', username: 'fern' },
          },
        },
        calls,
      ),
      'http://localhost:8080',
      { username: 'fern', password: 'Secret123' },
    );

    assert.deepEqual(session, {
      accessToken: 'a',
      refreshToken: 'r',
      displayName: 'Fern',
      username: 'fern',
    });
    assert.equal(calls[0].url, 'http://localhost:8080/auth/login');
    assert.deepEqual(calls[0].body, { username: 'fern', password: 'Secret123' });
  });

  it('accepts snake_case tokens too', async () => {
    const session = await signUp(
      makeFetch({
        payload: { access_token: 'a2', refresh_token: 'r2', account: { display_name: 'Moss' } },
      }),
      '',
      { username: 'moss', displayName: 'Moss', password: 'Secret123' },
    );
    assert.equal(session.accessToken, 'a2');
    assert.equal(session.refreshToken, 'r2');
    assert.equal(session.displayName, 'Moss');
  });

  it('turns an error payload into readable text', async () => {
    const failing = makeFetch({
      ok: false,
      status: 401,
      payload: { success: false, error: 'invalid_credentials' },
    });
    await assert.rejects(
      () => signIn(failing, '', { username: 'x', password: 'y' }),
      /Wrong username or password/,
    );
  });

  it('rejects a response that carries no tokens', async () => {
    await assert.rejects(
      () => signIn(makeFetch({ payload: { success: true } }), '', { username: 'x', password: 'y' }),
      /auth_response_missing_tokens/,
    );
  });

  it('never throws from logout, even when the server refuses', async () => {
    const failing = makeFetch({ ok: false, status: 500, payload: { error: 'boom' } });
    await signOut(failing, '', 'refresh-token');
  });

  it('reads the expiry from a JWT and reports unusable tokens as null', () => {
    assert.equal(accessTokenExpiresAt(fakeJwt(1_700_000_000)), 1_700_000_000_000);
    assert.equal(accessTokenExpiresAt('not-a-jwt'), null);
    assert.equal(accessTokenExpiresAt(undefined), null);
    assert.equal(accessTokenExpiresAt('a.b'), null);
  });

  it('refreshes only when the access token is expired or about to expire', async () => {
    const expiresAt = 1_700_000_000;
    const token = fakeJwt(expiresAt);
    const calls: Recorded[] = [];
    const fetchImpl = makeFetch({ payload: { accessToken: 'new', refreshToken: 'newr' } }, calls);

    const fresh = await ensureFreshSession(
      fetchImpl,
      '',
      { accessToken: token, refreshToken: 'r' },
      expiresAt * 1000 - 10 * 60_000,
    );
    assert.equal(fresh?.accessToken, token);
    assert.equal(calls.length, 0, 'a valid token is used as-is');

    const refreshed = await ensureFreshSession(
      fetchImpl,
      '',
      { accessToken: token, refreshToken: 'r' },
      expiresAt * 1000 - 30_000,
    );
    assert.equal(refreshed?.accessToken, 'new');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/auth/refresh');
  });

  it('falls back to anonymous when refresh fails or no session exists', async () => {
    const failing = makeFetch({ ok: false, status: 401, payload: { error: 'invalid_token' } });
    assert.equal(
      await ensureFreshSession(failing, '', { refreshToken: 'stale' }, Date.now()),
      null,
      'a rejected refresh means anonymous',
    );
    assert.equal(await ensureFreshSession(failing, '', null, Date.now()), null);
    assert.equal(await ensureFreshSession(failing, '', {}, Date.now()), null);
  });

  it('refreshes when only a refresh token is stored', async () => {
    const fetchImpl = makeFetch({ payload: { accessToken: 'a', refreshToken: 'r' } });
    const session = await ensureFreshSession(fetchImpl, '', { refreshToken: 'r' }, 0);
    assert.equal(session?.accessToken, 'a');
  });

  it('explains common server error codes', () => {
    assert.match(describeAuthError('username_taken'), /already taken/);
    assert.match(describeAuthError('account_locked'), /Too many failed/);
    assert.equal(describeAuthError('weird_code'), 'weird code');
    assert.equal(describeAuthError(undefined), 'Something went wrong.');
  });

  it('refreshes through the documented endpoint', async () => {
    const calls: Recorded[] = [];
    const session = await refreshSession(
      makeFetch({ payload: { accessToken: 'a', refreshToken: 'r' } }, calls),
      '',
      'old-refresh',
    );
    assert.equal(session.accessToken, 'a');
    assert.deepEqual(calls[0].body, { refreshToken: 'old-refresh' });
  });
});
