export type ArticleCategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  order?: number;
};

export type ArticleCategorySelection = {
  siteCategoryId: string;
  siteGroupId: string;
  siteSubgroupId: string;
};

export type ArticleCategorySelectionLevel =
  | "category"
  | "group"
  | "subgroup";

export type ResolvedArticleCategorySelection = ArticleCategorySelection & {
  leafCategoryId: string | null;
};

const categoryCollator = new Intl.Collator("sr", {
  sensitivity: "base",
  numeric: true,
});

function compareCategories(left: ArticleCategoryNode, right: ArticleCategoryNode) {
  return (
    (left.order ?? 0) - (right.order ?? 0) ||
    categoryCollator.compare(left.name, right.name) ||
    left.id.localeCompare(right.id)
  );
}

export function articleCategoryChildren(
  categories: readonly ArticleCategoryNode[],
  parentId: string | null,
) {
  return categories
    .filter((category) => category.parentId === parentId)
    .sort(compareCategories);
}

export function articleCategorySelectionAfterChange(
  selection: ArticleCategorySelection,
  level: ArticleCategorySelectionLevel,
  value: string,
): ArticleCategorySelection {
  if (level === "category") {
    return {
      siteCategoryId: value,
      siteGroupId: "",
      siteSubgroupId: "",
    };
  }
  if (level === "group") {
    return {
      ...selection,
      siteGroupId: value,
      siteSubgroupId: "",
    };
  }
  return { ...selection, siteSubgroupId: value };
}

export function articleCategorySelectionFromLeaf(
  categories: readonly ArticleCategoryNode[],
  leafCategoryId?: string | null,
): ArticleCategorySelection {
  const empty = {
    siteCategoryId: "",
    siteGroupId: "",
    siteSubgroupId: "",
  };
  if (!leafCategoryId) return empty;

  const byId = new Map(categories.map((category) => [category.id, category]));
  const trail: ArticleCategoryNode[] = [];
  const visited = new Set<string>();
  let current = byId.get(leafCategoryId);

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    trail.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  if (!trail.length || trail.length > 3 || trail[0]?.parentId !== null) {
    return empty;
  }

  return {
    siteCategoryId: trail[0]?.id ?? "",
    siteGroupId: trail[1]?.id ?? "",
    siteSubgroupId: trail[2]?.id ?? "",
  };
}

export function resolveArticleCategorySelection(
  categories: readonly ArticleCategoryNode[],
  input: ArticleCategorySelection,
): ResolvedArticleCategorySelection {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const siteCategoryId = input.siteCategoryId.trim();
  const siteGroupId = input.siteGroupId.trim();
  const siteSubgroupId = input.siteSubgroupId.trim();

  if (!siteCategoryId) {
    if (siteGroupId || siteSubgroupId) {
      throw new Error("Grupa i podgrupa ne mogu biti izabrane bez kategorije.");
    }
    return {
      siteCategoryId: "",
      siteGroupId: "",
      siteSubgroupId: "",
      leafCategoryId: null,
    };
  }

  const category = byId.get(siteCategoryId);
  if (!category || category.parentId !== null) {
    throw new Error("Izabrana kategorija nije početni nivo navigacije.");
  }

  if (!siteGroupId) {
    if (siteSubgroupId) {
      throw new Error("Podgrupa ne može biti izabrana bez grupe.");
    }
    return {
      siteCategoryId,
      siteGroupId: "",
      siteSubgroupId: "",
      leafCategoryId: category.id,
    };
  }

  const group = byId.get(siteGroupId);
  if (!group || group.parentId !== category.id) {
    throw new Error("Izabrana grupa ne pripada izabranoj kategoriji.");
  }

  if (!siteSubgroupId) {
    return {
      siteCategoryId,
      siteGroupId,
      siteSubgroupId: "",
      leafCategoryId: group.id,
    };
  }

  const subgroup = byId.get(siteSubgroupId);
  if (!subgroup || subgroup.parentId !== group.id) {
    throw new Error("Izabrana podgrupa ne pripada izabranoj grupi.");
  }

  return {
    siteCategoryId,
    siteGroupId,
    siteSubgroupId,
    leafCategoryId: subgroup.id,
  };
}
