"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FormProvider,
  useForm,
  useFormContext,
  type SubmitHandler,
  type SubmitErrorHandler,
} from "react-hook-form";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/hooks/use-cart";
import {
  ASSEMBLY_PRICE_DEFAULT,
  PAYMENT_LABELS,
  SHIPPING_PRICES,
  useCheckout,
  type CheckoutStep,
  type IdentityChoice,
} from "@/lib/checkout/store";
import { cn } from "@/lib/utils";
import { formatRsd } from "@/lib/format";
import type {
  Address,
  Order,
  PaymentMethod,
  ShippingMethod,
  SKU,
} from "@/types";
import { CheckoutStepper } from "./checkout-stepper";
import { IdentityStep } from "./identity-step";
import { ShippingForm } from "./shipping-form";
import { ShippingMethodStep } from "./shipping-method";
import { VoucherSection } from "./voucher-section";
import { PaymentMethodStep } from "./payment-method";
import { NotesConsent } from "./notes-consent";
import { OrderSummary, computeTotals } from "./order-summary";

export interface CheckoutAddress {
  liceType: "fizicko" | "pravno";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  companyName?: string;
  pib?: string;
}

export interface CheckoutFormData {
  identity: IdentityChoice;
  shipping: CheckoutAddress;
  shipToDifferent: boolean;
  billing?: CheckoutAddress;
  shippingMethod: ShippingMethod;
  perItemAssembly: Record<SKU, boolean>;
  paymentMethod: PaymentMethod;
  voucherCode?: string;
  notes?: string;
  consent: boolean;
}

const STEP_ORDER: CheckoutStep[] = [
  "identity",
  "shipping",
  "method",
  "payment",
  "review",
];

const STEP_TITLES: Record<CheckoutStep, string> = {
  identity: "Kako želite da nastavite?",
  shipping: "Podaci za isporuku",
  method: "Način isporuke",
  payment: "Način plaćanja",
  review: "Pregled i potvrda",
};

/**
 * Phase 2 checkout orchestrator.
 * Holds the unified RHF form, advances steps, and on final submit synthesizes
 * a mocked Order, persists it in checkout store, clears the cart and routes to
 * `/checkout/potvrda`. Real `POST /api/orders` lands in Phase 3.
 */
export function CheckoutFlow() {
  const router = useRouter();
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);
  const clearCart = useCart((s) => s.clear);

  const step = useCheckout((s) => s.step);
  const setStep = useCheckout((s) => s.setStep);
  const identity = useCheckout((s) => s.identity);
  const setIdentity = useCheckout((s) => s.setIdentity);
  const voucher = useCheckout((s) => s.voucher);
  const setLastOrder = useCheckout((s) => s.setLastOrder);
  const reset = useCheckout((s) => s.reset);

  const methods = useForm<CheckoutFormData>({
    mode: "onBlur",
    defaultValues: {
      identity: "guest",
      shipping: {
        liceType: "fizicko",
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        street: "",
        city: "",
        postalCode: "",
        country: "RS",
      },
      shipToDifferent: false,
      shippingMethod: "kurir",
      perItemAssembly: {},
      paymentMethod: "kartica",
      voucherCode: "",
      notes: "",
      consent: false,
    },
  });

  const { handleSubmit, watch, trigger, formState } = methods;
  const shippingMethod = watch("shippingMethod");
  const paymentMethod = watch("paymentMethod");
  const perItemAssembly = watch("perItemAssembly");

  // Keep identity in store + form synced.
  useEffect(() => {
    if (identity) methods.setValue("identity", identity, { shouldDirty: false });
  }, [identity, methods]);

  const stepIndex = STEP_ORDER.indexOf(step);

  const next = async () => {
    const ok = await validateStep(step, trigger, identity);
    if (!ok) return;
    const i = STEP_ORDER.indexOf(step);
    if (i < STEP_ORDER.length - 1) setStep(STEP_ORDER[i + 1]!);
  };
  const prev = () => {
    const i = STEP_ORDER.indexOf(step);
    if (i > 0) setStep(STEP_ORDER[i - 1]!);
  };

  const onSubmit: SubmitHandler<CheckoutFormData> = (data) => {
    const order = buildOrder({ data, lines, voucherFraction: voucher?.amount ?? 0, voucherCode: voucher?.code });
    setLastOrder(order);
    clearCart();
    setStep("identity"); // ready for next purchase
    router.push("/checkout/potvrda");
  };

  const onInvalid: SubmitErrorHandler<CheckoutFormData> = () => {
    // Scroll to first invalid field.
    if (typeof document === "undefined") return;
    const el = document.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  };

  // Empty-cart guard.
  if (hydrated && lines.length === 0 && !useCheckout.getState().lastOrder) {
    return <EmptyCartCard onReset={reset} />;
  }

  return (
    <FormProvider {...methods}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form
          onSubmit={handleSubmit(onSubmit, onInvalid)}
          noValidate
          className="bg-surface ring-border/60 rounded-2xl p-5 ring-1 sm:p-7"
        >
          <CheckoutStepper activeStep={step} />

          <div className="border-border/60 mt-6 border-t pt-6">
            <h2 className="font-display text-xl text-ink-900 sm:text-2xl">
              {STEP_TITLES[step]}
            </h2>
            <div className="mt-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  {step === "identity" ? (
                    <IdentityStep
                      value={identity}
                      onPick={(c) => {
                        setIdentity(c);
                        methods.setValue("identity", c, { shouldDirty: true });
                      }}
                    />
                  ) : null}
                  {step === "shipping" ? <ShippingForm /> : null}
                  {step === "method" ? (
                    <div className="flex flex-col gap-5">
                      <ShippingMethodStep />
                      <VoucherSection />
                    </div>
                  ) : null}
                  {step === "payment" ? <PaymentMethodStep /> : null}
                  {step === "review" ? (
                    <ReviewStep />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <div className="border-border/60 mt-7 flex items-center justify-between gap-3 border-t pt-5">
            <button
              type="button"
              onClick={prev}
              disabled={stepIndex === 0}
              className={cn(
                "ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none",
                stepIndex === 0 && "pointer-events-none opacity-40",
              )}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Nazad
            </button>

            {step !== "review" ? (
              <button
                type="button"
                onClick={next}
                className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
              >
                Nastavi
                <ArrowRight className="size-4" aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={formState.isSubmitting}
                className="bg-action hover:bg-action/90 focus-visible:ring-action/40 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
              >
                {formState.isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                Potvrdi porudžbinu
              </button>
            )}
          </div>
        </form>

        <OrderSummary
          shippingMethod={shippingMethod}
          paymentMethod={paymentMethod}
          perItemAssembly={perItemAssembly}
          cta={
            step === "review" ? (
              <p className="text-[11px] text-ink-500">
                Klikom na „Potvrdi porudžbinu” prihvatate iznos i Uslove kupovine.
              </p>
            ) : undefined
          }
        />
      </div>

      {step === "review" ? null : (
        <div className="sr-only" aria-live="polite">
          Trenutni korak: {STEP_TITLES[step]}
        </div>
      )}
    </FormProvider>
  );
}

function ReviewStep() {
  const data = useFormContext<CheckoutFormData>().getValues();
  const lines = useCart((s) => s.lines);
  const voucher = useCheckout((s) => s.voucher);
  const totals = useMemo(
    () =>
      computeTotals({
        itemsFull: lines.reduce((n, l) => n + l.unitPriceFull * l.qty, 0),
        itemsSale: lines.reduce((n, l) => n + l.unitPriceSale * l.qty, 0),
        shippingMethod: data.shippingMethod,
        assemblyTotal:
          data.shippingMethod === "kamion"
            ? lines.reduce(
                (n, l) =>
                  n +
                  (data.perItemAssembly?.[l.sku]
                    ? ASSEMBLY_PRICE_DEFAULT * l.qty
                    : 0),
                0,
              )
            : 0,
        voucherFraction: voucher?.amount ?? 0,
      }),
    [lines, data.shippingMethod, data.perItemAssembly, voucher],
  );

  return (
    <div className="flex flex-col gap-5">
      <ReviewBlock title="Isporuka">
        <p className="text-sm text-ink-700">
          {data.shipping.firstName} {data.shipping.lastName}
          <br />
          {data.shipping.street}, {data.shipping.postalCode} {data.shipping.city}
          <br />
          {data.shipping.email} · {data.shipping.phone}
        </p>
        {data.shipping.liceType === "pravno" ? (
          <p className="text-xs text-ink-500">
            {data.shipping.companyName} · PIB {data.shipping.pib}
          </p>
        ) : null}
      </ReviewBlock>
      <ReviewBlock title="Način isporuke">
        <p className="text-sm text-ink-700">
          {data.shippingMethod === "kurir"
            ? "Kurirska služba"
            : "Kamionska isporuka"}{" "}
          · {formatRsd(SHIPPING_PRICES[data.shippingMethod])}
        </p>
      </ReviewBlock>
      <ReviewBlock title="Plaćanje">
        <p className="text-sm text-ink-700">{PAYMENT_LABELS[data.paymentMethod]}</p>
      </ReviewBlock>
      <ReviewBlock title="Iznos">
        <p className="text-sm text-ink-700 tabular-nums">
          Ukupno za plaćanje:{" "}
          <span className="font-medium text-ink-900">{formatRsd(totals.total)}</span>
        </p>
      </ReviewBlock>

      <div className="border-border/60 border-t pt-5">
        <NotesConsent />
      </div>
    </div>
  );
}

function ReviewBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-canvas ring-border/60 rounded-xl p-4 ring-1">
      <p className="text-xs font-medium text-ink-500 uppercase tracking-wide">
        {title}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function EmptyCartCard({ onReset }: { onReset: () => void }) {
  return (
    <div className="bg-surface ring-border/60 mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center ring-1">
      <span className="bg-muted-bg text-ink-500 inline-flex size-14 items-center justify-center rounded-full">
        <ShoppingBag className="size-6" aria-hidden />
      </span>
      <h2 className="font-display text-lg text-ink-900">
        Korpa je prazna
      </h2>
      <p className="text-sm text-ink-500">
        Dodajte artikle u korpu pre nego što nastavite na naplatu.
      </p>
      <Link
        href="/akcija"
        onClick={onReset}
        className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 mt-2 inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
      >
        Pogledaj akciju
      </Link>
    </div>
  );
}

/* ─────────────────────────  helpers  ───────────────────────── */

async function validateStep(
  step: CheckoutStep,
  trigger: ReturnType<typeof useForm<CheckoutFormData>>["trigger"],
  identity: IdentityChoice | null,
): Promise<boolean> {
  switch (step) {
    case "identity":
      return identity !== null;
    case "shipping":
      return trigger(["shipping"]);
    case "method":
      return trigger(["shippingMethod"]);
    case "payment":
      return trigger(["paymentMethod"]);
    default:
      return true;
  }
}

function buildOrder({
  data,
  lines,
  voucherFraction,
  voucherCode,
}: {
  data: CheckoutFormData;
  lines: ReturnType<typeof useCart.getState>["lines"];
  voucherFraction: number;
  voucherCode?: string;
}): Order {
  const itemsFull = lines.reduce((n, l) => n + l.unitPriceFull * l.qty, 0);
  const itemsSale = lines.reduce((n, l) => n + l.unitPriceSale * l.qty, 0);
  const assemblyTotal =
    data.shippingMethod === "kamion"
      ? lines.reduce(
          (n, l) =>
            n +
            (data.perItemAssembly?.[l.sku]
              ? ASSEMBLY_PRICE_DEFAULT * l.qty
              : 0),
          0,
        )
      : 0;
  const totals = computeTotals({
    itemsFull,
    itemsSale,
    shippingMethod: data.shippingMethod,
    assemblyTotal,
    voucherFraction,
  });

  const orderNumber = `SPC-${new Date().getFullYear()}-${String(
    Math.floor(100000 + Math.random() * 899999),
  )}`;

  const shippingAddress: Address = {
    id: "shipping",
    firstName: data.shipping.firstName,
    lastName: data.shipping.lastName,
    phone: data.shipping.phone,
    street: data.shipping.street,
    city: data.shipping.city,
    postalCode: data.shipping.postalCode,
    country: data.shipping.country || "RS",
    companyName: data.shipping.companyName,
    pib: data.shipping.pib,
  };

  const billingAddress: Address | undefined =
    data.shipToDifferent && data.billing
      ? {
          id: "billing",
          firstName: data.billing.firstName,
          lastName: data.billing.lastName,
          phone: data.billing.phone,
          street: data.billing.street,
          city: data.billing.city,
          postalCode: data.billing.postalCode,
          country: data.billing.country || "RS",
          companyName: data.billing.companyName,
          pib: data.billing.pib,
        }
      : undefined;

  const now = new Date().toISOString();
  return {
    id: orderNumber,
    guestEmail: data.identity === "guest" ? data.shipping.email : undefined,
    status: "kreirano",
    items: lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      qty: l.qty,
      unitPriceFull: l.unitPriceFull,
      unitPriceSale: l.unitPriceSale,
      withAssembly: Boolean(data.perItemAssembly?.[l.sku]),
      assemblyPrice: data.perItemAssembly?.[l.sku]
        ? ASSEMBLY_PRICE_DEFAULT
        : undefined,
      thumbnailUrl: l.thumbnailUrl,
    })),
    subtotal: totals.itemsSale,
    savings: totals.savings,
    shipping: totals.shipping,
    assemblyTotal: totals.assembly,
    voucherCode,
    voucherDiscount: totals.voucherDiscount || undefined,
    total: totals.total,
    shippingMethod: data.shippingMethod,
    paymentMethod: data.paymentMethod,
    shippingAddress,
    billingAddress,
    notes: data.notes,
    createdAt: now,
    updatedAt: now,
  };
}
