import type { PaymentMethod, ShippingMethod, SKU } from "@/types";
import type {
  DeliveryCategory,
  DeliveryTariffIssue,
  PublishedDeliveryCategoryBreakdown,
  PublishedDeliveryTariffQuote,
} from "@/lib/delivery-tariff";

export const SHIPPING_PRICES: Record<ShippingMethod, number> = {
  kurir: 990,
  kamion: 4990,
};

export const ASSEMBLY_PRICE_DEFAULT = 2990;
export const ASSEMBLY_ENABLED = false;

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  ips: "Raiffeisen IPS",
  kartica: "Platna kartica",
  google_pay: "Google Pay",
  apple_pay: "Apple Pay",
  uplata_na_racun: "Uplata na račun",
  pouzece_gotovina: "Pouzeće — gotovina",
  pouzece_kartica: "Pouzeće — kartica",
};

export const DEFAULT_TRUCK_CITY_NAMES = [
  "Beograd",
  "Novi Sad",
  "Niš",
  "Kragujevac",
  "Subotica",
  "Pančevo",
] as const;

export type CheckoutPaymentMethodConfig = {
  id: PaymentMethod;
  label: string;
  note: string | null;
  enabled: boolean;
};

export type CheckoutDeliveryQuote = {
  prices: Record<ShippingMethod, number | null>;
  /** Delivery method that matches the resolved cart tariff. */
  recommendedMethod: ShippingMethod | null;
  /** Why an exact courier tariff could not be produced for a non-empty cart. */
  pricingIssue:
    | DeliveryTariffIssue
    | "NO_CONFIGURED_PRICE"
    | "TRUCK_UNAVAILABLE_FOR_CITY"
    | null;
  /** Server-resolved public delivery category for each requested cart line. */
  deliveryCategoriesBySku: Partial<Record<SKU, DeliveryCategory>>;
  /** Present when the published category tariff, rather than an admin fallback, was used. */
  deliveryCategoryBreakdown: PublishedDeliveryCategoryBreakdown | null;
  assemblyPrice: number;
  assemblyPricesBySku: Partial<Record<SKU, number>>;
  truckAvailable: boolean;
  truckCities: string[];
};

export type CheckoutConfig = {
  paymentMethods: CheckoutPaymentMethodConfig[];
  defaultPaymentMethod: PaymentMethod;
  deliveryQuote: CheckoutDeliveryQuote;
};

export const DEFAULT_PAYMENT_METHOD_CONFIG: CheckoutPaymentMethodConfig[] = [
  { id: "ips", label: PAYMENT_LABELS.ips, note: null, enabled: false },
  { id: "kartica", label: PAYMENT_LABELS.kartica, note: null, enabled: false },
  { id: "google_pay", label: PAYMENT_LABELS.google_pay, note: null, enabled: false },
  { id: "apple_pay", label: PAYMENT_LABELS.apple_pay, note: null, enabled: false },
  {
    id: "uplata_na_racun",
    label: PAYMENT_LABELS.uplata_na_racun,
    note: null,
    enabled: true,
  },
  {
    id: "pouzece_gotovina",
    label: PAYMENT_LABELS.pouzece_gotovina,
    note: null,
    enabled: true,
  },
  {
    id: "pouzece_kartica",
    label: PAYMENT_LABELS.pouzece_kartica,
    note: null,
    enabled: true,
  },
];

export const DEFAULT_DELIVERY_QUOTE: CheckoutDeliveryQuote = {
  prices: SHIPPING_PRICES,
  recommendedMethod: "kurir",
  pricingIssue: null,
  deliveryCategoriesBySku: {},
  deliveryCategoryBreakdown: null,
  assemblyPrice: ASSEMBLY_ENABLED ? ASSEMBLY_PRICE_DEFAULT : 0,
  assemblyPricesBySku: {},
  truckAvailable: true,
  truckCities: [...DEFAULT_TRUCK_CITY_NAMES],
};

export function resolveDeliveryMethodQuote({
  publishedTariff,
  configuredCourierPrice,
  configuredTruckPrice,
  truckAvailable,
}: {
  publishedTariff: PublishedDeliveryTariffQuote | null;
  configuredCourierPrice: number | null;
  configuredTruckPrice: number | null;
  truckAvailable: boolean;
}): Pick<
  CheckoutDeliveryQuote,
  | "prices"
  | "recommendedMethod"
  | "pricingIssue"
  | "deliveryCategoryBreakdown"
> {
  const requiresTruck = publishedTariff?.issue === "WEIGHT_ABOVE_50_KG";
  const courierPrice = requiresTruck
    ? null
    : (publishedTariff?.total ??
      configuredCourierPrice ??
      SHIPPING_PRICES.kurir);
  const truckPrice = truckAvailable
    ? (configuredTruckPrice ?? SHIPPING_PRICES.kamion)
    : null;
  const recommendedMethod =
    courierPrice != null ? "kurir" : truckPrice != null ? "kamion" : null;

  return {
    prices: { kurir: courierPrice, kamion: truckPrice },
    recommendedMethod,
    pricingIssue:
      recommendedMethod != null
        ? null
        : requiresTruck && !truckAvailable
          ? "TRUCK_UNAVAILABLE_FOR_CITY"
          : (publishedTariff?.issue ?? "NO_CONFIGURED_PRICE"),
    // A flat truck or courier fallback covers the complete cart. Category
    // prices are meaningful only when the published table itself resolved.
    deliveryCategoryBreakdown:
      publishedTariff?.total != null ? publishedTariff.categories : null,
  };
}

export function getPaymentLabel(
  method: PaymentMethod,
  methods: CheckoutPaymentMethodConfig[] = DEFAULT_PAYMENT_METHOD_CONFIG,
) {
  return methods.find((m) => m.id === method)?.label ?? PAYMENT_LABELS[method];
}
