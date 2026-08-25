import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { allocateXExpressTrackingCode } from "@/lib/x-express/code";

beforeEach(async () => {
  Object.assign(process.env, {
    X_EXPRESS_CODE_PREFIX: "AAA",
    X_EXPRESS_CODE_RANGE_START: "850300001",
    X_EXPRESS_CODE_RANGE_END: "850300020",
  });
  await db.courierCodeSequence.deleteMany({ where: { provider: "X_EXPRESS" } });
});

afterEach(async () => {
  await db.courierCodeSequence.deleteMany({ where: { provider: "X_EXPRESS" } });
});

describe("X Express code allocation", () => {
  it("advances a legacy sequence past the provider-invalid ...0000 code", async () => {
    await db.courierCodeSequence.create({
      data: {
        provider: "X_EXPRESS",
        prefix: "AAA",
        rangeStart: 850300000,
        rangeEnd: 850599999,
        nextValue: 850300000,
      },
    });

    const allocated = await db.$transaction((tx) =>
      allocateXExpressTrackingCode(tx),
    );
    expect(allocated).toMatchObject({
      value: 850300001,
      trackingNo: "AAA0850300001",
    });
    const sequence = await db.courierCodeSequence.findFirstOrThrow({
      where: { provider: "X_EXPRESS", prefix: "AAA" },
    });
    expect(sequence).toMatchObject({
      rangeStart: 850300001,
      rangeEnd: 850300020,
      nextValue: 850300002,
    });
  });

  it("allocates unique sequential codes under concurrent transactions", async () => {
    const allocations = await Promise.all(
      Array.from({ length: 20 }, () =>
        db.$transaction((tx) => allocateXExpressTrackingCode(tx)),
      ),
    );
    const values = allocations.map((item) => item.value).sort((a, b) => a - b);
    expect(values).toEqual(
      Array.from({ length: 20 }, (_, index) => 850300001 + index),
    );
    expect(new Set(allocations.map((item) => item.trackingNo)).size).toBe(20);

    await expect(
      db.$transaction((tx) => allocateXExpressTrackingCode(tx)),
    ).rejects.toThrow(/opseg kodova je potrošen/);
  });
});
