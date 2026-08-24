"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintPageButton({ label = "Štampaj" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      {label}
    </Button>
  );
}
