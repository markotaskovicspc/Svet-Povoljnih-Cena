import { expect, it, vi } from "vitest";
import { linkExistingProductVariant, propagateProductFamilySharedData } from "@/lib/product-family.server";
const version = "2026-09-19T10:00:00.000Z";
function fixture() {
  const source = { id: "m", sku: "110126", name: "NANOTECH M", sizeLabel: "M", slug: "m", updatedAt: new Date(version), familyMembership: { familyId: "fm", label: "M, crna", family: { code: "110126", _count: { members: 1 } } } };
  const target = { id: "s", sku: "110127", name: "NANOTECH S", sizeLabel: "S", slug: "s", updatedAt: new Date(version), familyMembership: { familyId: "fs", colorHex: "#000000", storefrontEnabled: true, family: { code: "110127", _count: { members: 1 } } } };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    product: { findUniqueOrThrow: vi.fn().mockImplementation(({ where }) => where.id === "m" ? source : target), update: vi.fn() },
    productFamily: { update: vi.fn(), upsert: vi.fn().mockResolvedValue({ id: "fm", primaryProductId: "m" }), delete: vi.fn(), findUnique: vi.fn().mockResolvedValue({ primaryProductId: "m", members: [{ productId: "m" }, { productId: "s" }] }) },
    productFamilyMember: { findUnique: vi.fn().mockResolvedValue({ familyId: "fs" }), findFirst: vi.fn().mockImplementation(({ select }) => select.position ? { position: 0 } : null), upsert: vi.fn().mockResolvedValue({ familyId: "fm", productId: "s" }), count: vi.fn().mockResolvedValue(0) },
  };
  return { source, target, tx, input: { sourceId: "m", targetId: "s", sourceVersion: version, targetVersion: version, label: "S, crna" } };
}
it("links two existing singleton families without writing either product's data", async () => {
  const { tx, input, target } = fixture();
  const result = await linkExistingProductVariant(tx as never, input);
  expect(result.familyId).toBe("fm"); expect(result.duplicate).toBe(false);
  expect(tx.product.update).not.toHaveBeenCalled();
  expect(target.name).toBe("NANOTECH S"); expect(target.sizeLabel).toBe("S");
  expect(tx.productFamily.update).toHaveBeenCalledWith({ where: { id: "fm" }, data: { preserveVariantData: true } });
  expect(tx.productFamilyMember.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ familyId: "fm", label: "S, crna", storefrontEnabled: true }) }));
  expect(tx.productFamily.delete).toHaveBeenCalledExactlyOnceWith({ where: { id: "fs" } });
});
it("rejects a stale preview or an archived SKU without mutations", async () => {
  const { tx, input, target } = fixture();
  await expect(linkExistingProductVariant(tx as never, { ...input, targetVersion: "2026-09-18T10:00:00.000Z" })).rejects.toThrow("izmenjen");
  Object.assign(target, { deletedAt: new Date() });
  await expect(linkExistingProductVariant(tx as never, input)).rejects.toThrow("Arhivirani");
  expect(tx.productFamily.update).not.toHaveBeenCalled();
});
it("does not silently dismantle another multi-product family", async () => {
  const { tx, input, target } = fixture(); target.familyMembership.family._count.members = 2;
  await expect(linkExistingProductVariant(tx as never, input)).rejects.toThrow("Najpre ga odvojite");
  expect(tx.productFamilyMember.upsert).not.toHaveBeenCalled();
});
it("treats a repeated successful link as a no-op", async () => {
  const { tx, input, target } = fixture(); target.familyMembership.familyId = "fm";
  await expect(linkExistingProductVariant(tx as never, input)).resolves.toMatchObject({ duplicate: true });
  expect(tx.productFamily.update).not.toHaveBeenCalled();
});
it("rejects self-links and conflicting variant labels", async () => {
  const { tx, input } = fixture();
  await expect(linkExistingProductVariant(tx as never, { ...input, targetId: "m" })).rejects.toThrow("sam sa sobom");
  tx.productFamilyMember.findFirst.mockImplementation(({ select }) => select.position ? { position: 0 } : { product: { sku: "110126" } });
  await expect(linkExistingProductVariant(tx as never, input)).rejects.toThrow("110126");
  expect(tx.productFamilyMember.upsert).not.toHaveBeenCalled();
});
it("future master edits preserve the other size's name, dimensions, description and media", async () => {
  const tx = { productFamilyMember: { findUnique: async () => ({ familyId: "f", family: { preserveVariantData: true, primaryProductId: "m", members: [{ productId: "m" }, { productId: "s" }] } }) }, product: { findUniqueOrThrow: vi.fn(), update: vi.fn() } };
  expect(await propagateProductFamilySharedData(tx as never, "m", ["master"])).toEqual([]);
  expect(tx.product.update).not.toHaveBeenCalled(); expect(tx.product.findUniqueOrThrow).not.toHaveBeenCalled();
});
