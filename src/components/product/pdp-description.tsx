"use client";

import { useState } from "react";

export function PdpDescription({
  description,
}: {
  description: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const clean = description.trim();
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  const initial = sentences.slice(0, 3).join(" ").trim();
  const hasMore = sentences.length > 3;
  const visible = expanded || !hasMore ? clean : initial;

  return (
    <div>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-700">
        {visible}
      </p>
      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 text-sm font-semibold text-brand-blue transition hover:text-walnut focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
          aria-expanded={expanded}
        >
          {expanded ? "Prikaži manje" : "Pročitaj više"}
        </button>
      ) : null}
    </div>
  );
}
