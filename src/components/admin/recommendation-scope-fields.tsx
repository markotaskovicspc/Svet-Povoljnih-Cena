"use client";

import { useState } from "react";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";

type RecommendationScope = "GROUP" | "PRODUCT" | "CATEGORY";

export function RecommendationScopeFields({
  groups,
  categories = [],
  initialScope = "CATEGORY",
  initialGroupId = "",
  initialCategoryId = "",
  initialSourceProductSku = "",
}: {
  groups: { id: string; name: string }[];
  categories?: { id: string; name: string; path: string }[];
  initialScope?: RecommendationScope;
  initialGroupId?: string;
  initialCategoryId?: string;
  initialSourceProductSku?: string;
}) {
  const [scope, setScope] = useState<RecommendationScope>(initialScope);

  return (
    <>
      <Field
        label="Nivo pravila"
        hint="Prednost imaju pravilo za artikal, zatim za grupu, pa za najužu kategoriju."
      >
        <select
          name="scope"
          value={scope}
          onChange={(event) =>
            setScope(event.target.value as RecommendationScope)
          }
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          aria-label="Nivo pravila preporuke"
        >
          <option value="CATEGORY">Cela kategorija i potkategorije</option>
          <option value="GROUP">Cela interna grupa artikala</option>
          <option value="PRODUCT">Jedan konkretan artikal</option>
        </select>
      </Field>

      {scope === "CATEGORY" ? (
        <Field label="Kategorija" hint="Preporuka važi uz sve artikle iz ove kategorije i svih njenih potkategorija.">
          <select
            name="categoryId"
            defaultValue={initialCategoryId}
            required
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            aria-label="Kategorija koja pokreće preporuku"
          >
            <option value="" disabled>— Izaberite kategoriju —</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>
                {`${"— ".repeat(Math.max(0, category.path.split("/").filter(Boolean).length - 1))}${category.name}`}
              </option>
            ))}
          </select>
        </Field>
      ) : scope === "GROUP" ? (
        <Field label="Interna grupa" hint="Važi samo za artikle iz tačno ove interne grupe.">
          <select
            name="groupId"
            defaultValue={initialGroupId}
            required
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            aria-label="Grupa koja pokreće preporuku"
          >
            <option value="" disabled>
              — Izaberite grupu —
            </option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field
          label="Izvorni SKU artikla"
          hint="Preporuke će se prikazivati samo kada kupac doda ovaj artikal."
        >
          <Input
            name="sourceProductSku"
            defaultValue={initialSourceProductSku}
            placeholder="Npr. 110081"
            required
          />
        </Field>
      )}
    </>
  );
}
