export function contentPageStatus(page: {
  archivedAt: Date | null;
  published: boolean;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
}) {
  if (page.archivedAt) return "Arhivirano";
  if (!page.published || !page.publishedRevisionId) return "Nacrt";
  if (page.draftRevisionId !== page.publishedRevisionId) {
    return "Objavljeno sa neobjavljenim izmenama";
  }
  return "Objavljeno";
}
