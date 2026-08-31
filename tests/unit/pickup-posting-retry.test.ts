import { describe, expect, it, vi } from "vitest";
import {
  isTransientDatabaseConnectionError,
  retryTransientDatabaseOperation,
} from "@/lib/admin/pickup-posting-retry";

describe("pickup posting database retry", () => {
  it("retries the production connection-timeout message and succeeds", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("timeout exceeded when trying to connect"))
      .mockResolvedValue("booked");
    const wait = vi.fn(async () => undefined);

    await expect(
      retryTransientDatabaseOperation(operation, { wait }),
    ).resolves.toBe("booked");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(500);
  });

  it("recognizes Prisma, Postgres and socket connection failures", () => {
    expect(isTransientDatabaseConnectionError({ code: "P2024" })).toBe(true);
    expect(isTransientDatabaseConnectionError({ code: "53300" })).toBe(true);
    expect(isTransientDatabaseConnectionError({ code: "ETIMEDOUT" })).toBe(true);
  });

  it("does not retry a business validation error", async () => {
    const operation = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error("Nedostaje uspešna MyGLS adresnica."));
    const wait = vi.fn(async () => undefined);

    await expect(
      retryTransientDatabaseOperation(operation, { wait }),
    ).rejects.toThrow("Nedostaje uspešna MyGLS adresnica.");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("stops after the configured number of attempts", async () => {
    const operation = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error("connection terminated unexpectedly"));

    await expect(
      retryTransientDatabaseOperation(operation, {
        attempts: 3,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("connection terminated unexpectedly");
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
