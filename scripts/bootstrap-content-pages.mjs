import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { SYSTEM_CONTENT_PAGES } from "../src/lib/cms/system-pages.ts";

loadEnv({ path: ".env.local" });
loadEnv();

function withSslNoVerify(connectionString) {
  try {
    const url = new URL(connectionString);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return connectionString;
    }
    url.searchParams.set("sslmode", "no-verify");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    const separator = connectionString.includes("?") ? "&" : "?";
    return `${connectionString}${separator}sslmode=no-verify`;
  }
}

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.error("db:content-bootstrap: no database connection string in env; skipping.");
  process.exit(0);
}

const db = new PrismaClient({ adapter: new PrismaPg(withSslNoVerify(connectionString)) });

try {
  for (const definition of SYSTEM_CONTENT_PAGES) {
    await db.$transaction(async (tx) => {
      const existing = await tx.contentPage.findUnique({
        where: { slug: definition.slug },
        include: {
          _count: { select: { revisions: true } },
        },
      });

      if (!existing) {
        const page = await tx.contentPage.create({
          data: {
            slug: definition.slug,
            systemKey: definition.systemKey,
            kind: "SYSTEM",
            template: definition.template,
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
            published: false,
          },
        });
        const revision = await tx.contentPageRevision.create({
          data: {
            pageId: page.id,
            version: 1,
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
          },
        });
        await tx.contentPage.update({
          where: { id: page.id },
          data: {
            draftRevisionId: revision.id,
            publishedRevisionId: revision.id,
            published: true,
          },
        });
        return;
      }

      const needsInitialFooterDefaults = existing.footerColumn === null;
      const nextVersion = existing._count.revisions + 1;
      const commonPageUpdate = {
        systemKey: definition.systemKey,
        kind: "SYSTEM",
        template: definition.template,
        footerVisible: needsInitialFooterDefaults
          ? definition.footerVisible
          : existing.footerVisible,
        footerLabel: needsInitialFooterDefaults
          ? definition.footerLabel
          : existing.footerLabel,
        footerColumn: needsInitialFooterDefaults
          ? definition.footerColumn
          : existing.footerColumn,
        footerOrder: needsInitialFooterDefaults
          ? definition.footerOrder
          : existing.footerOrder,
      };

      if (existing.publishedRevisionId && needsInitialFooterDefaults) {
        const normalizedRevision = await tx.contentPageRevision.create({
          data: {
            pageId: existing.id,
            version: nextVersion,
            eyebrow: existing.eyebrow ?? definition.eyebrow,
            heroNote: existing.heroNote ?? definition.heroNote,
            title: existing.title,
            lead: existing.lead,
            bodyMarkdown: existing.bodyMarkdown,
            seoTitle: existing.seoTitle ?? definition.seoTitle,
            seoDescription: existing.seoDescription ?? definition.seoDescription,
            footerVisible: definition.footerVisible,
            footerLabel: definition.footerLabel,
            footerColumn: definition.footerColumn,
            footerOrder: definition.footerOrder,
          },
        });
        await tx.contentPage.update({
          where: { id: existing.id },
          data: {
            ...commonPageUpdate,
            eyebrow: existing.eyebrow ?? definition.eyebrow,
            heroNote: existing.heroNote ?? definition.heroNote,
            seoTitle: existing.seoTitle ?? definition.seoTitle,
            seoDescription: existing.seoDescription ?? definition.seoDescription,
            draftRevisionId: normalizedRevision.id,
            publishedRevisionId: normalizedRevision.id,
            published: true,
          },
        });
        return;
      }

      if (!existing.publishedRevisionId) {
        const fallbackRevision = await tx.contentPageRevision.create({
          data: {
            pageId: existing.id,
            version: nextVersion,
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
          },
        });
        await tx.contentPage.update({
          where: { id: existing.id },
          data: {
            ...commonPageUpdate,
            publishedRevisionId: fallbackRevision.id,
            draftRevisionId: existing.draftRevisionId ?? fallbackRevision.id,
            published: true,
          },
        });
        return;
      }

      await tx.contentPage.update({
        where: { id: existing.id },
        data: commonPageUpdate,
      });
    });
  }
  console.log(`db:content-bootstrap: ensured ${SYSTEM_CONTENT_PAGES.length} system page(s).`);
} finally {
  await db.$disconnect();
}
