import { createHash } from 'node:crypto';
import { newId } from '@plant-legacy/shared/ids';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import type { AccountsConfig } from './config.ts';

export interface Account {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: 'player' | 'admin';
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

export interface Session {
  id: string;
  accountId: string;
  refreshTokenHash: string;
  refreshTokenLookupHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RateLimitEntry {
  ipAddress: string;
  endpoint: string;
  attemptCount: number;
  windowStart: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
}

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export interface UsernameValidationResult {
  valid: boolean;
  errors: string[];
}

export interface DisplayNameValidationResult {
  valid: boolean;
  errors: string[];
}

export class AccountsService {
  private pool: Pool;
  private config: AccountsConfig;

  constructor(pool: Pool, config: AccountsConfig) {
    this.pool = pool;
    this.config = config;
  }

  async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(this.config.bcryptCost);
    return bcrypt.hash(password, salt);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }

  validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (password.length < this.config.passwordMinLength) {
      errors.push(`Password must be at least ${this.config.passwordMinLength} characters`);
    }
    if (password.length > this.config.passwordMaxLength) {
      errors.push(`Password must be at most ${this.config.passwordMaxLength} characters`);
    }
    if (this.config.passwordRequireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    if (this.config.passwordRequireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    if (this.config.passwordRequireDigit && !/[0-9]/.test(password)) {
      errors.push('Password must contain at least one digit');
    }
    if (
      this.config.passwordRequireSpecial &&
      !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
    ) {
      errors.push('Password must contain at least one special character');
    }

    return { valid: errors.length === 0, errors };
  }

  validateUsername(username: string): UsernameValidationResult {
    const errors: string[] = [];

    if (username.length < this.config.usernameMinLength) {
      errors.push(`Username must be at least ${this.config.usernameMinLength} characters`);
    }
    if (username.length > this.config.usernameMaxLength) {
      errors.push(`Username must be at most ${this.config.usernameMaxLength} characters`);
    }
    const allowedChars = new Set(this.config.usernameAllowedChars.split(''));
    for (const char of username) {
      if (!allowedChars.has(char)) {
        errors.push(`Username contains invalid character: '${char}'`);
        break;
      }
    }

    return { valid: errors.length === 0, errors };
  }

  validateDisplayName(displayName: string): DisplayNameValidationResult {
    const errors: string[] = [];

    if (displayName.length < this.config.displayNameMinLength) {
      errors.push(`Display name must be at least ${this.config.displayNameMinLength} character(s)`);
    }
    if (displayName.length > this.config.displayNameMaxLength) {
      errors.push(`Display name must be at most ${this.config.displayNameMaxLength} characters`);
    }
    // Basic sanitization - no control characters
    for (let i = 0; i < displayName.length; i++) {
      const code = displayName.charCodeAt(i);
      if (code <= 0x1f || code === 0x7f) {
        errors.push('Display name contains invalid characters');
        break;
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async checkRateLimit(
    ipAddress: string,
    endpoint: string,
    maxAttempts: number,
    windowMinutes: number,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

      // Atomic upsert: clean old entries, then upsert current window
      // If existing row is in current window, increment. If old window, reset to 1.
      const result = await client.query(
        `WITH cleaned AS (
           DELETE FROM rate_limits WHERE window_start < $1
         ),
         upserted AS (
           INSERT INTO rate_limits (ip_address, endpoint, attempt_count, window_start)
           VALUES ($2, $3, 1, NOW())
           ON CONFLICT (ip_address, endpoint) DO UPDATE
           SET attempt_count = CASE
               WHEN rate_limits.window_start >= $1 THEN rate_limits.attempt_count + 1
               ELSE 1
             END,
             window_start = NOW()
           RETURNING attempt_count
         )
         SELECT attempt_count FROM upserted`,
        [windowStart, ipAddress, endpoint],
      );

      const attemptCount = result.rows[0]?.attempt_count ?? 1;
      return attemptCount <= maxAttempts;
    } finally {
      client.release();
    }
  }

  async createAccount(
    username: string,
    displayName: string,
    password: string,
    ipAddress: string,
  ): Promise<{ account: Account; tokens: TokenPair } | { error: string }> {
    const usernameValidation = this.validateUsername(username);
    if (!usernameValidation.valid) {
      return { error: usernameValidation.errors.join(', ') };
    }

    const displayNameValidation = this.validateDisplayName(displayName);
    if (!displayNameValidation.valid) {
      return { error: displayNameValidation.errors.join(', ') };
    }

    const passwordValidation = this.validatePassword(password);
    if (!passwordValidation.valid) {
      return { error: passwordValidation.errors.join(', ') };
    }

    const allowed = await this.checkRateLimit(
      ipAddress,
      'signup',
      this.config.rateLimitSignupPerHour,
      60,
    );
    if (!allowed) {
      return { error: 'Too many sign-up attempts. Please try again later.' };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(`SELECT id FROM accounts WHERE username = $1`, [
        username,
      ]);
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return { error: 'Username already taken' };
      }

      const passwordHash = await this.hashPassword(password);
      const accountId = newId('account');
      const now = new Date();

      await client.query(
        `INSERT INTO accounts (id, username, display_name, password_hash, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'player', $5, $5)`,
        [accountId, username, displayName, passwordHash, now],
      );

      const tokens = this.generateTokenPair(accountId, 'player');

      const sessionId = newId('session');
      const refreshTokenHash = await this.hashPassword(tokens.refreshToken);
      const refreshTokenLookupHash = this.refreshTokenLookupHash(tokens.refreshToken);
      const refreshExpiresAt = new Date(
        Date.now() + this.config.refreshTokenLifetimeDays * 24 * 60 * 60 * 1000,
      );

      await client.query(
        `INSERT INTO sessions (id, account_id, refresh_token_hash, refresh_token_lookup_hash, ip_address, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sessionId,
          accountId,
          refreshTokenHash,
          refreshTokenLookupHash,
          ipAddress,
          now,
          refreshExpiresAt,
        ],
      );

      await client.query('COMMIT');

      const account: Account = {
        id: accountId,
        username,
        displayName,
        passwordHash,
        role: 'player',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };

      return { account, tokens };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async login(
    username: string,
    password: string,
    ipAddress: string,
    userAgent: string | null,
  ): Promise<{ account: Account; tokens: TokenPair } | { error: string }> {
    const allowed = await this.checkRateLimit(
      ipAddress,
      'login',
      this.config.rateLimitLoginPerMinute,
      1,
    );
    if (!allowed) {
      return { error: 'Too many login attempts. Please try again later.' };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(`SELECT * FROM accounts WHERE username = $1`, [username]);

      if (result.rows.length === 0) {
        await client.query('COMMIT');
        return { error: 'Invalid username or password' };
      }

      const accountRow = result.rows[0];
      const account: Account = {
        id: accountRow.id,
        username: accountRow.username,
        displayName: accountRow.display_name,
        passwordHash: accountRow.password_hash,
        role: accountRow.role,
        createdAt: accountRow.created_at,
        updatedAt: accountRow.updated_at,
        lastLoginAt: accountRow.last_login_at,
        failedLoginAttempts: accountRow.failed_login_attempts,
        lockedUntil: accountRow.locked_until,
      };

      if (account.lockedUntil && account.lockedUntil > new Date()) {
        // Account is locked - increment failed attempts to extend lockout
        const newFailedAttempts = account.failedLoginAttempts + 1;
        const extendedLockUntil = new Date(Date.now() + this.config.lockoutDurationMin * 60 * 1000);

        await client.query(
          `UPDATE accounts SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW() WHERE id = $3`,
          [newFailedAttempts, extendedLockUntil, account.id],
        );

        await client.query('COMMIT');
        return { error: 'Account temporarily locked due to too many failed attempts' };
      }

      const valid = await this.verifyPassword(password, account.passwordHash);
      if (!valid) {
        const newFailedAttempts = account.failedLoginAttempts + 1;
        let lockedUntil: Date | null = null;
        if (newFailedAttempts >= this.config.lockoutMaxFailedAttempts) {
          lockedUntil = new Date(Date.now() + this.config.lockoutDurationMin * 60 * 1000);
        }

        await client.query(
          `UPDATE accounts SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW() WHERE id = $3`,
          [newFailedAttempts, lockedUntil, account.id],
        );

        await client.query('COMMIT');
        return { error: 'Invalid username or password' };
      }

      await client.query(
        `UPDATE accounts SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [account.id],
      );

      const tokens = this.generateTokenPair(account.id, account.role);

      const sessionId = newId('session');
      const refreshTokenHash = await this.hashPassword(tokens.refreshToken);
      const refreshTokenLookupHash = this.refreshTokenLookupHash(tokens.refreshToken);
      const refreshExpiresAt = new Date(
        Date.now() + this.config.refreshTokenLifetimeDays * 24 * 60 * 60 * 1000,
      );

      await client.query(
        `INSERT INTO sessions (id, account_id, refresh_token_hash, refresh_token_lookup_hash, user_agent, ip_address, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sessionId,
          account.id,
          refreshTokenHash,
          refreshTokenLookupHash,
          userAgent,
          ipAddress,
          new Date(),
          refreshExpiresAt,
        ],
      );

      await this.enforceSessionLimit(account.id);

      await client.query('COMMIT');

      account.failedLoginAttempts = 0;
      account.lockedUntil = null;
      account.lastLoginAt = new Date();

      return { account, tokens };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(
    refreshToken: string,
    ipAddress: string,
  ): Promise<{ success: boolean } | { error: string }> {
    const allowed = await this.checkRateLimit(ipAddress, 'logout', 60, 1);
    if (!allowed) {
      return { error: 'Too many requests' };
    }

    const refreshTokenLookupHash = this.refreshTokenLookupHash(refreshToken);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE refresh_token_lookup_hash = $1`,
        [refreshTokenLookupHash],
      );

      await client.query('COMMIT');
      if (result.rowCount === 0) {
        return { error: 'Invalid refresh token' };
      }
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async refreshTokens(
    refreshToken: string,
    ipAddress: string,
  ): Promise<TokenPair | { error: string }> {
    const allowed = await this.checkRateLimit(
      ipAddress,
      'refresh',
      this.config.rateLimitRefreshPerMinute,
      1,
    );
    if (!allowed) {
      return { error: 'Too many refresh attempts' };
    }

    const refreshTokenLookupHash = this.refreshTokenLookupHash(refreshToken);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT s.*, a.role FROM sessions s
         JOIN accounts a ON s.account_id = a.id
         WHERE s.refresh_token_lookup_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()`,
        [refreshTokenLookupHash],
      );

      if (result.rows.length === 0) {
        await client.query('COMMIT');
        return { error: 'Invalid or expired refresh token' };
      }

      const session = result.rows[0];

      const tokens = this.generateTokenPair(session.account_id, session.role);

      const newSessionId = newId('session');
      const newRefreshTokenHash = await this.hashPassword(tokens.refreshToken);
      const newRefreshTokenLookupHash = this.refreshTokenLookupHash(tokens.refreshToken);
      const newRefreshExpiresAt = new Date(
        Date.now() + this.config.refreshTokenLifetimeDays * 24 * 60 * 60 * 1000,
      );

      await client.query(
        `INSERT INTO sessions (id, account_id, refresh_token_hash, refresh_token_lookup_hash, user_agent, ip_address, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          newSessionId,
          session.account_id,
          newRefreshTokenHash,
          newRefreshTokenLookupHash,
          session.user_agent,
          ipAddress,
          new Date(),
          newRefreshExpiresAt,
        ],
      );

      await client.query(`UPDATE sessions SET revoked_at = NOW() WHERE id = $1`, [session.id]);

      await this.enforceSessionLimit(session.account_id);

      await client.query('COMMIT');

      return tokens;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyAccessToken(
    token: string,
  ): Promise<{ accountId: string; role: string } | { error: string }> {
    try {
      const decoded = jwt.verify(token, this.getJwtSecret(), {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        algorithms: [this.config.jwtAlgorithm],
      }) as { sub: string; role: string };

      return { accountId: decoded.sub, role: decoded.role };
    } catch (_error) {
      return { error: 'Invalid or expired access token' };
    }
  }

  async getAccountById(accountId: string): Promise<Account | null> {
    const result = await this.pool.query(`SELECT * FROM accounts WHERE id = $1`, [accountId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
      failedLoginAttempts: row.failed_login_attempts,
      lockedUntil: row.locked_until,
    };
  }

  async changeDisplayName(
    accountId: string,
    newDisplayName: string,
  ): Promise<Account | { error: string }> {
    const validation = this.validateDisplayName(newDisplayName);
    if (!validation.valid) {
      return {
        error: validation.errors.join(', '),
      };
    }

    const result = await this.pool.query(
      `UPDATE accounts SET display_name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newDisplayName, accountId],
    );

    if (result.rows.length === 0) return { error: 'Account not found' };

    const row = result.rows[0];
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
      failedLoginAttempts: row.failed_login_attempts,
      lockedUntil: row.locked_until,
    };
  }

  private generateTokenPair(accountId: string, role: string): TokenPair {
    const accessTokenExpiresAt = Date.now() + this.config.accessTokenLifetimeMin * 60 * 1000;
    const refreshTokenExpiresAt =
      Date.now() + this.config.refreshTokenLifetimeDays * 24 * 60 * 60 * 1000;

    const accessToken = jwt.sign({ sub: accountId, role }, this.getJwtSecret(), {
      algorithm: this.config.jwtAlgorithm,
      issuer: this.config.jwtIssuer,
      audience: this.config.jwtAudience,
      expiresIn: `${this.config.accessTokenLifetimeMin}m`,
    });

    const refreshToken = jwt.sign({ sub: accountId, type: 'refresh' }, this.getJwtSecret(), {
      algorithm: this.config.jwtAlgorithm,
      issuer: this.config.jwtIssuer,
      audience: this.config.jwtAudience,
      expiresIn: `${this.config.refreshTokenLifetimeDays}d`,
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    };
  }

  private getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET environment variable is required in production');
      }
      // Local dev fallback - log a warning
      console.warn(
        '[WARN] JWT_SECRET not set, using insecure default. Set JWT_SECRET in production.',
      );
      return 'dev-secret-change-in-production';
    }
    return secret;
  }

  private refreshTokenLookupHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async enforceSessionLimit(accountId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id FROM sessions WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY created_at ASC`,
      [accountId],
    );

    if (result.rows.length > this.config.sessionMaxPerAccount) {
      const toRevoke = result.rows.length - this.config.sessionMaxPerAccount;
      const idsToRevoke = result.rows.slice(0, toRevoke).map((r) => r.id);
      await this.pool.query(`UPDATE sessions SET revoked_at = NOW() WHERE id = ANY($1)`, [
        idsToRevoke,
      ]);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
