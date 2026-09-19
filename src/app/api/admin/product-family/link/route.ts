import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { normalizeArticleSku } from "@/lib/article-sku";
import { defaultProductFamilyLabel } from "@/lib/product-family";
import { linkExistingProductVariant } from "@/lib/product-family.server";

export const runtime = "nodejs";
const schema = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1), sourceVersion: z.iso.datetime(), targetVersion: z.iso.datetime(), label: z.string().trim().min(1).max(120) });
export async function GET(request: Request) {
  await requireAdminAction(["CONTENT", "OPS"]);
  let sku: string;
  try { sku = normalizeArticleSku(new URL(request.url).searchParams.get("sku") ?? ""); }
  catch { return Response.json({ error: "Unesite ispravnu šifru postojećeg artikla (do 80 znakova, bez razmaka)." }, { status: 400 }); }
  const product = await db.product.findUnique({ where: { sku }, select: {
    id: true, sku: true, name: true, sizeLabel: true, colorPrimary: true, colorSecondary: true, updatedAt: true, deletedAt: true,
    familyMembership: { select: { label: true, family: { select: { code: true, _count: { select: { members: true } } } } } },
  } });
  if (!product || product.deletedAt) return Response.json({ error: "Aktivan artikal sa ovom šifrom nije pronađen." }, { status: 404 });
  return Response.json({ id: product.id, sku: product.sku, name: product.name, sizeLabel: product.sizeLabel,
    version: product.updatedAt.toISOString(), label: product.familyMembership?.label || [product.sizeLabel, defaultProductFamilyLabel(product)].filter(Boolean).join(" · ") || product.sku,
    familyCode: product.familyMembership?.family.code ?? null, familyMembers: product.familyMembership?.family._count.members ?? 0,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const admin = await requireAdminAction(["CONTENT", "OPS"]);
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Nedozvoljen izvor zahteva." }, { status: 403 });
  try {
    const input = schema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const linked = await linkExistingProductVariant(tx, input);
      if (!linked.duplicate) await tx.auditLog.create({ data: { actorId: admin.id, action: "product.family.link-existing", entity: "ProductFamily", entityId: linked.familyId, diff: { sourceSku: linked.source.sku, targetSku: linked.target.sku, label: input.label, preserveVariantData: true } } });
      return linked;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    const members = await db.productFamilyMember.findMany({ where: { familyId: result.familyId }, select: { productId: true, product: { select: { slug: true } } } });
    for (const member of members) { revalidatePath(`/admin/erp/artikli/${member.productId}`); revalidatePath(`/p/${member.product.slug}`); }
    revalidatePath("/admin/erp/artikli"); revalidatePath("/");
    revalidateTag("catalog-products", { expire: 0 }); revalidateTag("storefront-home", { expire: 0 });
    return Response.json({ ok: true, message: result.duplicate ? "Artikli su već povezani." : `SKU ${result.target.sku} je povezan. Postojeći podaci oba artikla su sačuvani.` });
  } catch (error) {
    const message = error instanceof Prisma.PrismaClientKnownRequestError ? "Podaci su promenjeni tokom povezivanja. Osvežite pregled i pokušajte ponovo." : error instanceof z.ZodError ? "Proverite šifru i oznaku varijante." : error instanceof Error ? error.message : "Povezivanje nije uspelo.";
    return Response.json({ error: message }, { status: 400 });
  }
}
