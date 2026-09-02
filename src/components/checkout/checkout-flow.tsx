"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  useCheckout,
  type CheckoutStep,
  type IdentityChoice,
} from "@/lib/checkout/store";
import {
  getPaymentLabel,
  type CheckoutConfig,
  type CheckoutDeliveryQuote,
  type CheckoutPaymentMethodConfig,
} from "@/lib/checkout/config-shared";
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
import { AutomaticDeliverySection } from "./shipping-method";
import { VoucherSection } from "./voucher-section";
import { PaymentMethodStep } from "./payment-method";
import { CheckoutConsent, NotesConsent } from "./notes-consent";
import {
  OrderSummary,
  type DeliveryQuoteDisplayStatus,
} from "./order-summary";
import { getConsentedAnalyticsContext } from "@/components/analytics/first-party-analytics";
import type { SocialAuthProvider } from "@/components/account/social-auth-buttons";
import type { CustomerAuthFormAction } from "@/components/account/customer-auth-methods";
import type { LoginErrorCode } from "@/app/(account)/nalog/prijava/form";
import type { RegistrationErrorCode } from "@/app/(account)/nalog/registracija/form";
import { shouldRestoreBusinessBuyerType } from "@/lib/checkout/business-policy";

export interface CheckoutAddress {
  liceType: "fizicko" | "pravno";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  xExpressTownId?: number | null;
  xExpressStreetId?: number | null;
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
  recoveryConsent: boolean;
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
        accessToken: string;
        total: number;
        subtotal: number;
        savings: number;
        shipping: number;
        assemblyTotal: number;
        paymentMethod: string;
        shippingMethod: string;
        voucherDiscount: number;
        firstPurchaseDiscount: number;
        savedCardDiscount: number;
      };
    }
  | {
      ok: false;
      error?: { code?: string; reason?: string; sku?: string } | string;
      message?: string;
    };

const STEP_TITLES: Record<CheckoutStep, string> = {
  identity: "Kako želite da nastavite?",
  shipping: "Isporuka i plaćanje",
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
  checkoutConfig,
  initialCustomer,
  glsDeliveryPointsEnabled = false,
  xExpressAddressEnabled = false,
  firstPurchaseEligible = false,
  socialAuthProviders = [],
  loginAction,
  registrationAction,
  initialAuthIntent,
  loginError,
  registrationError,
  cartRecoveryEnabled = false,
  initialRecoveryConsent = false,
}: {
  checkoutConfig: CheckoutConfig;
  initialCustomer?: CheckoutInitialCustomer;
  glsDeliveryPointsEnabled?: boolean;
  xExpressAddressEnabled?: boolean;
  firstPurchaseEligible?: boolean;
  socialAuthProviders?: SocialAuthProvider[];
  loginAction?: CustomerAuthFormAction;
  registrationAction?: CustomerAuthFormAction;
  initialAuthIntent?: "login" | "register";
  loginError?: LoginErrorCode;
  registrationError?: RegistrationErrorCode;
  cartRecoveryEnabled?: boolean;
  initialRecoveryConsent?: boolean;
}) {
  const router = useRouter();
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(
    null,
  );
  const [resolvedDeliveryQuote, setResolvedDeliveryQuote] = useState<{
    key: string | null;
    quote: CheckoutDeliveryQuote;
  }>({ key: null, quote: checkoutConfig.deliveryQuote });
  const [deliveryQuoteError, setDeliveryQuoteError] = useState<string | null>(
    null,
  );
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
  const preferredPaymentMethod = checkoutConfig.paymentMethods.some(
    (method) => method.id === "pouzece_gotovina",
  )
    ? "pouzece_gotovina"
    : checkoutConfig.defaultPaymentMethod;

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
        xExpressTownId: null,
        xExpressStreetId: null,
        country: "RS",
      },
      shipToDifferent: false,
      shippingMethod: "kurir",
      glsDeliveryPoint: null,
      perItemAssembly: {},
      paymentMethod: preferredPaymentMethod,
      voucherCode: "",
      notes: "",
      consent: false,
      recoveryConsent: initialRecoveryConsent,
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
  const shippingCity = useWatch({
    control: methods.control,
    name: "shipping.city",
  });
  const shippingEmail = useWatch({
    control: methods.control,
    name: "shipping.email",
  });
  const recoveryConsent = useWatch({
    control: methods.control,
    name: "recoveryConsent",
  });
  const perItemAssembly = useWatch({
    control: methods.control,
    name: "perItemAssembly",
  });
  const isAuthenticatedCustomer = initialCustomer?.authenticated === true;
  const stepOrder = useMemo<CheckoutStep[]>(
    () =>
      isAuthenticatedCustomer
        ? ["shipping", "review"]
        : ["identity", "shipping", "review"],
    [isAuthenticatedCustomer],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCheckoutSessionId(getCheckoutSessionId());
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hydrated || !checkoutSessionId) return;
    const timeout = window.setTimeout(() => {
      void trackCheckoutSession({
        sessionId: checkoutSessionId,
        step,
        identity,
        guestEmail:
          identity === "guest" && isCompleteEmail(shippingEmail)
            ? shippingEmail
            : null,
        recoveryConsent: cartRecoveryEnabled && Boolean(recoveryConsent),
        shippingCity,
        shippingMethod,
        paymentMethod,
        lines,
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [
    checkoutSessionId,
    cartRecoveryEnabled,
    hydrated,
    identity,
    lines,
    paymentMethod,
    recoveryConsent,
    shippingCity,
    shippingEmail,
    shippingMethod,
    step,
  ]);

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

  useEffect(() => {
    const enabled = new Set(
      checkoutConfig.paymentMethods.map((method) => method.id),
    );
    if (enabled.has(getValues("paymentMethod"))) return;
    const nextMethod = checkoutConfig.paymentMethods.some(
      (method) => method.id === preferredPaymentMethod,
    )
      ? preferredPaymentMethod
      : (checkoutConfig.paymentMethods[0]?.id ??
        checkoutConfig.defaultPaymentMethod);
    setValue("paymentMethod", nextMethod, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [
    checkoutConfig.defaultPaymentMethod,
    checkoutConfig.paymentMethods,
    getValues,
    preferredPaymentMethod,
    setValue,
  ]);

  const quoteLineKey = useMemo(
    () =>
      lines
        .map((line) => `${line.sku}:${line.qty}`)
        .sort()
        .join("|"),
    [lines],
  );

  const deliveryQuoteKey = `${shippingCity.trim().toLocaleLowerCase("sr-Latn-RS")}|${quoteLineKey}`;
  const deliveryQuote = resolvedDeliveryQuote.quote;
  const deliveryQuoteIsCurrent =
    hydrated &&
    lines.length > 0 &&
    resolvedDeliveryQuote.key === deliveryQuoteKey;
  const selectedDeliveryPrice = deliveryQuote.prices[shippingMethod];
  const deliveryQuoteIsPayable =
    deliveryQuoteIsCurrent && selectedDeliveryPrice != null;
  const deliveryQuoteDisplayStatus = deliveryQuoteIsCurrent
    ? "ready"
    : deliveryQuoteError
      ? "error"
      : "loading";

  const refreshDeliveryQuote = useCallback(
    async (signal?: AbortSignal) => {
      setDeliveryQuoteError(null);
      try {
        const response = await fetch("/api/checkout/delivery-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            city: shippingCity,
            lines: lines.map((line) => ({ sku: line.sku, qty: line.qty })),
          }),
        });
        const result = (await response.json().catch(() => null)) as {
          ok: true;
          data: CheckoutDeliveryQuote;
        } | null;
        if (!response.ok || !result?.ok) {
          throw new Error("Dostava trenutno ne može da se obračuna.");
        }
        setResolvedDeliveryQuote({ key: deliveryQuoteKey, quote: result.data });
        const resolvedMethod = result.data.recommendedMethod;
        if (resolvedMethod && getValues("shippingMethod") !== resolvedMethod) {
          setValue("shippingMethod", resolvedMethod, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
        const selectedPrice = resolvedMethod
          ? result.data.prices[resolvedMethod]
          : null;
        if (selectedPrice == null) {
          setDeliveryQuoteError(deliveryPricingMessage(result.data.pricingIssue));
          return false;
        }
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return false;
        setDeliveryQuoteError(
          "Dostava trenutno ne može da se obračuna. Pokušajte ponovo.",
        );
        return false;
      }
    },
    [deliveryQuoteKey, getValues, lines, setValue, shippingCity],
  );

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void refreshDeliveryQuote(controller.signal);
    }, 200);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [hydrated, quoteLineKey, refreshDeliveryQuote]);

  // Keep identity in store + form synced.
  useEffect(() => {
    if (identity)
      methods.setValue("identity", identity, { shouldDirty: false });
  }, [identity, methods]);

  // The voucher can be applied in the cart before this form is mounted. Keep
  // the submitted field aligned with the authoritative checkout store.
  useEffect(() => {
    const nextCode = voucher?.code ?? "";
    if (getValues("voucherCode") === nextCode) return;
    setValue("voucherCode", nextCode, {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [getValues, setValue, voucher?.code]);

  useEffect(() => {
    if (!isAuthenticatedCustomer) return;
    setIdentity("login");
    methods.setValue("identity", "login", { shouldDirty: false });
    if (step === "identity") setStep("shipping");
  }, [isAuthenticatedCustomer, methods, setIdentity, setStep, step]);

  useEffect(() => {
    if (isAuthenticatedCustomer || !initialAuthIntent) return;
    setIdentity(initialAuthIntent);
    methods.setValue("identity", initialAuthIntent, { shouldDirty: false });
  }, [initialAuthIntent, isAuthenticatedCustomer, methods, setIdentity]);

  useEffect(() => {
    if (step === "method" || step === "payment") setStep("shipping");
  }, [setStep, step]);

  useEffect(() => {
    const remembered = readRememberedCheckout();
    const parsedName = splitFullName(initialCustomer?.name);
    const source: Partial<CheckoutAddress> = {
      ...remembered?.shipping,
      ...initialCustomer?.address,
      email:
        initialCustomer?.email ??
        initialCustomer?.address?.email ??
        remembered?.shipping?.email,
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
        const canRestoreBusinessType =
          key === "liceType" &&
          shouldRestoreBusinessBuyerType({
            current: current as CheckoutAddress["liceType"] | undefined,
            remembered: value as CheckoutAddress["liceType"] | undefined,
            dirty: Boolean(dirty),
          });
        if (!dirty && (!current || canRestoreBusinessType)) {
          setValue(field, value as never, {
            shouldDirty: false,
            shouldTouch: false,
          });
        }
      },
    );
  }, [formState.dirtyFields.shipping, getValues, initialCustomer, setValue]);

  const stepIndex = stepOrder.indexOf(step);
  const isCompactDesktopStep = step === "shipping";
  const lastHistoryStep = useRef<CheckoutStep>(step);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (lastHistoryStep.current === step) return;
    lastHistoryStep.current = step;
    window.history.pushState(
      { spcCheckoutStep: step },
      "",
      window.location.href,
    );
  }, [step]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const current = useCheckout.getState().step;
      const currentIndex = stepOrder.indexOf(current);
      if (currentIndex > 0) {
        const previous = stepOrder[currentIndex - 1]!;
        lastHistoryStep.current = previous;
        setStep(previous);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setStep, stepOrder]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const resetStepScroll = () => {
      // The sticky navigation survives between steps and keeps browser focus.
      // Blur it before resetting so focus anchoring cannot pull the viewport
      // back toward the button after the step's height changes.
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };

    resetStepScroll();
    const frame = window.requestAnimationFrame(resetStepScroll);
    // AnimatePresence changes the document height for 400 ms. Re-apply the
    // reset once that transition settles so the browser cannot clamp the old
    // bottom scroll position onto the shorter review step.
    const transitionEnd = window.setTimeout(resetStepScroll, 450);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(transitionEnd);
    };
  }, [step]);

  const next = async () => {
    if (isAdvancing) return;
    if (
      step === "identity" &&
      identity !== "guest" &&
      !isAuthenticatedCustomer
    ) {
      return;
    }
    setIsAdvancing(true);
    try {
      const ok = await validateStep(
        step,
        trigger,
        getValues,
        identity,
        xExpressAddressEnabled,
      );
      if (!ok) {
        focusFirstInvalidField();
        return;
      }
      if (step === "shipping") {
        rememberCheckoutFields(getValues());
        if (!deliveryQuoteIsCurrent) {
          const quoteReady = await refreshDeliveryQuote();
          if (!quoteReady) return;
        } else if (deliveryQuote.prices[getValues("shippingMethod")] == null) {
          setDeliveryQuoteError(deliveryPricingMessage(deliveryQuote.pricingIssue));
          return;
        }
      }
      const i = stepOrder.indexOf(step);
      if (i < stepOrder.length - 1) setStep(stepOrder[i + 1]!);
    } finally {
      setIsAdvancing(false);
    }
  };
  const prev = () => {
    const i = stepOrder.indexOf(step);
    if (i > 0) setStep(stepOrder[i - 1]!);
  };

  const onSubmit: SubmitHandler<CheckoutFormData> = async (data) => {
    setSubmitError(null);
    if (!deliveryQuoteIsPayable) {
      setSubmitError(
        deliveryQuoteIsCurrent
          ? deliveryPricingMessage(deliveryQuote.pricingIssue)
          : "Sačekajte da se obračuna tačan iznos dostave.",
      );
      return;
    }
    rememberCheckoutFields(data);
    const response = await fetch("/api/checkout/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildCreateOrderPayload(
          { ...data, voucherCode: voucher?.code ?? "" },
          lines,
          checkoutSessionId ?? getCheckoutSessionId(),
          getConsentedAnalyticsContext(),
        ),
      ),
    });
    const result = (await response
      .json()
      .catch(() => null)) as CreateOrderApiResponse | null;
    if (!response.ok || !result?.ok) {
      setSubmitError(
        readCreateOrderError(
          result,
          response.status,
          response.headers.get("Retry-After"),
        ),
      );
      return;
    }

    const order = buildOrder({
      data,
      lines,
      deliveryQuote,
      voucherCode: voucher?.code,
      orderNumber: result.data.number,
      serverPricing: result.data,
    });
    setLastOrder(order);
    clearCart();
    clearCheckoutSessionId();
    const accessQuery = `?token=${encodeURIComponent(result.data.accessToken)}`;
    if (data.paymentMethod === "ips") {
      router.push(
        `/api/payment/ips/start/${encodeURIComponent(result.data.number)}${accessQuery}`,
      );
      return;
    }
    if (
      data.paymentMethod === "kartica" ||
      data.paymentMethod === "google_pay" ||
      data.paymentMethod === "apple_pay"
    ) {
      router.push(
        `/api/payment/raiaccept/start/${encodeURIComponent(result.data.number)}${accessQuery}`,
      );
      return;
    }
    router.push(
      `/checkout/potvrda?order=${encodeURIComponent(result.data.number)}&token=${encodeURIComponent(
        result.data.accessToken,
      )}`,
    );
  };

  const onInvalid: SubmitErrorHandler<CheckoutFormData> = () => {
    focusFirstInvalidField();
  };

  function focusFirstInvalidField() {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;
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

  const requiresCheckoutAuthentication =
    step === "identity" && identity !== "guest" && !isAuthenticatedCustomer;

  const renderNavigation = (mobile: boolean) => (
    <div
      data-testid={mobile ? "mobile-checkout-navigation" : undefined}
      className={cn(
        mobile
          ? "fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(36,30,25,0.10)] backdrop-blur lg:hidden"
          : "hidden items-center justify-between gap-3 border-t border-border/60 pt-4 lg:flex",
      )}
    >
      <div
        className={cn(
          "flex w-full items-center justify-between gap-3",
          mobile && "mx-auto max-w-[var(--container-page)]",
        )}
      >
        <button
          type="button"
          onClick={prev}
          disabled={stepIndex === 0}
          className={cn(
            "ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center justify-center gap-2 rounded-full px-3 py-2.5 text-sm font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none md:px-4",
            mobile && "min-w-24",
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
            disabled={isAdvancing || requiresCheckoutAuthentication}
            className={cn(
              "bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none md:px-5",
              mobile && "flex-1",
              requiresCheckoutAuthentication &&
                "cursor-not-allowed opacity-60 hover:bg-ink-900",
            )}
          >
            {isAdvancing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {requiresCheckoutAuthentication ? "Dovršite prijavu" : "Nastavi"}
            {!isAdvancing && !requiresCheckoutAuthentication ? (
              <ArrowRight className="size-4" aria-hidden />
            ) : null}
          </button>
        ) : (
          <button
            type="submit"
            form="checkout-order-form"
            disabled={formState.isSubmitting || !deliveryQuoteIsPayable}
            className={cn(
              "bg-action hover:bg-action/90 focus-visible:ring-action/40 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white transition focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60 md:px-5",
              mobile && "flex-1",
            )}
          >
            {formState.isSubmitting || !deliveryQuoteIsCurrent ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {!deliveryQuoteIsCurrent
              ? "Obračunavam dostavu…"
              : deliveryQuoteIsPayable
                ? "Potvrdi porudžbinu"
                : "Dostava nije obračunata"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <FormProvider {...methods}>
      <div className="grid gap-5 [overflow-anchor:none] lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        <div
          className={cn(
            "bg-surface ring-border/60 rounded-2xl p-3 ring-1 sm:p-5",
            isCompactDesktopStep && "lg:p-4",
            step === "review" && "lg:p-5",
          )}
        >
          <CheckoutOrderFormBoundary
            active={step !== "identity"}
            onSubmit={handleSubmit(onSubmit, onInvalid)}
          >
            <div className="hidden sm:block">
              <CheckoutStepper activeStep={step} steps={stepOrder} />
            </div>

          <div
            className={cn(
              "sm:border-border/60 sm:border-t",
              step === "review"
                ? "sm:mt-4 sm:pt-4"
                : isCompactDesktopStep
                  ? "sm:mt-4 sm:pt-4 lg:mt-3 lg:pt-3"
                  : "sm:mt-5 sm:pt-5",
            )}
          >
            <h2
              className={cn(
                "font-display text-xl text-ink-900 sm:text-2xl",
                isCompactDesktopStep && "lg:text-xl",
                step === "shipping" && "sr-only sm:not-sr-only",
              )}
            >
              {STEP_TITLES[step]}
            </h2>
            <div
              className={cn(
                step === "shipping" ? "mt-0 sm:mt-4" : "mt-3 sm:mt-4",
                isCompactDesktopStep && "lg:mt-3",
              )}
            >
              <AnimatePresence>
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
                      socialProviders={socialAuthProviders}
                      loginAction={loginAction}
                      registrationAction={registrationAction}
                      initialAuthIntent={initialAuthIntent}
                      loginError={loginError}
                      registrationError={registrationError}
                    />
                  ) : null}
                  {step === "shipping" ? (
                    <div className="flex flex-col gap-4 sm:gap-5">
                      <ShippingForm
                        xExpressAddressEnabled={xExpressAddressEnabled}
                        cartRecoveryEnabled={cartRecoveryEnabled}
                      />
                      <AutomaticDeliverySection
                        deliveryQuote={deliveryQuote}
                        glsDeliveryPointsEnabled={glsDeliveryPointsEnabled}
                      />
                      <section
                        aria-labelledby="checkout-payment-heading"
                        className="border-border/60 flex flex-col gap-3 border-t pt-3 sm:gap-4 sm:pt-5"
                      >
                        <h3
                          id="checkout-payment-heading"
                          className="font-display text-lg text-ink-900"
                        >
                          Način plaćanja
                        </h3>
                        <PaymentMethodStep
                          methods={checkoutConfig.paymentMethods}
                        />
                      </section>
                    </div>
                  ) : null}
                  {step === "review" ? (
                    <ReviewStep
                      deliveryQuote={deliveryQuote}
                      deliveryQuoteStatus={deliveryQuoteDisplayStatus}
                      paymentMethods={checkoutConfig.paymentMethods}
                      firstPurchaseEligible={firstPurchaseEligible}
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
              {deliveryQuoteError &&
              (step === "shipping" || step === "review") ? (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-action/30 bg-action/5 px-4 py-3 text-sm text-action"
                >
                  {deliveryQuoteError}
                </div>
              ) : null}
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
          </CheckoutOrderFormBoundary>
        </div>

        {renderNavigation(true)}

        <OrderSummary
          deliveryQuote={deliveryQuote}
          deliveryQuoteStatus={deliveryQuoteDisplayStatus}
          paymentMethods={checkoutConfig.paymentMethods}
          shippingMethod={shippingMethod}
          paymentMethod={paymentMethod}
          perItemAssembly={perItemAssembly}
          firstPurchaseEligible={firstPurchaseEligible}
          className="hidden lg:block"
          beforeCta={
            step === "review" ? (
              <div data-testid="desktop-checkout-consent" className="hidden lg:block">
                <CheckoutConsent id="consent-desktop" mirror />
              </div>
            ) : null
          }
          cta={renderNavigation(false)}
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

function CheckoutOrderFormBoundary({
  active,
  onSubmit,
  children,
}: {
  active: boolean;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  children: React.ReactNode;
}) {
  if (!active) return <div className="contents">{children}</div>;

  return (
    <form
      id="checkout-order-form"
      onSubmit={onSubmit}
      noValidate
      className="contents"
    >
      {children}
    </form>
  );
}

function ReviewStep({
  deliveryQuote,
  deliveryQuoteStatus,
  paymentMethods,
  firstPurchaseEligible,
}: {
  deliveryQuote: CheckoutDeliveryQuote;
  deliveryQuoteStatus: DeliveryQuoteDisplayStatus;
  paymentMethods: CheckoutPaymentMethodConfig[];
  firstPurchaseEligible: boolean;
}) {
  const data = useFormContext<CheckoutFormData>().getValues();
  const reviewShippingPrice = deliveryQuote.prices[data.shippingMethod];

  return (
    <div className="flex flex-col gap-3 sm:gap-5 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] lg:items-start lg:gap-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <ReviewBlock title="Isporuka">
          <p className="break-words text-sm text-ink-700">
            {data.shipping.firstName} {data.shipping.lastName}
            <br />
            {data.shipping.street}, {data.shipping.postalCode}{" "}
            {data.shipping.city}
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
            · {reviewShippingPrice == null
              ? "Nije moguće obračunati"
              : formatRsd(reviewShippingPrice)}
          </p>
          {data.shippingMethod === "kurir" && data.glsDeliveryPoint ? (
            <p className="mt-1 text-xs text-ink-500">
              MyGLS paket tačka:{" "}
              {data.glsDeliveryPoint.label ?? data.glsDeliveryPoint.name}
            </p>
          ) : null}
        </ReviewBlock>
        <ReviewBlock title="Plaćanje" className="col-span-2">
          <p className="text-sm text-ink-700">
            {getPaymentLabel(data.paymentMethod, paymentMethods)}
          </p>
        </ReviewBlock>
      </div>

      <div className="border-border/60 flex flex-col gap-3 border-t pt-3 sm:gap-4 sm:pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
        <div data-testid="mobile-checkout-consent" className="lg:hidden">
          <CheckoutConsent id="consent-mobile" />
        </div>
        <VoucherSection />
        <OrderSummary
          deliveryQuote={deliveryQuote}
          deliveryQuoteStatus={deliveryQuoteStatus}
          shippingMethod={data.shippingMethod}
          paymentMethod={data.paymentMethod}
          perItemAssembly={data.perItemAssembly}
          firstPurchaseEligible={firstPurchaseEligible}
          className="lg:hidden"
          compact
          readOnlyLines
        />
        <NotesConsent />
      </div>
    </div>
  );
}

function ReviewBlock({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-review-block={title}
      className={cn(
        "bg-canvas ring-border/60 min-w-0 rounded-xl p-2.5 ring-1 sm:p-4 lg:p-3",
        className,
      )}
    >
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
      <h2 className="font-display text-lg text-ink-900">Korpa je prazna</h2>
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
  xExpressAddressEnabled: boolean,
): Promise<boolean> {
  switch (step) {
    case "identity":
      return identity !== null;
    case "shipping":
      return trigger(
        [
          ...addressFieldNames(
            "shipping",
            getValues("shipping.liceType"),
            xExpressAddressEnabled,
          ),
          ...(getValues("shipToDifferent")
            ? addressFieldNames("billing", getValues("billing.liceType"), false)
            : []),
          "shippingMethod",
          "paymentMethod",
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

function readRememberedCheckout(): {
  shipping?: Partial<CheckoutAddress>;
} | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(
      window.localStorage.getItem(REMEMBERED_CHECKOUT_KEY) ?? "null",
    );
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
    xExpressTownId:
      positiveIntOrUndefined(data.shipping.xExpressTownId) ?? null,
    xExpressStreetId:
      positiveIntOrUndefined(data.shipping.xExpressStreetId) ?? null,
    country: data.shipping.country || "RS",
    companyName:
      data.shipping.liceType === "pravno"
        ? data.shipping.companyName
        : undefined,
    pib: data.shipping.liceType === "pravno" ? data.shipping.pib : undefined,
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
  requireXExpressTown = false,
) {
  const fields: Array<
    `shipping.${keyof CheckoutAddress}` | `billing.${keyof CheckoutAddress}`
  > = [
    `${prefix}.firstName`,
    `${prefix}.lastName`,
    `${prefix}.email`,
    `${prefix}.phone`,
    `${prefix}.street`,
    `${prefix}.city`,
    `${prefix}.postalCode`,
  ];
  if (requireXExpressTown) fields.push(`${prefix}.xExpressTownId`);
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
  checkoutSessionId?: string | null,
  analytics?: ReturnType<typeof getConsentedAnalyticsContext>,
) {
  const shipping = addressForApi(data.shipping);
  const billing =
    data.shipToDifferent && data.billing
      ? addressForApi(data.billing)
      : undefined;

  return {
    guestEmail: data.identity === "guest" ? data.shipping.email : undefined,
    lines: lines.map((line) => ({
      sku: line.sku,
      qty: line.qty,
      withAssembly: Boolean(data.perItemAssembly?.[line.sku]),
    })),
    shipping,
    glsDeliveryPoint:
      data.shippingMethod === "kurir"
        ? (data.glsDeliveryPoint ?? undefined)
        : undefined,
    billingSameAsShipping: !data.shipToDifferent,
    billing,
    shippingMethod: SHIPPING_METHOD_UPPER[data.shippingMethod],
    paymentMethod: PAYMENT_METHOD_UPPER[data.paymentMethod],
    checkoutSessionId: checkoutSessionId ?? undefined,
    voucherCode: data.voucherCode || undefined,
    notes: data.notes || undefined,
    consent: data.consent,
    analytics,
  };
}

const CHECKOUT_SESSION_KEY = "spc.checkoutSessionId";

function getCheckoutSessionId() {
  if (typeof window === "undefined") return null;
  const existing = window.localStorage.getItem(CHECKOUT_SESSION_KEY);
  if (existing) return existing;
  const id =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID().replace(/-/g, "")
      : `${Date.now()}${Math.random().toString(36).slice(2, 14)}`;
  window.localStorage.setItem(CHECKOUT_SESSION_KEY, id);
  return id;
}

function clearCheckoutSessionId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CHECKOUT_SESSION_KEY);
}

async function trackCheckoutSession({
  sessionId,
  step,
  identity,
  guestEmail,
  recoveryConsent,
  shippingCity,
  shippingMethod,
  paymentMethod,
  lines,
}: {
  sessionId: string;
  step: CheckoutStep;
  identity: IdentityChoice | null;
  guestEmail: string | null;
  recoveryConsent: boolean;
  shippingCity: string;
  shippingMethod: ShippingMethod;
  paymentMethod: PaymentMethod;
  lines: ReturnType<typeof useCart.getState>["lines"];
}) {
  const cartTotal = lines.reduce(
    (n, line) => n + line.unitPriceSale * line.qty,
    0,
  );
  await fetch("/api/checkout/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      step,
      identity,
      guestEmail: guestEmail || null,
      recoveryConsent,
      shippingCity: shippingCity || null,
      shippingMethod,
      paymentMethod,
      lineCount: lines.length,
      itemQty: lines.reduce((n, line) => n + line.qty, 0),
      cartTotal,
      lines,
    }),
  }).catch(() => undefined);
}

function isCompleteEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function addressForApi(address: CheckoutAddress) {
  const isBusiness = address.liceType === "pravno";
  return {
    liceType: address.liceType,
    firstName: address.firstName,
    lastName: address.lastName,
    phone: address.phone,
    street: address.street,
    city: address.city,
    postalCode: address.postalCode,
    xExpressTownId: positiveIntOrUndefined(address.xExpressTownId),
    xExpressStreetId: positiveIntOrUndefined(address.xExpressStreetId),
    country: address.country || "RS",
    companyName: isBusiness ? address.companyName || undefined : undefined,
    pib: isBusiness ? address.pib || undefined : undefined,
  };
}

function positiveIntOrUndefined(value: number | null | undefined) {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

function readCreateOrderError(
  result: CreateOrderApiResponse | null,
  status?: number,
  retryAfter?: string | null,
): string {
  if (status === 429) {
    const seconds = Number.parseInt(retryAfter ?? "", 10);
    const wait = Number.isFinite(seconds)
      ? ` Pokušajte ponovo za oko ${Math.max(1, Math.ceil(seconds / 60))} min.`
      : " Pokušajte ponovo malo kasnije.";
    const message = result && !result.ok ? result.message : null;
    return `${message ?? "Previše pokušaja."}${wait}`;
  }
  const error =
    result && !result.ok && typeof result.error !== "string"
      ? result.error
      : null;
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
    case "DELIVERY_ADDRESS_INVALID":
      return "Izaberite važeće X Express mesto za kurirsku isporuku.";
    case "PAYMENT_UNAVAILABLE":
      return "Izabrani način plaćanja trenutno nije dostupan. Izaberite drugi način plaćanja.";
    case "CHECKOUT_SESSION_MISMATCH":
      return "Podaci su promenjeni nakon što je porudžbina već evidentirana. Osvežite stranicu i proverite postojeću porudžbinu pre novog pokušaja.";
    case "DELIVERY_UNAVAILABLE":
      return "Dostava za ovu korpu trenutno ne može tačno da se obračuna. Proverite korpu ili kontaktirajte podršku.";
    case "EMPTY_CART":
      return "Korpa je prazna.";
    case "INTERNAL":
      return "Porudžbinu trenutno nije moguće kreirati zbog tehničke greške. Pokušajte ponovo kasnije.";
    default:
      return "Porudžbinu trenutno nije moguće kreirati. Proverite podatke i pokušajte ponovo.";
  }
}

function deliveryPricingMessage(
  issue: CheckoutDeliveryQuote["pricingIssue"],
) {
  switch (issue) {
    case "WEIGHT_OUTSIDE_TARIFF":
      return "Ukupna težina jedne kategorije nije pokrivena cenovnikom dostave. Kontaktirajte podršku pre poručivanja.";
    case "MISSING_PACKAGE_DIMENSIONS":
    case "MISSING_WEIGHT":
      return "Za jedan ili više artikala nedostaju podaci potrebni za tačan obračun dostave. Kontaktirajte podršku pre poručivanja.";
    case "NO_CONFIGURED_PRICE":
    default:
      return "Dostava za ovu korpu trenutno ne može tačno da se obračuna. Kontaktirajte podršku pre poručivanja.";
  }
}

function lineAssemblyPrice(deliveryQuote: CheckoutDeliveryQuote, sku: SKU) {
  return deliveryQuote.assemblyPricesBySku[sku] ?? deliveryQuote.assemblyPrice;
}

function buildOrder({
  data,
  lines,
  deliveryQuote,
  voucherCode,
  orderNumber,
  serverPricing,
}: {
  data: CheckoutFormData;
  lines: ReturnType<typeof useCart.getState>["lines"];
  deliveryQuote: CheckoutDeliveryQuote;
  voucherCode?: string;
  orderNumber: string;
  serverPricing: {
    total: number;
    subtotal: number;
    savings: number;
    shipping: number;
    assemblyTotal: number;
    voucherDiscount: number;
    firstPurchaseDiscount: number;
    savedCardDiscount: number;
  };
}): Order {
  const shippingAddress: Address = {
    id: "shipping",
    firstName: data.shipping.firstName,
    lastName: data.shipping.lastName,
    phone: data.shipping.phone,
    street: data.shipping.street,
    city: data.shipping.city,
    postalCode: data.shipping.postalCode,
    xExpressTownId:
      positiveIntOrUndefined(data.shipping.xExpressTownId) ?? null,
    xExpressStreetId:
      positiveIntOrUndefined(data.shipping.xExpressStreetId) ?? null,
    country: data.shipping.country || "RS",
    companyName:
      data.shipping.liceType === "pravno"
        ? data.shipping.companyName
        : undefined,
    pib: data.shipping.liceType === "pravno" ? data.shipping.pib : undefined,
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
          xExpressTownId:
            positiveIntOrUndefined(data.billing.xExpressTownId) ?? null,
          xExpressStreetId:
            positiveIntOrUndefined(data.billing.xExpressStreetId) ?? null,
          country: data.billing.country || "RS",
          companyName:
            data.billing.liceType === "pravno"
              ? data.billing.companyName
              : undefined,
          pib:
            data.billing.liceType === "pravno" ? data.billing.pib : undefined,
        }
      : undefined;

  const now = new Date().toISOString();
  return {
    id: orderNumber,
    guestEmail: data.identity === "guest" ? data.shipping.email : undefined,
    customerEmail: data.shipping.email,
    status: "kreirano",
    items: lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      qty: l.qty,
      unitPriceFull: l.unitPriceFull,
      unitPriceSale: l.unitPriceSale,
      withAssembly: Boolean(data.perItemAssembly?.[l.sku]),
      assemblyPrice: data.perItemAssembly?.[l.sku]
        ? lineAssemblyPrice(deliveryQuote, l.sku)
        : undefined,
      thumbnailUrl: l.thumbnailUrl,
    })),
    subtotal: serverPricing.subtotal,
    savings: serverPricing.savings,
    shipping: serverPricing.shipping,
    assemblyTotal: serverPricing.assemblyTotal,
    voucherCode,
    voucherDiscount: serverPricing.voucherDiscount || undefined,
    firstPurchaseDiscount: serverPricing.firstPurchaseDiscount || undefined,
    savedCardDiscount: serverPricing.savedCardDiscount || undefined,
    total: serverPricing.total,
    shippingMethod: data.shippingMethod,
    paymentMethod: data.paymentMethod,
    shippingAddress,
    billingAddress,
    notes: data.notes,
    createdAt: now,
    updatedAt: now,
  };
}
