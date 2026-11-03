import { type ConfigFile, readBoolean, readInteger, readString } from '@plant-legacy/shared/config';

export interface AccountsConfig {
  accessTokenLifetimeMin: number;
  refreshTokenLifetimeDays: number;
  passwordMinLength: number;
  passwordMaxLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireDigit: boolean;
  passwordRequireSpecial: boolean;
  usernameMinLength: number;
  usernameMaxLength: number;
  usernameAllowedChars: string;
  rateLimitSignupPerHour: number;
  rateLimitLoginPerMinute: number;
  rateLimitRefreshPerMinute: number;
  lockoutMaxFailedAttempts: number;
  lockoutDurationMin: number;
  argon2TimeCost: number;
  argon2MemoryCostKib: number;
  argon2Parallelism: number;
  jwtAlgorithm: 'HS256' | 'RS256';
  jwtIssuer: string;
  jwtAudience: string;
  displayNameMinLength: number;
  displayNameMaxLength: number;
  sessionMaxPerAccount: number;
}

export function loadAccountsConfig(configs: Map<string, ConfigFile>): AccountsConfig {
  return {
    accessTokenLifetimeMin: readInteger(configs, 'accounts', 'access_token_lifetime_min'),
    refreshTokenLifetimeDays: readInteger(configs, 'accounts', 'refresh_token_lifetime_days'),
    passwordMinLength: readInteger(configs, 'accounts', 'password_min_length'),
    passwordMaxLength: readInteger(configs, 'accounts', 'password_max_length'),
    passwordRequireUppercase: readBoolean(configs, 'accounts', 'password_require_uppercase'),
    passwordRequireLowercase: readBoolean(configs, 'accounts', 'password_require_lowercase'),
    passwordRequireDigit: readBoolean(configs, 'accounts', 'password_require_digit'),
    passwordRequireSpecial: readBoolean(configs, 'accounts', 'password_require_special'),
    usernameMinLength: readInteger(configs, 'accounts', 'username_min_length'),
    usernameMaxLength: readInteger(configs, 'accounts', 'username_max_length'),
    usernameAllowedChars: readString(configs, 'accounts', 'username_allowed_chars'),
    rateLimitSignupPerHour: readInteger(configs, 'accounts', 'rate_limit_signup_per_hour'),
    rateLimitLoginPerMinute: readInteger(configs, 'accounts', 'rate_limit_login_per_minute'),
    rateLimitRefreshPerMinute: readInteger(configs, 'accounts', 'rate_limit_refresh_per_minute'),
    lockoutMaxFailedAttempts: readInteger(configs, 'accounts', 'lockout_max_failed_attempts'),
    lockoutDurationMin: readInteger(configs, 'accounts', 'lockout_duration_min'),
    argon2TimeCost: readInteger(configs, 'accounts', 'argon2_time_cost'),
    argon2MemoryCostKib: readInteger(configs, 'accounts', 'argon2_memory_cost_kib'),
    argon2Parallelism: readInteger(configs, 'accounts', 'argon2_parallelism'),
    jwtAlgorithm: readString(configs, 'accounts', 'jwt_algorithm') as 'HS256' | 'RS256',
    jwtIssuer: readString(configs, 'accounts', 'jwt_issuer'),
    jwtAudience: readString(configs, 'accounts', 'jwt_audience'),
    displayNameMinLength: readInteger(configs, 'accounts', 'display_name_min_length'),
    displayNameMaxLength: readInteger(configs, 'accounts', 'display_name_max_length'),
    sessionMaxPerAccount: readInteger(configs, 'accounts', 'session_max_per_account'),
  };
}
