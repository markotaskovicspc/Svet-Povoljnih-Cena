"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProductNewnessFieldProps = {
  value: string;
  automaticValue: string;
  automatic: boolean;
};

export function ProductNewnessField({
  value,
  automaticValue,
  automatic,
}: ProductNewnessFieldProps) {
  const [date, setDate] = useState(value);
  const [isAutomatic, setIsAutomatic] = useState(automatic);

  const stateLabel = isAutomatic
    ? `Automatski rok: ${automaticValue}`
    : date
      ? `Ručni rok: ${date}`
      : "Proizvod se ne prikazuje kao „Novo“";

  return (
    <fieldset className="space-y-1.5 text-sm">
      <legend className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
        Novo do
      </legend>
      <input
        type="hidden"
        name="newUntilAutomatic"
        value={isAutomatic ? "true" : "false"}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="product-new-until">
          Novo do
        </label>
        <Input
          id="product-new-until"
          name="newUntil"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setIsAutomatic(false);
          }}
        />
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDate(automaticValue);
              setIsAutomatic(true);
            }}
          >
            Vrati automatski
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDate("");
              setIsAutomatic(false);
            }}
          >
            Ukloni iz „Novo“
          </Button>
        </div>
      </div>
      <p className="text-xs text-ink-500" aria-live="polite">
        {stateLabel}. Izmena se primenjuje kada sačuvate proizvod.
      </p>
    </fieldset>
  );
}
