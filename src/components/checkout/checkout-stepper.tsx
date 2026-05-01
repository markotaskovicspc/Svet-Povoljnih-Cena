"use client";

import { useEffect } from "react";
import { useCheckout, type CheckoutStep } from "@/lib/checkout/store";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const STEPS: { id: CheckoutStep; label: string; index: number }[] = [
  { id: "identity", label: "Identifikacija", index: 1 },
  { id: "shipping", label: "Podaci za isporuku", index: 2 },
  { id: "method", label: "Način isporuke", index: 3 },
  { id: "payment", label: "Plaćanje", index: 4 },
  { id: "review", label: "Potvrda", index: 5 },
];

const ORDER: CheckoutStep[] = STEPS.map((s) => s.id);

export function CheckoutStepper({ activeStep }: { activeStep: CheckoutStep }) {
  const setStep = useCheckout((s) => s.setStep);
  const activeIndex = ORDER.indexOf(activeStep);

  // Keep store in sync if parent forces a step.
  useEffect(() => {
    setStep(activeStep);
  }, [activeStep, setStep]);

  return (
    <nav aria-label="Koraci naplate" className="w-full">
      <ol className="flex items-center justify-between gap-2 overflow-x-auto sm:gap-4">
        {STEPS.map((s, i) => {
          const completed = i < activeIndex;
          const current = i === activeIndex;
          return (
            <li
              key={s.id}
              className="flex min-w-0 flex-1 items-center gap-2"
              aria-current={current ? "step" : undefined}
            >
              <span
                className={cn(
                  "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ring-1 transition",
                  completed && "bg-ink-900 text-canvas ring-ink-900",
                  current && "bg-walnut text-canvas ring-walnut",
                  !completed &&
                    !current &&
                    "ring-border/60 text-ink-500 bg-surface",
                )}
                aria-hidden
              >
                {completed ? <Check className="size-3.5" /> : s.index}
              </span>
              <span
                className={cn(
                  "hidden truncate text-xs sm:inline",
                  current
                    ? "text-ink-900 font-medium"
                    : completed
                      ? "text-ink-700"
                      : "text-ink-500",
                )}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "ml-1 hidden h-px flex-1 sm:block",
                    completed ? "bg-ink-900/40" : "bg-border/60",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
