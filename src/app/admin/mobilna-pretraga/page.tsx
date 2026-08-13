import { revalidatePath, updateTag } from "next/cache";
import { LandingPageStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { withAdminState, requireAdminAction, type AdminActionState } from "@/lib/admin";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { getMediaVariantUrl } from "@/lib/media";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";
import { resolveMobileTabDestination } from "@/lib/mobile-shortcuts/server";
import {
  DEFAULT_MOBILE_SEARCH_QUERIES,
  MOBILE_SEARCH_SETTING_KEY,
  assertMobileSearchInternalHref,
  parseMobileSearchConfigForm,
  parseMobileSearchStoredConfig,
} from "@/lib/mobile-search/shared";
import {
  removeMobileSearchImages,
  uploadMobileSearchImage,
} from "@/lib/mobile-search/image-storage.server";
import { getMobileSearchContent } from "@/lib/mobile-search/server";
import { LANDING_PAGE_OPTIONS } from "@/lib/storefront/homepage";
import { PageHeader } from "@/components/admin/page-header";
import {
  MobileSearchEditor,
  type MobileSearchAdminProduct,
} from "@/components/admin/mobile-search-editor";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Mobilna pretraga",
  robots: { index: false, follow: false },
};

const fixedDestinations = [
  { label: "Početna strana", href: "/" },
  { label: "Mesečna akcija", href: "/akcija" },
  { label: "Nedeljna akcija", href: "/nedeljna-akcija" },
  { label: "Heroji meseca", href: "/heroji-meseca" },
  { label: "Trajno niske cene", href: "/niske-cene-pod-zastitom" },
  { label: "Dok traju zalihe", href: "/ogranicena-ponuda" },
  { label: "Sve do 999", href: "/sve-do-999" },
  { label: "Novo", href: "/novo" },
  { label: "Outlet", href: "/outlet" },
  ...LANDING_PAGE_OPTIONS.map((page) => ({ label: page.label, href: page.href })),
].filter(
  (item, index, all) => all.findIndex((candidate) => candidate.href === item.href) === index,
);

function selectedFile(formData: FormData, name: string) {
  const value = formData.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

function internalDestination(result: Awaited<ReturnType<typeof resolveMobileTabDestination>>) {
  assertMobileSearchInternalHref(result.href);
  return result;
}

async function saveMobileSearch(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    {
      allowed: ["CONTENT"],
      action: "mobileSearch.save",
      entity: "AdminSetting",
    },
    async (actorId, formData: FormData) => {
      const parsed = parseMobileSearchConfigForm(formData);
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Proverite podatke mobilne pretrage.",
        };
      }

      let currentDestinations;
      let viewAllDestination;
      try {
        currentDestinations = await Promise.all(
          parsed.data.currentItems.map(async (item) =>
            internalDestination(
              await resolveMobileTabDestination({
                selection: item.destination,
                customHref: item.customHref,
                enabled: true,
              }),
            ),
          ),
        );
        viewAllDestination = internalDestination(
          await resolveMobileTabDestination({
            selection: parsed.data.viewAllDestination,
            customHref: parsed.data.viewAllCustomHref,
            enabled: true,
          }),
        );
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Odredište nije ispravno.",
        };
      }

      const products = await db.product.findMany({
        where: {
          ...webStorefrontProductWhere(),
          sku: { in: parsed.data.productSkus },
        },
        select: { id: true, sku: true },
      });
      const productsBySku = new Map(products.map((product) => [product.sku, product]));
      const missingSkus = parsed.data.productSkus.filter((sku) => !productsBySku.has(sku));
      if (missingSkus.length) {
        return {
          ok: false as const,
          error: `Proizvodi nisu aktivni ili objavljivi: ${missingSkus.join(", ")}.`,
        };
      }

      const previous = await db.adminSetting.findUnique({
        where: { key: MOBILE_SEARCH_SETTING_KEY },
        select: { value: true },
      });
      const previousConfig = parseMobileSearchStoredConfig(previous?.value);
      const uploads: Array<{ key: string; url: string }> = [];
      const imageUrls: string[] = [];
      try {
        for (const item of parsed.data.currentItems) {
          const file = selectedFile(formData, `currentImageFile${item.position}`);
          if (file) {
            const uploaded = await uploadMobileSearchImage(file);
            uploads.push(uploaded);
            imageUrls.push(uploaded.url);
          } else if (item.existingImageUrl) {
            imageUrls.push(item.existingImageUrl);
          } else {
            await removeMobileSearchImages(uploads.map((upload) => upload.url), {
              reason: "incomplete_form",
            });
            return {
              ok: false as const,
              error: `Dodajte sliku za Aktuelno ${item.position}.`,
            };
          }
        }

        const storedConfig = {
          version: 1 as const,
          currentItems: parsed.data.currentItems.map((item, index) => ({
            position: item.position,
            label: item.label,
            imageUrl: imageUrls[index]!,
            destination: item.destination ?? "",
            customHref: item.customHref ?? "",
          })),
          productSkus: parsed.data.productSkus,
          frequentQueries: parsed.data.frequentQueries,
          viewAllDestination: parsed.data.viewAllDestination ?? "",
          viewAllCustomHref: parsed.data.viewAllCustomHref ?? "",
        };
        await db.adminSetting.upsert({
          where: { key: MOBILE_SEARCH_SETTING_KEY },
          create: {
            key: MOBILE_SEARCH_SETTING_KEY,
            value: storedConfig,
            updatedBy: actorId,
          },
          update: { value: storedConfig, updatedBy: actorId },
        });
      } catch (error) {
        await removeMobileSearchImages(uploads.map((upload) => upload.url), {
          reason: "save_failed",
        });
        throw error;
      }

      await removeMobileSearchImages(
        previousConfig?.currentItems
          .map((item) => item.imageUrl)
          .filter((url) => !imageUrls.includes(url)) ?? [],
        { reason: "images_replaced" },
      );
      updateTag("storefront-mobile-search");
      revalidatePath("/admin/mobilna-pretraga");
      revalidatePath("/");
      return {
        ok: true as const,
        entityId: MOBILE_SEARCH_SETTING_KEY,
        diff: {
          before: previousConfig,
          after: {
            viewAllHref: viewAllDestination.href,
            frequentQueries: parsed.data.frequentQueries,
            currentItems: parsed.data.currentItems.map((item, index) => ({
              position: item.position,
              label: item.label,
              imageUrl: imageUrls[index],
              href: currentDestinations[index]!.href,
            })),
            productSkus: parsed.data.productSkus,
          },
        },
        message: "Mobilna pretraga je sačuvana.",
      };
    },
  )(formData);
}

export default async function MobileSearchAdminPage() {
  await requireAdminAction(["CONTENT"]);
  const [setting, fallback, actions, landingPages, categories] = await Promise.all([
    db.adminSetting.findUnique({
      where: { key: MOBILE_SEARCH_SETTING_KEY },
      select: { value: true },
    }),
    getMobileSearchContent(),
    db.action.findMany({
      orderBy: [{ endsAt: "desc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true, endsAt: true },
    }),
    db.landingPage.findMany({
      where: { status: LandingPageStatus.PUBLISHED },
      orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
      select: { id: true, title: true, slug: true, status: true },
    }),
    db.category.findMany({
      orderBy: { path: "asc" },
      select: { id: true, name: true, path: true },
    }),
  ]);
  const config = parseMobileSearchStoredConfig(setting?.value);
  const configuredProducts = config
    ? await db.product.findMany({
        where: { sku: { in: config.productSkus } },
        select: {
          sku: true,
          name: true,
          slug: true,
          media: {
            where: { kind: "IMAGE", syncStatus: "READY" },
            orderBy: { order: "asc" },
            take: 1,
            select: { url: true, thumbUrl: true, cardUrl: true },
          },
        },
      })
    : [];
  const configuredProductsBySku = new Map(
    configuredProducts.map((product) => [product.sku, product]),
  );

  const destinationOptions = [
    ...fixedDestinations.map((item) => ({ label: item.label, value: `href:${item.href}` })),
    ...categories.map((category) => ({
      label: `${category.name} — /k${category.path}`,
      value: `href:/k${category.path}`,
    })),
    ...actions.map((action) => ({
      label: `${action.name} (${action.kind}; do ${action.endsAt.toLocaleDateString("sr-RS")})`,
      value: `action:${action.id}`,
    })),
    ...landingPages.map((page) => ({
      label: `${page.title} (${page.status})`,
      value: `landing:${page.id}`,
    })),
  ];
  const knownValues = new Set(destinationOptions.map((option) => option.value));
  const currentItems = config
    ? config.currentItems.map((item) => ({
        label: item.label,
        imageUrl: item.imageUrl,
        destination: knownValues.has(item.destination) ? item.destination : "",
        customHref:
          item.customHref ||
          (item.destination.startsWith("href:") && !knownValues.has(item.destination)
            ? item.destination.slice("href:".length)
            : ""),
      }))
    : fallback.currentItems.map((item) => ({
        label: item.label,
        imageUrl: item.imageUrl,
        ...(knownValues.has(`href:${item.href}`)
          ? { destination: `href:${item.href}`, customHref: "" }
          : { destination: "", customHref: item.href }),
      }));
  const selectedProducts: MobileSearchAdminProduct[] = config
    ? config.productSkus.flatMap((sku) => {
        const product = configuredProductsBySku.get(sku);
        return product
          ? [{
              sku: product.sku,
              name: product.name,
              slug: product.slug,
              imageUrl: resolveSupabaseStorageUrl(
                getMediaVariantUrl(product.media[0], "thumb"),
              ),
            }]
          : [];
      })
    : fallback.popularProducts.map((product) => ({
        sku: product.sku,
        name: product.name,
        slug: product.slug,
        imageUrl: product.thumbnailUrl,
      }));
  const viewAll = config
    ? {
        destination: knownValues.has(config.viewAllDestination)
          ? config.viewAllDestination
          : "",
        customHref:
          config.viewAllCustomHref ||
          (config.viewAllDestination.startsWith("href:") &&
          !knownValues.has(config.viewAllDestination)
            ? config.viewAllDestination.slice("href:".length)
            : ""),
      }
    : { destination: "href:/akcija", customHref: "" };

  return (
    <>
      <PageHeader
        title="Mobilna pretraga"
        description="Sadržaj fullscreen pretrage na telefonu: dve aktuelne stavke, četiri proizvoda, šest čestih fraza i podrazumevano odredište dugmeta."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Mobilna pretraga" }]}
      />
      <main className="px-8 py-6">
        <MobileSearchEditor
          action={saveMobileSearch}
          currentItems={currentItems}
          selectedProducts={selectedProducts}
          frequentQueries={config?.frequentQueries ?? [...DEFAULT_MOBILE_SEARCH_QUERIES]}
          viewAllDestination={viewAll.destination}
          viewAllCustomHref={viewAll.customHref}
          destinationOptions={destinationOptions}
        />
      </main>
    </>
  );
}
