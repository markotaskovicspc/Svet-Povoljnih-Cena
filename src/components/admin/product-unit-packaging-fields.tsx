"use client";

import { useMemo, useState } from "react";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import {
  deliveryCategory,
  packageVolumetricDimension,
} from "@/lib/delivery-tariff";

type DimensionKey = "width" | "depth" | "height";

function initialDimension(value: number | null) {
  return value != null && value > 0 ? String(value) : "";
}

export function ProductUnitPackagingFields({
  widthCm,
  depthCm,
  heightCm,
  palletQty,
}: {
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  palletQty: number | null;
}) {
  const [dimensions, setDimensions] = useState<Record<DimensionKey, string>>({
    width: initialDimension(widthCm),
    depth: initialDimension(depthCm),
    height: initialDimension(heightCm),
  });
  const calculated = useMemo(() => {
    const values = [
      Number(dimensions.width),
      Number(dimensions.depth),
      Number(dimensions.height),
    ];
    const complete = values.every(
      (value) => Number.isFinite(value) && value > 0,
    );
    const category = complete ? deliveryCategory(values) : null;
    const volumetricDimension = complete
      ? packageVolumetricDimension(values)
      : null;
    return {
      category,
      volumetricDimension,
    };
  }, [dimensions]);

  const dimensionInput = (
    key: DimensionKey,
    name: string,
    label: string,
  ) => (
    <Field label={label}>
      <Input
        name={name}
        type="number"
        min={0}
        step="0.01"
        value={dimensions[key]}
        onChange={(event) =>
          setDimensions((current) => ({
            ...current,
            [key]: event.target.value,
          }))
        }
      />
    </Field>
  );

  return (
    <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
      <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
        Pakovanje pojedinačnog artikla
      </legend>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {dimensionInput("width", "unitPackWidthCm", "Širina (cm)")}
        {dimensionInput("depth", "unitPackDepthCm", "Dubina (cm)")}
        {dimensionInput("height", "unitPackHeightCm", "Visina (cm)")}
        <Field label="Komada na paleti">
          <Input
            name="palletQty"
            type="number"
            min={1}
            step={1}
            defaultValue={palletQty ?? ""}
          />
        </Field>
        <Field label="Volumetrijska dimenzija">
          <Input
            readOnly
            value={
              calculated.volumetricDimension === null
                ? "Dopunite dimenzije"
                : `${calculated.volumetricDimension.toLocaleString("sr-Latn-RS", {
                    maximumFractionDigits: 2,
                  })} cm`
            }
          />
          <p className="mt-1 text-xs text-ink-500">
            {calculated.category
              ? `Kategorija ${calculated.category === 1 ? "I" : "II"}`
              : calculated.volumetricDimension === 300
                ? "Granica od tačno 300 cm ostaje bez automatske kategorije"
              : "Najveća + 2 × druga + 2 × treća dimenzija"}
          </p>
        </Field>
      </div>
    </fieldset>
  );
}
