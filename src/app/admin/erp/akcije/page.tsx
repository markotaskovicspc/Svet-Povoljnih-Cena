import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { ActionsAdmin } from "./actions-admin";
import { getErpModule } from "@/lib/admin/erp";
import { ErpGrid } from "@/components/admin/erp-grid";
import { formatBelgradePricingDateTime } from "@/lib/admin/pricing-date-time";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Akcije",
  robots: { index: false, follow: false },
};

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  await requireAdminAction(["CONTENT"]);
  const params = await searchParams;
  const [actions, loyaltyRules, linearPromotions, categories, groups, erpModule] =
    await Promise.all([
      db.action.findMany({
        orderBy: [{ priority: "desc" }, { startsAt: "desc" }],
        include: {
          actionPrices: {
            orderBy: { product: { sku: "asc" } },
            include: {
              product: {
                include: {
                  supplier: { select: { name: true } },
                  group: { select: { name: true } },
                  collection: { select: { name: true } },
                  categories: {
                    include: {
                      category: { select: { name: true, level: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      db.loyaltyRule.findMany({
        orderBy: [{ startsAt: "desc" }, { priority: "desc" }],
        include: {
          products: {
            orderBy: { product: { sku: "asc" } },
            include: {
              product: { select: { id: true, sku: true, name: true } },
            },
          },
        },
      }),
      db.linearPromotion.findMany({
        orderBy: [{ startsAt: "desc" }, { priority: "desc" }],
        include: {
          categories: {
            include: { category: { select: { id: true, name: true } } },
          },
          groups: {
            include: { group: { select: { id: true, name: true } } },
          },
        },
      }),
      db.category.findMany({
        orderBy: [{ level: "asc" }, { name: "asc" }],
        select: { id: true, name: true, path: true, level: true },
      }),
      db.group.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      getErpModule("akcije", { take: 10_000 }),
    ]);

  const productIds = Array.from(
    new Set(
      actions.flatMap((action) =>
        action.actionPrices.map((entry) => entry.productId),
      ),
    ),
  );
  const retailEntries = productIds.length
    ? await db.priceListEntry.findMany({
        where: {
          productId: { in: productIds },
          priceList: {
            is: {
              kind: "RETAIL",
              active: true,
              OR: [
                { name: { contains: "MP", mode: "insensitive" } },
                { code: { contains: "MP", mode: "insensitive" } },
              ],
            },
          },
        },
        orderBy: { validFrom: "desc" },
        include: {
          priceList: {
            select: { validFrom: true, validTo: true },
          },
        },
      })
    : [];

  const retailPriceAt = (productId: string, at: Date, fallback: number) => {
    const time = at.getTime();
    const entry = retailEntries.find(
      (candidate) =>
        candidate.productId === productId &&
        candidate.validFrom.getTime() <= time &&
        (!candidate.validTo || candidate.validTo.getTime() >= time) &&
        (!candidate.priceList.validFrom ||
          candidate.priceList.validFrom.getTime() <= time) &&
        (!candidate.priceList.validTo ||
          candidate.priceList.validTo.getTime() >= time),
    );
    return entry ? Number(entry.price) : fallback;
  };

  const actionRows = actions.map((action) => ({
    id: action.id,
    name: action.name,
    slug: action.slug,
    kind: action.kind,
    startsAt: formatBelgradePricingDateTime(action.startsAt),
    endsAt: formatBelgradePricingDateTime(action.endsAt),
    isHero: action.isHero,
    isPermanent: action.isPermanent,
    sortOrder: action.sortOrder,
    priority: action.priority,
    products: action.actionPrices.map((entry) => {
      const product = entry.product;
      const productCategories = [...product.categories].sort(
        (left, right) =>
          left.category.level - right.category.level,
      );
      return {
        productId: product.id,
        sku: product.sku,
        supplier: product.supplier?.name ?? "—",
        category: productCategories[0]?.category.name ?? "—",
        group: product.group?.name ?? "—",
        subgroup:
          productCategories.length > 1
            ? productCategories[productCategories.length - 1]?.category.name ??
              "—"
            : "—",
        collection: product.collection?.name ?? "—",
        shortDescription: product.shortDescription ?? "—",
        shortName: product.name,
        attribute1: product.attribute1 ?? "—",
        attribute2: product.attribute2 ?? "—",
        attribute3: product.attribute3 ?? "—",
        attribute4: product.attribute4 ?? "—",
        color1: product.colorPrimary ?? "—",
        color2: product.colorSecondary ?? "—",
        validMpPrice: retailPriceAt(
          product.id,
          action.startsAt,
          Number(product.fullPrice),
        ),
        salePrice: Number(entry.salePrice),
      };
    }),
  }));

  return (
    <>
      <PageHeader
        title="Akcije"
        description="MP i akcijske MP cene, heroji meseca, loyalty i linearni popusti."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Akcije" },
        ]}
      />
      {erpModule ? (
        <div className="px-4 pt-6 md:px-8">
          <ErpGrid module={erpModule} />
        </div>
      ) : null}
      <ActionsAdmin
        actions={actionRows}
        initialSelectedId={params.edit}
        loyaltyRules={loyaltyRules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          discountPct: Number(rule.discountPct),
          scope: rule.scope,
          priority: rule.priority,
          startsAt: formatBelgradePricingDateTime(rule.startsAt),
          endsAt: formatBelgradePricingDateTime(rule.endsAt),
          active: rule.active,
          products: rule.products.map((item) => item.product),
        }))}
        linearPromotions={linearPromotions.map((promotion) => ({
          id: promotion.id,
          name: promotion.name,
          discountPct: Number(promotion.discountPct),
          priority: promotion.priority,
          startsAt: formatBelgradePricingDateTime(promotion.startsAt),
          endsAt: formatBelgradePricingDateTime(promotion.endsAt),
          active: promotion.active,
          categoryIds: promotion.categories.map((item) => item.category.id),
          groupIds: promotion.groups.map((item) => item.group.id),
          categories: promotion.categories.map(
            (item) => item.category.name,
          ),
          groups: promotion.groups.map((item) => item.group.name),
        }))}
        categories={categories}
        groups={groups}
      />
    </>
  );
}
