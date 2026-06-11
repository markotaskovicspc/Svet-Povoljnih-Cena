import type { PaymentMethod, ShippingMethod, SKU } from "@/types";

export const SHIPPING_PRICES: Record<ShippingMethod, number> = {
  kurir: 990,
  kamion: 4990,
};

export const ASSEMBLY_PRICE_DEFAULT = 2990;

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  ips: "IPS NBS",
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
  prices: Record<ShippingMethod, number>;
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
  { id: "ips", label: PAYMENT_LABELS.ips, note: null, enabled: true },
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
  assemblyPrice: ASSEMBLY_PRICE_DEFAULT,
  assemblyPricesBySku: {},
  truckAvailable: true,
  truckCities: [...DEFAULT_TRUCK_CITY_NAMES],
};

export function getPaymentLabel(
  method: PaymentMethod,
  methods: CheckoutPaymentMethodConfig[] = DEFAULT_PAYMENT_METHOD_CONFIG,
) {
  return methods.find((m) => m.id === method)?.label ?? PAYMENT_LABELS[method];
}
