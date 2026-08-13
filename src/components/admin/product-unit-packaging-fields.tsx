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
}: {
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
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
    const category = deliveryCategory(values);
    return {
      category,
      volumetricDimension: category
        ? packageVolumetricDimension(values)
        : null,
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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {dimensionInput("width", "unitPackWidthCm", "Širina (cm)")}
        {dimensionInput("depth", "unitPackDepthCm", "Dubina (cm)")}
        {dimensionInput("height", "unitPackHeightCm", "Visina (cm)")}
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
              : "Najveća + 2 × druga + 2 × treća dimenzija"}
          </p>
        </Field>
      </div>
    </fieldset>
  );
}
