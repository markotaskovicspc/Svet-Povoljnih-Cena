"use client";

import { useEffect } from "react";
import { useCheckout, type CheckoutStep } from "@/lib/checkout/store";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const STEP_LABELS: Partial<Record<CheckoutStep, string>> = {
  identity: "Identifikacija",
  shipping: "Podaci za isporuku",
  payment: "Plaćanje",
  review: "Potvrda",
};

export function CheckoutStepper({
  activeStep,
  steps,
}: {
  activeStep: CheckoutStep;
  steps: CheckoutStep[];
}) {
  const setStep = useCheckout((s) => s.setStep);
  const activeIndex = steps.indexOf(activeStep);

  // Keep store in sync if parent forces a step.
  useEffect(() => {
    setStep(activeStep);
  }, [activeStep, setStep]);

  return (
    <nav aria-label="Koraci naplate" className="w-full">
      <ol className="flex items-center justify-between gap-2 overflow-x-auto sm:gap-4">
        {steps.map((stepId, i) => {
          const completed = i < activeIndex;
          const current = i === activeIndex;
          return (
            <li
              key={stepId}
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
                {completed ? <Check className="size-3.5" /> : i + 1}
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
                {STEP_LABELS[stepId]}
              </span>
              {i < steps.length - 1 ? (
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
