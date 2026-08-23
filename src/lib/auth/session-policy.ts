const DAY_SECONDS = 60 * 60 * 24;

export const AUTH_COOKIE_MAX_AGE_SECONDS = 90 * DAY_SECONDS;
export const AUTH_STANDARD_JWT_MAX_AGE_SECONDS = 30 * DAY_SECONDS;
export const AUTH_PERSISTENT_JWT_MAX_AGE_SECONDS = 90 * DAY_SECONDS;

export function resolveAuthJwtMaxAge(remember: boolean | undefined) {
  return remember
    ? AUTH_PERSISTENT_JWT_MAX_AGE_SECONDS
    : AUTH_STANDARD_JWT_MAX_AGE_SECONDS;
}
