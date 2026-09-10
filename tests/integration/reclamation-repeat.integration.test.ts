import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReclamationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createAdminReclamation,
  createGuestReclamation,
  createReclamation,
  getGuestOrderForReclamation,
  listOrdersForReclamation,
} from "@/lib/api/reclamations";

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => null }));

const tag = `REK-REPEAT-${Date.now()}-${process.pid}`;
const token = `${tag}-token-0123456789`;
const orderIds: string[] = [];
let userId: string;

beforeAll(async () => {
  const user = await db.user.create({ data: { email: `${tag}@example.invalid` } });
  userId = user.id;
});

afterAll(async () => {
  const cases = await db.reclamation.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  for (const row of cases) {
    await db.backgroundJob.deleteMany({ where: { payload: { path: ["reclamationId"], equals: row.id } } });
  }
  await db.reclamation.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.fiscalReceipt.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});

async function fixture(suffix: string, guest = false) {
  const accessToken = `${token}-${suffix}`;
  const order = await db.order.create({
    data: {
      number: `${tag}-${suffix}`,
      userId: guest ? null : userId,
      guestEmail: guest ? `${tag}.guest@example.invalid` : null,
      publicAccessTokenHash: createHash("sha256").update(accessToken).digest("base64url"),
      status: "ISPORUCENO",
      subtotal: 2000, total: 2000, shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA",
      shipFirstName: "Test", shipLastName: "Kupac", shipPhone: "+381641112223",
      shipStreet: "Test 1", shipCity: "Beograd", shipPostalCode: "11000", termsAcceptedAt: new Date(),
      items: { create: ["A", "B"].map((sku) => ({
        sku: `${tag}-${sku}`, name: `Artikal ${sku}`, qty: 1, unitPriceFull: 1000, unitPriceSale: 1000,
      })) },
    },
    include: { items: true },
  });
  orderIds.push(order.id);
  return { ...order, accessToken };
}

function input(order: { number: string }, sku: string) {
  return { orderNumberOrFiscal: order.number, sku, quantity: 1, description: "Nova prijava problema sa artiklom.", photos: [] };
}

describe("ponovne reklamacije", () => {
  it.each(["admin", "customer", "guest"] as const)("%s accepts repeats for every previous status and exposes history", async (channel) => {
    const order = await fixture(channel, channel === "guest");
    const data = input(order, order.items[0].sku);
    const submit = () => channel === "admin" ? createAdminReclamation(data, "test-admin")
      : channel === "guest" ? createGuestReclamation(data, order.accessToken) : createReclamation(data, userId);
    let previous = await submit();
    expect(previous.ok).toBe(true);
    const statuses: ReclamationStatus[] = ["PRIMLJENO", "U_OBRADI", "RESENO", "ODBIJENO"];
    for (const status of statuses) {
      if (!previous.ok) throw new Error("Submission failed");
      await db.reclamation.update({ where: { id: previous.id }, data: { status } });
      const next = await submit();
      expect(next.ok).toBe(true);
      if (!next.ok) throw new Error("Repeat failed");
      expect(next.number).not.toBe(previous.number);
      previous = next;
    }
    const options = channel === "guest"
      ? await getGuestOrderForReclamation(order.number, order.accessToken)
      : (await listOrdersForReclamation(userId)).find((row) => row.number === order.number);
    const item = options?.items.find((row) => row.sku === data.sku);
    expect(item?.purchasedQty).toBe(1);
    expect(item?.reclamations).toHaveLength(5);
    expect(item?.reclamations.map((row) => row.status)).toEqual(expect.arrayContaining(statuses));
    expect(await db.orderItem.findUnique({ where: { id: order.items[0].id } })).toMatchObject({ reclamationCount: 5 });
  });

  it("allocates across different SKUs, including simultaneous mixed-channel submissions and legacy gaps", async () => {
    const order = await fixture("parallel");
    const first = await createAdminReclamation(input(order, order.items[0].sku), "test-admin");
    expect(first).toMatchObject({ ok: true, number: `R-1-${order.number}` });
    if (!first.ok) throw new Error("First submission failed");
    await db.reclamation.update({ where: { id: first.id }, data: { number: `R-9-${order.number}` } });
    const results = await Promise.all([
      createAdminReclamation(input(order, order.items[1].sku), "test-admin"),
      createReclamation(input(order, order.items[0].sku), userId),
      createReclamation(input(order, order.items[1].sku), userId),
    ]);
    expect(results.every((row) => row.ok)).toBe(true);
    expect(results.map((row) => row.ok && row.number).sort()).toEqual(
      [10, 11, 12].map((n) => `R-${n}-${order.number}`).sort(),
    );
    expect(await db.reclamation.findUnique({ where: { id: first.id } })).toMatchObject({ number: `R-9-${order.number}` });
    expect(await db.reclamationStatusEvent.count({ where: { reclamation: { orderId: order.id } } })).toBe(4);
    for (const quantity of [0, -1, 1.5, 2, 1000]) {
      expect(await createAdminReclamation({ ...input(order, order.items[0].sku), quantity }, "test-admin"))
        .toEqual({ ok: false, reason: "QUANTITY_EXCEEDED" });
    }
    expect(await db.reclamation.count({ where: { orderId: order.id } })).toBe(4);
    const next = await createReclamation(input(order, order.items[0].sku), userId);
    expect(next).toMatchObject({ ok: true, number: `R-13-${order.number}` });
  });

  it("uses the same sequence when submitted by fiscal receipt or order number", async () => {
    const order = await fixture("fiscal");
    const receiptNumber = `${tag}-receipt`;
    await db.fiscalReceipt.create({ data: { orderId: order.id, receiptNumber } });
    expect(await createReclamation({ ...input(order, order.items[0].sku), orderNumberOrFiscal: receiptNumber }, userId))
      .toMatchObject({ ok: true, number: `R-1-${order.number}` });
    expect(await createReclamation(input(order, order.items[1].sku), userId))
      .toMatchObject({ ok: true, number: `R-2-${order.number}` });
  });

  it("still rejects access to another customer's order or a wrong guest token", async () => {
    const customer = await fixture("private");
    const guest = await fixture("private-guest", true);
    expect(await createReclamation(input(customer, customer.items[0].sku), "another-user"))
      .toEqual({ ok: false, reason: "UNAUTHORIZED" });
    expect(await createGuestReclamation(input(guest, guest.items[0].sku), "wrong-token"))
      .toEqual({ ok: false, reason: "UNAUTHORIZED" });
    expect(await getGuestOrderForReclamation(guest.number, "wrong-token")).toBeNull();
  });
});
