"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FormProvider,
  useForm,
  useFormContext,
  useWatch,
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

export interface CheckoutDeliveryPoint {
  code: string;
  name: string;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  label?: string | null;
}

export interface CheckoutFormData {
  identity: IdentityChoice;
  shipping: CheckoutAddress;
  shipToDifferent: boolean;
  billing?: CheckoutAddress;
  shippingMethod: ShippingMethod;
  glsDeliveryPoint?: CheckoutDeliveryPoint | null;
  perItemAssembly: Record<SKU, boolean>;
  paymentMethod: PaymentMethod;
  voucherCode?: string;
  notes?: string;
  consent: boolean;
}

export interface CheckoutInitialCustomer {
  authenticated?: boolean;
  name?: string;
  email?: string | null;
  address?: Partial<CheckoutAddress>;
}

type CreateOrderApiResponse =
  | {
      ok: true;
      data: {
        id: string;
        number: string;
        total: number;
        paymentMethod: string;
        shippingMethod: string;
      };
    }
  | { ok: false; error?: { code?: string; reason?: string; sku?: string } };

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
export function CheckoutFlow({
  initialCustomer,
  glsDeliveryPointsEnabled = false,
}: {
  initialCustomer?: CheckoutInitialCustomer;
  glsDeliveryPointsEnabled?: boolean;
}) {
  const router = useRouter();
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
      glsDeliveryPoint: null,
      perItemAssembly: {},
      paymentMethod: "pouzece_gotovina",
      voucherCode: "",
      notes: "",
      consent: false,
    },
  });

  const { handleSubmit, trigger, getValues, setValue, formState } = methods;
  const shippingMethod = useWatch({
    control: methods.control,
    name: "shippingMethod",
  });
  const paymentMethod = useWatch({
    control: methods.control,
    name: "paymentMethod",
  });
  const perItemAssembly = useWatch({
    control: methods.control,
    name: "perItemAssembly",
  });
  const isAuthenticatedCustomer = initialCustomer?.authenticated === true;

  useEffect(() => {
    const activeSkus = new Set(lines.map((line) => line.sku));
    const current = getValues("perItemAssembly") ?? {};
    const next = Object.fromEntries(
      Object.entries(current).filter(([sku]) => activeSkus.has(sku)),
    ) as Record<SKU, boolean>;

    if (Object.keys(next).length !== Object.keys(current).length) {
      setValue("perItemAssembly", next, { shouldDirty: true });
    }
  }, [getValues, lines, setValue]);

  // Keep identity in store + form synced.
  useEffect(() => {
    if (identity) methods.setValue("identity", identity, { shouldDirty: false });
  }, [identity, methods]);

  useEffect(() => {
    if (!isAuthenticatedCustomer) return;
    setIdentity("login");
    methods.setValue("identity", "login", { shouldDirty: false });
  }, [isAuthenticatedCustomer, methods, setIdentity]);

  useEffect(() => {
    const remembered = readRememberedCheckout();
    const parsedName = splitFullName(initialCustomer?.name);
    const source: Partial<CheckoutAddress> = {
      ...remembered?.shipping,
      ...initialCustomer?.address,
      email: initialCustomer?.email ?? initialCustomer?.address?.email ?? remembered?.shipping?.email,
      firstName:
        initialCustomer?.address?.firstName ??
        remembered?.shipping?.firstName ??
        parsedName.firstName,
      lastName:
        initialCustomer?.address?.lastName ??
        remembered?.shipping?.lastName ??
        parsedName.lastName,
    };

    (Object.entries(source) as Array<[keyof CheckoutAddress, unknown]>).forEach(
      ([key, value]) => {
        if (value == null || value === "") return;
        const field = `shipping.${key}` as const;
        const current = getValues(field);
        const dirty = formState.dirtyFields.shipping?.[key];
        if (!dirty && !current) {
          setValue(field, value as never, { shouldDirty: false, shouldTouch: false });
        }
      },
    );
  }, [formState.dirtyFields.shipping, getValues, initialCustomer, setValue]);

  const stepIndex = STEP_ORDER.indexOf(step);
  const isCompactDesktopStep = step === "shipping" || step === "payment";
  const lastHistoryStep = useRef<CheckoutStep>(step);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (lastHistoryStep.current === step) return;
    lastHistoryStep.current = step;
    window.history.pushState({ spcCheckoutStep: step }, "", window.location.href);
  }, [step]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const current = useCheckout.getState().step;
      const currentIndex = STEP_ORDER.indexOf(current);
      if (currentIndex > 0) {
        const previous = STEP_ORDER[currentIndex - 1]!;
        lastHistoryStep.current = previous;
        setStep(previous);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setStep]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [step]);

  const next = async () => {
    if (isAdvancing) return;
    setIsAdvancing(true);
    try {
      const ok = await validateStep(step, trigger, getValues, identity);
      if (!ok) {
        focusFirstInvalidField();
        return;
      }
      if (step === "shipping") rememberCheckoutFields(getValues());
      const i = STEP_ORDER.indexOf(step);
      if (i < STEP_ORDER.length - 1) setStep(STEP_ORDER[i + 1]!);
    } finally {
      setIsAdvancing(false);
    }
  };
  const prev = () => {
    const i = STEP_ORDER.indexOf(step);
    if (i > 0) setStep(STEP_ORDER[i - 1]!);
  };

  const onSubmit: SubmitHandler<CheckoutFormData> = async (data) => {
    setSubmitError(null);
    rememberCheckoutFields(data);
    const response = await fetch("/api/checkout/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildCreateOrderPayload(data, lines)),
    });
    const result = (await response.json().catch(() => null)) as
      | CreateOrderApiResponse
      | null;
    if (!response.ok || !result?.ok) {
      setSubmitError(readCreateOrderError(result));
      return;
    }

    const order = buildOrder({
      data,
      lines,
      voucherDiscountRsd: voucher?.discountRsd ?? 0,
      voucherCode: voucher?.code,
      orderNumber: result.data.number,
    });
    setLastOrder(order);
    clearCart();
    setStep("identity"); // ready for next purchase
    if (data.paymentMethod === "ips") {
      router.push(`/api/payment/ips/start/${encodeURIComponent(result.data.number)}`);
      return;
    }
    if (
      data.paymentMethod === "kartica" ||
      data.paymentMethod === "google_pay" ||
      data.paymentMethod === "apple_pay"
    ) {
      router.push(`/api/payment/wspay/start/${encodeURIComponent(result.data.number)}`);
      return;
    }
    router.push(`/checkout/potvrda?order=${encodeURIComponent(result.data.number)}`);
  };

  const onInvalid: SubmitErrorHandler<CheckoutFormData> = () => {
    focusFirstInvalidField();
  };

  function focusFirstInvalidField() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    });
  }

  // Empty-cart guard.
  if (hydrated && lines.length === 0 && !useCheckout.getState().lastOrder) {
    return <EmptyCartCard onReset={reset} />;
  }

  return (
    <FormProvider {...methods}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        <form
          onSubmit={handleSubmit(onSubmit, onInvalid)}
          noValidate
          className={cn(
            "bg-surface ring-border/60 rounded-2xl p-4 pb-24 ring-1 sm:p-5 md:pb-5",
            isCompactDesktopStep && "lg:p-4",
            step === "review" && "lg:p-5",
          )}
        >
          <CheckoutStepper activeStep={step} />

          <div
            className={cn(
              "border-border/60 border-t",
              step === "review"
                ? "mt-4 pt-4"
                : isCompactDesktopStep
                  ? "mt-4 pt-4 lg:mt-3 lg:pt-3"
                  : "mt-5 pt-5",
            )}
          >
            <h2
              className={cn(
                "font-display text-xl text-ink-900 sm:text-2xl",
                isCompactDesktopStep && "lg:text-xl",
              )}
            >
              {STEP_TITLES[step]}
            </h2>
            <div className={cn("mt-4", isCompactDesktopStep && "lg:mt-3")}>
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
                      authenticatedCustomer={
                        isAuthenticatedCustomer
                          ? {
                              name: initialCustomer?.name,
                              email: initialCustomer?.email,
                            }
                          : undefined
                      }
                      onPick={(c) => {
                        setIdentity(c);
                        methods.setValue("identity", c, { shouldDirty: true });
                      }}
                      onAuthenticatedContinue={next}
                    />
                  ) : null}
                  {step === "shipping" ? <ShippingForm /> : null}
                  {step === "method" ? (
                    <div className="flex flex-col gap-5">
                      <ShippingMethodStep
                        glsDeliveryPointsEnabled={glsDeliveryPointsEnabled}
                      />
                      <VoucherSection />
                    </div>
                  ) : null}
                  {step === "payment" ? <PaymentMethodStep /> : null}
                  {step === "review" ? (
                    <ReviewStep />
                  ) : null}
                </motion.div>
              </AnimatePresence>
              {submitError ? (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-action/30 bg-action/5 px-4 py-3 text-sm text-action"
                >
                  <p>{submitError}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href="/korpa"
                      className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-medium text-action ring-1 ring-action/25 transition hover:bg-action/10"
                    >
                      Proveri korpu
                    </Link>
                    <button
                      type="button"
                      onClick={() => setSubmitError(null)}
                      className="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium text-action ring-1 ring-action/25 transition hover:bg-action/10"
                    >
                      Nastavi proveru
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div
            className={cn(
              "border-border/60 fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 rounded-t-xl border border-x-0 border-b-0 bg-surface/95 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-soft-3 backdrop-blur md:static md:inset-auto md:rounded-none md:border-x-0 md:border-b-0 md:bg-transparent md:px-0 md:pb-0 md:shadow-none md:backdrop-blur-none",
              step === "review"
                ? "md:mt-3 md:pt-2"
                : isCompactDesktopStep
                  ? "md:mt-4 md:pt-3 lg:mt-3 lg:pt-2"
                  : "md:mt-5 md:pt-4",
            )}
          >
            <button
              type="button"
              onClick={prev}
              disabled={stepIndex === 0}
              className={cn(
                "ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center gap-2 rounded-full px-3 py-2.5 text-sm font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none md:px-4",
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
                disabled={isAdvancing}
                className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none md:px-5"
              >
                {isAdvancing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                Nastavi
                {!isAdvancing ? <ArrowRight className="size-4" aria-hidden /> : null}
              </button>
            ) : (
              <button
                type="submit"
                disabled={formState.isSubmitting}
                className="bg-action hover:bg-action/90 focus-visible:ring-action/40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white transition focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60 md:px-5"
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
        voucherDiscountRsd: voucher?.discountRsd ?? 0,
      }),
    [lines, data.shippingMethod, data.perItemAssembly, voucher],
  );

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] lg:items-start lg:gap-4">
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-3">
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
          {data.shippingMethod === "kurir" && data.glsDeliveryPoint ? (
            <p className="mt-1 text-xs text-ink-500">
              MyGLS paket tačka: {data.glsDeliveryPoint.label ?? data.glsDeliveryPoint.name}
            </p>
          ) : null}
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
      </div>

      <div className="border-border/60 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
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
    <div className="bg-canvas ring-border/60 rounded-xl p-4 ring-1 lg:p-3">
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
  getValues: ReturnType<typeof useForm<CheckoutFormData>>["getValues"],
  identity: IdentityChoice | null,
): Promise<boolean> {
  switch (step) {
    case "identity":
      return identity !== null;
    case "shipping":
      return trigger(
        [
          ...addressFieldNames("shipping", getValues("shipping.liceType")),
          ...(getValues("shipToDifferent")
            ? addressFieldNames("billing", getValues("billing.liceType"))
            : []),
        ],
        { shouldFocus: true },
      );
    case "method":
      return trigger(["shippingMethod"], { shouldFocus: true });
    case "payment":
      return trigger(["paymentMethod"], { shouldFocus: true });
    default:
      return true;
  }
}

const REMEMBERED_CHECKOUT_KEY = "spc-checkout-fields";

function splitFullName(value: string | null | undefined) {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

function readRememberedCheckout():
  | { shipping?: Partial<CheckoutAddress> }
  | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(REMEMBERED_CHECKOUT_KEY) ?? "null");
  } catch {
    return null;
  }
}

function rememberCheckoutFields(data: CheckoutFormData) {
  if (typeof window === "undefined") return;
  const safeShipping: Partial<CheckoutAddress> = {
    liceType: data.shipping.liceType,
    firstName: data.shipping.firstName,
    lastName: data.shipping.lastName,
    email: data.shipping.email,
    phone: data.shipping.phone,
    street: data.shipping.street,
    city: data.shipping.city,
    postalCode: data.shipping.postalCode,
    country: data.shipping.country || "RS",
    companyName: data.shipping.companyName,
    pib: data.shipping.pib,
  };
  try {
    window.localStorage.setItem(
      REMEMBERED_CHECKOUT_KEY,
      JSON.stringify({ shipping: safeShipping }),
    );
  } catch {
    // Ignore storage failures; checkout must keep working without persistence.
  }
}

function addressFieldNames(
  prefix: "shipping" | "billing",
  liceType: CheckoutAddress["liceType"] | undefined,
) {
  const fields: Array<`shipping.${keyof CheckoutAddress}` | `billing.${keyof CheckoutAddress}`> = [
    `${prefix}.firstName`,
    `${prefix}.lastName`,
    `${prefix}.email`,
    `${prefix}.phone`,
    `${prefix}.street`,
    `${prefix}.city`,
    `${prefix}.postalCode`,
  ];
  if (liceType === "pravno") {
    fields.unshift(`${prefix}.companyName`, `${prefix}.pib`);
  }
  return fields;
}

const PAYMENT_METHOD_UPPER = {
  ips: "IPS",
  kartica: "KARTICA",
  google_pay: "GOOGLE_PAY",
  apple_pay: "APPLE_PAY",
  uplata_na_racun: "UPLATA_NA_RACUN",
  pouzece_gotovina: "POUZECE_GOTOVINA",
  pouzece_kartica: "POUZECE_KARTICA",
} as const satisfies Record<PaymentMethod, string>;

const SHIPPING_METHOD_UPPER = {
  kurir: "KURIR",
  kamion: "KAMION",
} as const satisfies Record<ShippingMethod, string>;

function buildCreateOrderPayload(
  data: CheckoutFormData,
  lines: ReturnType<typeof useCart.getState>["lines"],
) {
  const shipping = addressForApi(data.shipping);
  const billing =
    data.shipToDifferent && data.billing ? addressForApi(data.billing) : undefined;

  return {
    guestEmail: data.identity === "guest" ? data.shipping.email : undefined,
    lines: lines.map((line) => ({
      sku: line.sku,
      qty: line.qty,
      withAssembly: Boolean(data.perItemAssembly?.[line.sku]),
    })),
    shipping,
    glsDeliveryPoint:
      data.shippingMethod === "kurir" ? data.glsDeliveryPoint ?? undefined : undefined,
    billingSameAsShipping: !data.shipToDifferent,
    billing,
    shippingMethod: SHIPPING_METHOD_UPPER[data.shippingMethod],
    paymentMethod: PAYMENT_METHOD_UPPER[data.paymentMethod],
    voucherCode: data.voucherCode || undefined,
    notes: data.notes || undefined,
    consent: data.consent,
  };
}

function addressForApi(address: CheckoutAddress) {
  return {
    firstName: address.firstName,
    lastName: address.lastName,
    phone: address.phone,
    street: address.street,
    city: address.city,
    postalCode: address.postalCode,
    country: address.country || "RS",
    companyName: address.companyName || undefined,
    pib: address.pib || undefined,
  };
}

function readCreateOrderError(result: CreateOrderApiResponse | null): string {
  const error = result && !result.ok ? result.error : null;
  switch (error?.code) {
    case "OUT_OF_STOCK":
      return `Artikal ${error.sku ?? ""} trenutno nema dovoljno zaliha.`;
    case "INACTIVE":
      return `Artikal ${error.sku ?? ""} više nije dostupan.`;
    case "VOUCHER_INVALID":
      return error.reason ?? "Vaučer nije važeći.";
    case "INVALID":
      return "Proverite obavezna polja i saglasnost pre potvrde porudžbine.";
    case "GUEST_REQUIRES_EMAIL":
      return "Unesite e-mail adresu za porudžbinu kao gost.";
    case "DELIVERY_POINT_INVALID":
      return "Izabrana MyGLS paket tačka više nije dostupna. Izaberite drugu lokaciju ili dostavu na adresu.";
    case "EMPTY_CART":
      return "Korpa je prazna.";
    default:
      return "Porudžbinu trenutno nije moguće kreirati. Proverite podatke i pokušajte ponovo.";
  }
}

function buildOrder({
  data,
  lines,
  voucherDiscountRsd,
  voucherCode,
  orderNumber,
}: {
  data: CheckoutFormData;
  lines: ReturnType<typeof useCart.getState>["lines"];
  voucherDiscountRsd: number;
  voucherCode?: string;
  orderNumber: string;
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
    voucherDiscountRsd,
  });

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
