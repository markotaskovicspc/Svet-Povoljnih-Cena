"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export function PriceValidTo() {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => setValue("");
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);
  return (
    <div className="space-y-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">Važi do</span>
        <Input ref={input} name="validTo" type="date" value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button type="button" onClick={() => setValue("")} className="text-xs font-medium text-walnut underline">
        Bez ograničenja
      </button>
      <p className="text-xs text-ink-500">Prazno polje znači da cena važi do naredne promene.</p>
    </div>
  );
}
