"use client";

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";

export function ProductCommercialTerms({
  initialStatus,
  tncFrom,
  tncUntil,
}: {
  initialStatus: string;
  tncFrom: string;
  tncUntil: string;
}) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    const form = markerRef.current?.closest("form");
    const select = form?.elements.namedItem("articleStatus");
    if (!(select instanceof HTMLSelectElement)) return;
    const sync = () => setStatus(select.value);
    sync();
    select.addEventListener("change", sync);
    return () => select.removeEventListener("change", sync);
  }, []);

  return (
    <>
      <span ref={markerRef} className="hidden" aria-hidden />
      {status === "DTZ" ? (
        <>
          <Field label="T&C od">
            <Input name="tncFrom" type="date" defaultValue={tncFrom} />
          </Field>
          <Field label="T&C do">
            <Input name="tncUntil" type="date" defaultValue={tncUntil} />
          </Field>
        </>
      ) : null}
    </>
  );
}
