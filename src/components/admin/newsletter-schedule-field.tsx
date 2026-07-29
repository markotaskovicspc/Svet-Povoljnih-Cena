"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

export function NewsletterScheduleField({ defaultIso }: { defaultIso?: string | null }) {
  const initial = defaultIso ? toLocalInput(new Date(defaultIso)) : "";
  const [localValue, setLocalValue] = useState(initial);
  const iso = localValue ? new Date(localValue).toISOString() : "";
  return (
    <>
      <Input
        aria-label="Datum i vreme slanja"
        type="datetime-local"
        value={localValue}
        onChange={(event) => setLocalValue(event.target.value)}
      />
      <input type="hidden" name="scheduledAtIso" value={iso} />
      <p className="mt-1 text-xs text-ink-500">Vreme se tumači u zoni ovog uređaja i čuva kao apsolutni trenutak.</p>
    </>
  );
}

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
