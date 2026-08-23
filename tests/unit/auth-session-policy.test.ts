import { describe, expect, it } from "vitest";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  resolveAuthJwtMaxAge,
} from "@/lib/auth/session-policy";

describe("auth session lifetime", () => {
  it("keeps admin/remembered sessions for 90 days", () => {
    expect(resolveAuthJwtMaxAge(true)).toBe(90 * 24 * 60 * 60);
    expect(AUTH_COOKIE_MAX_AGE_SECONDS).toBe(90 * 24 * 60 * 60);
  });

  it("keeps ordinary customer sessions limited to 30 days", () => {
    expect(resolveAuthJwtMaxAge(false)).toBe(30 * 24 * 60 * 60);
    expect(resolveAuthJwtMaxAge(undefined)).toBe(30 * 24 * 60 * 60);
  });
});
