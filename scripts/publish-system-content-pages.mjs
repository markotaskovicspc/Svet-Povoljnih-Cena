import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { SYSTEM_CONTENT_PAGES } from "../src/lib/cms/system-pages.ts";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const requested = new Set(process.argv.slice(2).map((value) => value.trim()).filter(Boolean));
if (!requested.size) {
  throw new Error(
    "Navedite najmanje jedan sistemski slug, npr. node scripts/publish-system-content-pages.mjs pomoc uslovi-isporuke",
  );
}

const definitions = SYSTEM_CONTENT_PAGES.filter(
  (definition) => requested.has(definition.slug) || requested.has(definition.systemKey),
);
const resolved = new Set(
  definitions.flatMap((definition) => [definition.slug, definition.systemKey]),
);
const unknown = [...requested].filter((value) => !resolved.has(value));
if (unknown.length) {
  throw new Error(`Nepoznata sistemska stranica: ${unknown.join(", ")}`);
}

function withSslNoVerify(connectionString) {
  const url = new URL(connectionString);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return connectionString;
  url.searchParams.set("sslmode", "no-verify");
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
}

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL;
if (!connectionString) throw new Error("Nedostaje DATABASE_URL.");

const db = new PrismaClient({ adapter: new PrismaPg(withSslNoVerify(connectionString)) });

try {
  const actorEmail = process.env.SUPER_ADMIN_MARKO_EMAIL?.trim().toLowerCase();
  const actor = actorEmail
    ? await db.adminUser.findUnique({ where: { email: actorEmail }, select: { id: true } })
    : null;

  for (const definition of definitions) {
    const result = await db.$transaction(async (tx) => {
      const page = await tx.contentPage.findUnique({
        where: { slug: definition.slug },
        select: {
          id: true,
          kind: true,
          systemKey: true,
          revisions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { version: true },
          },
        },
      });
      if (!page) {
        throw new Error(
          `Sistemska stranica ${definition.slug} ne postoji; prvo pokrenite content bootstrap.`,
        );
      }
      if (page.kind !== "SYSTEM" || page.systemKey !== definition.systemKey) {
        throw new Error(`Zaštitna provera nije prošla za ${definition.slug}.`);
      }

      const snapshot = {
        eyebrow: definition.eyebrow,
        heroNote: definition.heroNote,
        title: definition.title,
        lead: definition.lead,
        bodyMarkdown: definition.bodyMarkdown,
        seoTitle: definition.seoTitle,
        seoDescription: definition.seoDescription,
        footerVisible: definition.footerVisible,
        footerLabel: definition.footerLabel,
        footerColumn: definition.footerColumn,
        footerOrder: definition.footerOrder,
      };
      const revision = await tx.contentPageRevision.create({
        data: {
          pageId: page.id,
          version: (page.revisions[0]?.version ?? 0) + 1,
          ...snapshot,
          createdById: actor?.id ?? null,
        },
        select: { id: true, version: true },
      });
      await tx.contentPage.update({
        where: { id: page.id },
        data: {
          template: definition.template,
          ...snapshot,
          draftRevisionId: revision.id,
          publishedRevisionId: revision.id,
          published: true,
          archivedAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor?.id ?? null,
          action: "content-page.publish.system-source",
          entity: "ContentPage",
          entityId: page.id,
          diff: { slug: definition.slug, version: revision.version },
        },
      });
      return revision.version;
    });
    console.log(`Objavljeno: ${definition.slug} (verzija ${result}).`);
  }
} finally {
  await db.$disconnect();
}
