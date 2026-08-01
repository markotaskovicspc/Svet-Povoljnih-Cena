"use client";

import { useMemo, useState } from "react";
import { Field } from "@/components/admin/field";
import {
  articleCategoryChildren,
  articleCategorySelectionAfterChange,
  type ArticleCategoryNode,
  type ArticleCategorySelection,
} from "@/lib/admin/article-category-hierarchy";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm disabled:cursor-not-allowed disabled:opacity-55";

export function ProductCategorySelector({
  categories,
  initialSelection,
}: {
  categories: ArticleCategoryNode[];
  initialSelection: ArticleCategorySelection;
}) {
  const [selection, setSelection] = useState(initialSelection);
  const { siteCategoryId, siteGroupId, siteSubgroupId } = selection;

  const rootCategories = useMemo(
    () => articleCategoryChildren(categories, null),
    [categories],
  );
  const groups = useMemo(
    () =>
      siteCategoryId
        ? articleCategoryChildren(categories, siteCategoryId)
        : [],
    [categories, siteCategoryId],
  );
  const subgroups = useMemo(
    () =>
      siteGroupId ? articleCategoryChildren(categories, siteGroupId) : [],
    [categories, siteGroupId],
  );

  return (
    <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
      <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
        Pozicija u navigaciji sajta
      </legend>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Kategorija">
          <select
            name="siteCategoryId"
            value={siteCategoryId}
            onChange={(event) => {
              setSelection((current) =>
                articleCategorySelectionAfterChange(
                  current,
                  "category",
                  event.target.value,
                ),
              );
            }}
            className={selectClassName}
          >
            <option value="">Bez kategorije</option>
            {rootCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Grupa">
          <select
            name="siteGroupId"
            value={siteGroupId}
            disabled={!siteCategoryId || groups.length === 0}
            onChange={(event) => {
              setSelection((current) =>
                articleCategorySelectionAfterChange(
                  current,
                  "group",
                  event.target.value,
                ),
              );
            }}
            className={selectClassName}
          >
            <option value="">Bez grupe</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Podgrupa">
          <select
            name="siteSubgroupId"
            value={siteSubgroupId}
            disabled={!siteGroupId || subgroups.length === 0}
            onChange={(event) =>
              setSelection((current) =>
                articleCategorySelectionAfterChange(
                  current,
                  "subgroup",
                  event.target.value,
                ),
              )
            }
            className={selectClassName}
          >
            <option value="">Bez podgrupe</option>
            {subgroups.map((subgroup) => (
              <option key={subgroup.id} value={subgroup.id}>
                {subgroup.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-xs text-ink-500">
        Najdublji izabrani nivo određuje gde se artikal prikazuje u meniju i na
        kategorijskim stranicama.
      </p>
    </fieldset>
  );
}
