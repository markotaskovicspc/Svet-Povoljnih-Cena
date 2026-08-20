import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ContentBody, ContentHero } from "@/components/layout/content-shell";
import type { CmsPageSnapshot } from "@/lib/cms/pages";
import { CmsMarkdown } from "./cms-markdown";

export function CmsContentPage({
  page,
  parentTrail = [],
}: {
  page: CmsPageSnapshot;
  parentTrail?: Array<{ label: string; href?: string }>;
}) {
  const breadcrumbLabel = page.seoTitle?.trim() || page.title.replace(/[.]$/, "");
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[...parentTrail, { label: breadcrumbLabel }]} />
      </div>
      <ContentHero
        eyebrow={page.eyebrow ?? undefined}
        title={page.title}
        lead={page.lead ?? undefined}
        meta={page.heroNote ? <>{page.heroNote}</> : undefined}
      />
      <ContentBody>
        <CmsMarkdown markdown={page.bodyMarkdown} template={page.template} />
      </ContentBody>
    </>
  );
}

export function CmsFunctionalPage({
  page,
  parentTrail = [],
  children,
  widgetPosition = "after",
}: {
  page: CmsPageSnapshot;
  parentTrail?: Array<{ label: string; href?: string }>;
  children: ReactNode;
  widgetPosition?: "before" | "after";
}) {
  const breadcrumbLabel = page.seoTitle?.trim() || page.title.replace(/[.]$/, "");
  return (
    <>
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 pt-6">
        <Breadcrumbs trail={[...parentTrail, { label: breadcrumbLabel }]} />
      </div>
      <ContentHero
        eyebrow={page.eyebrow ?? undefined}
        title={page.title}
        lead={page.lead ?? undefined}
        meta={page.heroNote ? <>{page.heroNote}</> : undefined}
      />
      <ContentBody>
        {widgetPosition === "before" ? children : null}
        <CmsMarkdown markdown={page.bodyMarkdown} template={page.template} />
        {widgetPosition === "after" ? children : null}
      </ContentBody>
    </>
  );
}

export function CmsPreviewFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-sm">
      {children}
    </div>
  );
}
