import {
  getSystemContentPage,
  isFunctionalContentPageSlug,
} from "./system-pages";
import { defaultContactPageWidgetData } from "./contact-page";

export function getFunctionalContentPageInitialization(
  slug: string,
  createdById: string,
) {
  const definition = getSystemContentPage(slug);
  if (!definition || !isFunctionalContentPageSlug(definition.slug)) {
    return null;
  }

  const editableContent = {
    eyebrow: definition.eyebrow,
    heroNote: definition.heroNote,
    title: definition.title,
    lead: definition.lead,
    bodyMarkdown: definition.bodyMarkdown,
    seoTitle: definition.seoTitle,
    seoDescription: definition.seoDescription,
    widgetData:
      definition.slug === "kontakt" ? defaultContactPageWidgetData() : undefined,
    footerVisible: definition.footerVisible,
    footerLabel: definition.footerLabel,
    footerColumn: definition.footerColumn,
    footerOrder: definition.footerOrder,
  };

  return {
    page: {
      slug: definition.slug,
      systemKey: definition.systemKey,
      kind: "SYSTEM" as const,
      template: definition.template,
      ...editableContent,
      published: false,
    },
    revision: {
      version: 1,
      ...editableContent,
      createdById,
    },
  };
}
