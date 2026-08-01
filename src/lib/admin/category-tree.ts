export type CategoryTreeItem = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  order: number;
  path: string;
  level: number;
};

export type FlatCategoryTreeItem<T extends CategoryTreeItem> = T & {
  indent: number;
};

export type CategoryTreeUpdate = {
  id: string;
  path: string;
  level: number;
};

const categoryCollator = new Intl.Collator("sr", {
  sensitivity: "base",
  numeric: true,
});

function compareCategories<T extends CategoryTreeItem>(left: T, right: T) {
  return (
    left.order - right.order ||
    categoryCollator.compare(left.name, right.name) ||
    left.id.localeCompare(right.id)
  );
}

function childrenByParent<T extends CategoryTreeItem>(categories: T[]) {
  const byParent = new Map<string | null, T[]>();
  const categoryIds = new Set(categories.map((category) => category.id));

  for (const category of categories) {
    const parentId =
      category.parentId && categoryIds.has(category.parentId)
        ? category.parentId
        : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(category);
    byParent.set(parentId, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort(compareCategories);
  }

  return byParent;
}

export function flattenCategoryTree<T extends CategoryTreeItem>(
  categories: T[],
): FlatCategoryTreeItem<T>[] {
  const byParent = childrenByParent(categories);
  const flat: FlatCategoryTreeItem<T>[] = [];
  const visited = new Set<string>();

  const visit = (category: T, indent: number) => {
    if (visited.has(category.id)) return;
    visited.add(category.id);
    flat.push({ ...category, indent });
    for (const child of byParent.get(category.id) ?? []) {
      visit(child, indent + 1);
    }
  };

  for (const root of byParent.get(null) ?? []) visit(root, 0);

  // Corrupt legacy cycles should not make categories disappear from the editor.
  for (const category of [...categories].sort(compareCategories)) {
    visit(category, 0);
  }

  return flat;
}

export function collectCategoryDescendantIds<T extends CategoryTreeItem>(
  categories: T[],
  categoryId: string,
) {
  const byParent = childrenByParent(categories);
  const descendants = new Set<string>();
  const pending = [...(byParent.get(categoryId) ?? [])];

  while (pending.length > 0) {
    const category = pending.pop()!;
    if (category.id === categoryId || descendants.has(category.id)) continue;
    descendants.add(category.id);
    pending.push(...(byParent.get(category.id) ?? []));
  }

  return descendants;
}

export function categoryTreeDepth<T extends CategoryTreeItem>(
  categories: T[],
  categoryId: string,
) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const visited = new Set<string>();
  let current = byId.get(categoryId);
  let depth = 0;

  if (!current) return null;
  while (current.parentId) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) return null;
    current = parent;
    depth += 1;
  }
  return depth;
}

export function categoryDescendantPathUpdates<T extends CategoryTreeItem>(
  categories: T[],
  categoryId: string,
) {
  const root = categories.find((category) => category.id === categoryId);
  if (!root) return [];

  const byParent = childrenByParent(categories);
  const updates: CategoryTreeUpdate[] = [];
  const visited = new Set([root.id]);

  const visit = (parent: Pick<CategoryTreeItem, "id" | "path" | "level">) => {
    for (const child of byParent.get(parent.id) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);

      const path = `${parent.path}/${child.slug}`;
      const level = parent.level + 1;
      if (child.path !== path || child.level !== level) {
        updates.push({ id: child.id, path, level });
      }
      visit({ id: child.id, path, level });
    }
  };

  visit(root);
  return updates;
}
