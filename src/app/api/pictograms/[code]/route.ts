import { db } from "@/lib/db";
import { optimizedIconUrl } from "@/lib/media/optimized-icon";
import { LEGACY_STOREFRONT_PICTOGRAM_ICON_URLS } from "@/lib/storefront-pictograms";

export const runtime = "nodejs";

/**
 * Stable URL for a storefront-wide pictogram.
 *
 * Products that have no explicit ProductPictogram row still show the global
 * "48h" and "2+1" pictograms. Pointing those fallbacks at this route means an
 * icon replaced in /admin/piktogrami appears on every product, not only on the
 * ones the pictogram is assigned to.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await context.params;
  const code = rawCode.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(code)) {
    return new Response("Invalid pictogram", { status: 400 });
  }

  let iconUrl: string | undefined;
  try {
    const pictogram = await db.pictogram.findUnique({
      where: { code },
      select: { iconUrl: true },
    });
    iconUrl = pictogram?.iconUrl;
  } catch {
    // Fall through to the legacy icon so a database hiccup never blanks the badge.
  }
  iconUrl ??= LEGACY_STOREFRONT_PICTOGRAM_ICON_URLS[code];
  if (!iconUrl) return new Response("Pictogram not found", { status: 404 });

  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL(optimizedIconUrl(iconUrl), request.url).toString(),
      // Short cache: an admin icon change is visible within about a minute.
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
