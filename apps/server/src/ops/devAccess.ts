/**
 * Who may use the dev tools (D01).
 *
 * The old gate was one line — `process.env.NODE_ENV ?? 'local'` — and that is the
 * loose end this file closes. A server that forgot to set `NODE_ENV` reported
 * itself as `local`, so every player who connected had the whole dev surface:
 * weather, the world clock, tile resources, plant regeneration, config writes.
 * Now the environment must be one the config says dev belongs in, and outside
 * `local` the account must actually be a dev.
 *
 * Two separate questions, deliberately kept separate:
 *
 *  - `resolveDevEnvironment` — is this deployment a place dev tools may exist at
 *    all? Used by the `/dev/*` HTTP endpoints, which have no player identity.
 *  - `resolveDevAccess` — may *this player* use them here? Used by `DEV_ACTION`.
 *
 * A "local" run stays open to everyone on it: it is the developer's own machine,
 * and requiring an account to test a build would be worse than the risk. Hosting
 * a local run on a network other people can reach is the one case that exposes
 * it, and that is a deployment decision this file makes visible: drop `local`
 * from `ops.dev_allowed_environments` and the tools need an admin account.
 */

export const DEFAULT_DEV_ALLOWED_ENVIRONMENTS: readonly string[] = ['local'];

export type DevEnvironmentReason = 'ok' | 'environment';

export interface DevEnvironmentDecision {
  allowed: boolean;
  reason: DevEnvironmentReason;
}

/** May this deployment expose dev tools at all? */
export function resolveDevEnvironment(
  environment: string,
  allowedEnvironments: readonly string[] = DEFAULT_DEV_ALLOWED_ENVIRONMENTS,
): DevEnvironmentDecision {
  const list =
    allowedEnvironments.length > 0 ? allowedEnvironments : DEFAULT_DEV_ALLOWED_ENVIRONMENTS;
  if (list.includes(environment)) return { allowed: true, reason: 'ok' };
  return { allowed: false, reason: 'environment' };
}

export type DevAccessReason = 'ok' | 'environment' | 'not_admin';

export interface DevAccessDecision {
  allowed: boolean;
  reason: DevAccessReason;
}

export interface DevAccessInput {
  /** The deployment's environment: `runtime.nodeEnv`, never `process.env` directly. */
  environment: string;
  /** Environments where dev tools may exist. */
  allowedEnvironments: readonly string[];
  /** Account ids allowed to use dev tools outside `local`. */
  adminAccounts: readonly string[];
  /** Verified account id, absent for an anonymous connection. */
  accountId?: string;
  /** Verified account role from the access token. */
  role?: string;
  /** True when this is a genuinely local run, where dev stays open. */
  openLocally?: boolean;
}

export function resolveDevAccess(input: DevAccessInput): DevAccessDecision {
  const environment = resolveDevEnvironment(input.environment, input.allowedEnvironments);
  if (!environment.allowed) return { allowed: false, reason: 'environment' };

  // `local` is the developer's machine: a shared box, but a trusted one. Every
  // other allowed environment needs a real dev behind the connection.
  if (input.environment === 'local' && input.openLocally !== false) {
    return { allowed: true, reason: 'ok' };
  }

  if (input.role === 'admin') return { allowed: true, reason: 'ok' };
  if (input.accountId && input.adminAccounts.includes(input.accountId)) {
    return { allowed: true, reason: 'ok' };
  }
  return { allowed: false, reason: 'not_admin' };
}
