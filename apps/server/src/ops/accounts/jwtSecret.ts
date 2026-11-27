/**
 * `JWT_SECRET` is the only thing standing between a signed token and a forged
 * admin role. The old fallback was allowed in every environment except
 * production, which left a shared staging server using a secret published in
 * this repository. Only local/test may use it.
 */
export const DEV_JWT_SECRET = 'dev-secret-change-in-production';
export const MIN_JWT_SECRET_LENGTH = 32;

const LOCAL_ENVIRONMENTS = new Set(['local', 'test']);

export function isLocalEnvironment(nodeEnv: string | undefined): boolean {
  return LOCAL_ENVIRONMENTS.has(nodeEnv ?? 'local');
}

export function resolveJwtSecret(nodeEnv: string | undefined, secret: string | undefined): string {
  const value = secret ?? '';
  if (value.length >= MIN_JWT_SECRET_LENGTH) return value;
  if (isLocalEnvironment(nodeEnv) && value.length === 0) return DEV_JWT_SECRET;

  const environment = nodeEnv ?? 'local';
  throw new Error(
    `JWT_SECRET must be set to at least ${MIN_JWT_SECRET_LENGTH} characters when NODE_ENV=${environment}`,
  );
}
