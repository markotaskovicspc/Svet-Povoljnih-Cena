"use client";

import { useState } from "react";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";

type RecommendationScope = "GROUP" | "PRODUCT";

export function RecommendationScopeFields({
  groups,
  initialScope = "GROUP",
  initialGroupId = "",
  initialSourceProductSku = "",
}: {
  groups: { id: string; name: string }[];
  initialScope?: RecommendationScope;
  initialGroupId?: string;
  initialSourceProductSku?: string;
}) {
  const [scope, setScope] = useState<RecommendationScope>(initialScope);

  return (
    <>
      <Field
        label="Nivo pravila"
        hint="Pravilo za artikal ima prednost nad pravilom njegove grupe."
      >
        <select
          name="scope"
          value={scope}
          onChange={(event) =>
            setScope(event.target.value === "PRODUCT" ? "PRODUCT" : "GROUP")
          }
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          aria-label="Nivo pravila preporuke"
        >
          <option value="GROUP">Cela grupa artikala</option>
          <option value="PRODUCT">Jedan konkretan artikal</option>
        </select>
      </Field>

      {scope === "GROUP" ? (
        <Field label="Grupa">
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
