import Link from "next/link";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/admin/data-table";
import { Card } from "@/components/admin/card";
import { Input } from "@/components/ui/input";
import {
  CATALOG_READINESS_LABEL,
  getCatalogReadiness,
} from "@/lib/catalog-readiness";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Proizvodi",
  robots: { index: false, follow: false },
};

const PAGE = 30;
const lfsPointerPattern = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\b|oid sha256:/i;

const ownerDataIssueFilter: Prisma.ProductWhereInput = {
  OR: [
    { stock: { lte: 0 } },
    { media: { none: {} } },
    { barcode: null },
    { barcode: "" },
    { collectionId: null },
    { colorPrimary: null },
    { colorPrimary: "" },
    { colorSecondary: null },
    { colorSecondary: "" },
    { fullPrice: { lte: 1 } },
    { widthCm: null },
    { widthCm: { lte: 0 } },
    { depthCm: null },
    { depthCm: { lte: 0 } },
    { heightCm: null },
    { heightCm: { lte: 0 } },
    { description: { contains: "git-lfs", mode: "insensitive" } },
    { description: { contains: "oid sha256", mode: "insensitive" } },
  ],
};

const catalogNotReadyFilter: Prisma.ProductWhereInput = {
  OR: [
    { fullPrice: { lte: 0 } },
    { salePrice: { lte: 0 } },
    { widthCm: null },
    { widthCm: { lte: 0 } },
    { depthCm: null },
    { depthCm: { lte: 0 } },
    { heightCm: null },
    { heightCm: { lte: 0 } },
    { media: { none: {} } },
    { deliveryDaysMin: { lt: 0 } },
  ],
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  await requireAdminAction(["CONTENT", "OPS"]);
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const status = sp.status ?? "";

  const filters: Prisma.ProductWhereInput[] = [];
  if (q) {
    filters.push({
      OR: [
        { sku: { contains: q, mode: "insensitive" as const } },
        { barcode: { contains: q, mode: "insensitive" as const } },
        { name: { contains: q, mode: "insensitive" as const } },
        { slug: { contains: q, mode: "insensitive" as const } },
      ],
    });
  }
  if (status === "inactive") filters.push({ isActive: false });
  if (status === "needsqa") {
    filters.push({ isActive: false, fullPrice: 1, media: { none: {} } });
  }
  if (status === "needsownerdata") filters.push(ownerDataIssueFilter);
  if (status === "unavailable") filters.push({ stock: { lte: 0 } });
  if (status === "hero") filters.push({ isHero: true });
  if (status === "lowstock") filters.push({ stock: { gt: 0, lte: 2 } });
  if (status === "notready") filters.push(catalogNotReadyFilter);

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(filters.length ? { AND: filters } : {}),
  };

  const [
    items,
    total,
    ownerDataIssueCount,
    zeroStockCount,
    missingMediaCount,
    brokenDescriptionCount,
    catalogNotReadyCount,
  ] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: PAGE,
      skip: (page - 1) * PAGE,
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        slug: true,
        description: true,
        collectionId: true,
        colorPrimary: true,
        colorSecondary: true,
        fullPrice: true,
        salePrice: true,
        stock: true,
        incomingStock: true,
        widthCm: true,
        depthCm: true,
        heightCm: true,
        deliveryDaysMin: true,
        deliveryDaysMax: true,
        isActive: true,
        isHero: true,
        isNew: true,
        _count: { select: { media: true } },
      },
    }),
    db.product.count({ where }),
    db.product.count({ where: { deletedAt: null, ...ownerDataIssueFilter } }),
    db.product.count({ where: { deletedAt: null, stock: { lte: 0 } } }),
    db.product.count({ where: { deletedAt: null, media: { none: {} } } }),
    db.product.count({
      where: {
        deletedAt: null,
        OR: [
          { description: { contains: "git-lfs", mode: "insensitive" } },
          { description: { contains: "oid sha256", mode: "insensitive" } },
        ],
      },
    }),
    db.product.count({
      where: {
        deletedAt: null,
        isActive: true,
        ...catalogNotReadyFilter,
      },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const link = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    Object.entries(extra).forEach(([k, v]) => v && params.set(k, String(v)));
    const s = params.toString();
    return `/admin/proizvodi${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Proizvodi"
        description={`${total.toLocaleString("sr-Latn-RS")} proizvoda — pretraga, filteri, override editor.`}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Proizvodi" }]}
      />
      <div className="space-y-4 px-8 py-6">
        <Card>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Pretraga (SKU / naziv / slug)
              </label>
              <Input name="q" defaultValue={q} placeholder="npr. KAUC-001" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Status
              </label>
              <select
                name="status"
                defaultValue={status}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Svi</option>
                <option value="inactive">Neaktivni</option>
                <option value="needsqa">Uvoz QA</option>
                <option value="needsownerdata">Za vlasnika</option>
                <option value="unavailable">Bez zaliha</option>
                <option value="hero">Hero meseca</option>
                <option value="lowstock">Niske zalihe</option>
                <option value="notready">Nije spremno za prodaju</option>
              </select>
            </div>
            <button
              type="submit"
              className="h-8 rounded-lg bg-walnut px-4 text-sm font-medium text-white hover:bg-walnut/90"
            >
              Filtriraj
            </button>
          </form>
        </Card>

        <Card>
          <div className="grid gap-3 text-sm sm:grid-cols-5">
            <LaunchReadinessMetric
              label="Nije za prodaju"
              value={catalogNotReadyCount}
              href={link({ status: "notready", page: 1 })}
            />
            <LaunchReadinessMetric
              label="Za vlasnika"
              value={ownerDataIssueCount}
              href={link({ status: "needsownerdata", page: 1 })}
            />
            <LaunchReadinessMetric
              label="Bez zaliha"
              value={zeroStockCount}
              href={link({ status: "unavailable", page: 1 })}
            />
            <LaunchReadinessMetric
              label="Bez media"
              value={missingMediaCount}
              href={link({ status: "needsownerdata", page: 1 })}
            />
            <LaunchReadinessMetric
              label="LFS opisi"
              value={brokenDescriptionCount}
              href={link({ status: "needsownerdata", page: 1 })}
            />
          </div>
        </Card>

        <DataTable
          columns={[
            { key: "sku", label: "SKU" },
            { key: "name", label: "Naziv" },
            { key: "price", label: "Cena", align: "right" },
            { key: "stock", label: "Stanje", align: "right" },
            { key: "flags", label: "Oznake" },
            { key: "actions", label: "" },
          ]}
          rows={items.map((p) => {
            const ownerIssues = productOwnerIssues(p);
            const readiness = getCatalogReadiness({
              fullPrice: num(p.fullPrice),
              salePrice: p.salePrice === null ? null : num(p.salePrice),
              dimensionsCm: {
                w: p.widthCm === null ? 0 : num(p.widthCm),
                d: p.depthCm === null ? 0 : num(p.depthCm),
                h: p.heightCm === null ? 0 : num(p.heightCm),
              },
              media: { images: Array(p._count.media).fill(null) },
              deliveryDays: {
                min: p.deliveryDaysMin,
                max: p.deliveryDaysMax,
              },
            });

            return {
              id: p.id,
              cells: {
                sku: <span className="font-mono text-xs">{p.sku}</span>,
                name: (
                  <div>
                    <p className="font-medium text-ink-900">{p.name}</p>
                    <p className="text-xs text-ink-500">/p/{p.slug}</p>
                    {p.barcode ? (
                      <p className="text-xs text-ink-500">Bar kod: {p.barcode}</p>
                    ) : null}
                  </div>
                ),
                price: (
                  <div className="text-right">
                    {p.salePrice ? (
                      <>
                        <p className="text-action">{formatRsd(num(p.salePrice))}</p>
                        <p className="text-xs text-ink-500 line-through">
                          {formatRsd(num(p.fullPrice))}
                        </p>
                      </>
                    ) : (
                      formatRsd(num(p.fullPrice))
                    )}
                  </div>
                ),
                stock: (
                  <div className="text-right">
                    <p className={p.stock === 0 ? "text-danger" : ""}>{p.stock}</p>
                    {p.incomingStock > 0 ? (
                      <p className="text-xs text-ink-500">+{p.incomingStock}</p>
                    ) : null}
                  </div>
                ),
                flags: (
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    {!p.isActive ? (
                      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                        Neaktivan
                      </span>
                    ) : null}
                    {p.isHero ? (
                      <span className="rounded bg-walnut/15 px-1.5 py-0.5 text-walnut">
                        Hero
                      </span>
                    ) : null}
                    {p.isNew ? (
                      <span className="rounded bg-info/15 px-1.5 py-0.5 text-info">
                        Novo
                      </span>
                    ) : null}
                    {ownerIssues.map((issue) => (
                      <span
                        key={issue}
                        className="rounded bg-warning/15 px-1.5 py-0.5 text-warning"
                      >
                        {issue}
                      </span>
                    ))}
                    {readiness.reasons.map((reason) => (
                      <span
                        key={`readiness-${reason}`}
                        className="rounded bg-danger/15 px-1.5 py-0.5 text-danger"
                      >
                        {CATALOG_READINESS_LABEL[reason]}
                      </span>
                    ))}
                    {!p.isActive && num(p.fullPrice) === 1 && p._count.media === 0 ? (
                      <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">
                        Uvoz QA
                      </span>
                    ) : null}
                  </div>
                ),
                actions: (
                  <Link
                    href={`/admin/proizvodi/${p.id}`}
                    className="text-xs text-walnut hover:underline"
                  >
                    Otvori →
                  </Link>
                ),
              },
            };
          })}
          empty="Nema rezultata."
        />

        {pages > 1 ? (
          <div className="flex items-center justify-between text-sm text-ink-500">
            <span>
              Strana {page} od {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={link({ page: page - 1 })}
                  className="rounded-md border border-border px-3 py-1 hover:bg-muted-bg"
                >
                  ← Prethodna
                </Link>
              ) : null}
              {page < pages ? (
                <Link
                  href={link({ page: page + 1 })}
                  className="rounded-md border border-border px-3 py-1 hover:bg-muted-bg"
                >
                  Sledeća →
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function LaunchReadinessMetric({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-md border border-border px-3 py-2 transition hover:bg-muted-bg"
    >
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-ink-900">
        {value.toLocaleString("sr-Latn-RS")}
      </p>
    </Link>
  );
}

function productOwnerIssues(product: {
  stock: number;
  barcode: string | null;
  collectionId: string | null;
  colorPrimary: string | null;
  colorSecondary: string | null;
  description: string;
  fullPrice: Prisma.Decimal;
  widthCm: Prisma.Decimal | null;
  depthCm: Prisma.Decimal | null;
  heightCm: Prisma.Decimal | null;
  _count: { media: number };
}) {
  const issues: string[] = [];
  if (product.stock <= 0) issues.push("Bez zaliha");
  if (product._count.media === 0) issues.push("Bez media");
  if (!product.barcode) issues.push("Bez barkoda");
  if (!product.collectionId) issues.push("Bez brenda");
  if (!product.colorPrimary) issues.push("Bez boje");
  if (!product.colorSecondary) issues.push("Bez druge boje");
  if (num(product.fullPrice) <= 1) issues.push("Cena");
  if (
    product.widthCm === null ||
    product.depthCm === null ||
    product.heightCm === null ||
    num(product.widthCm) <= 0 ||
    num(product.depthCm) <= 0 ||
    num(product.heightCm) <= 0
  ) {
    issues.push("Bez dimenzija");
  }
  if (lfsPointerPattern.test(product.description)) issues.push("LFS opis");
  return issues;
}
