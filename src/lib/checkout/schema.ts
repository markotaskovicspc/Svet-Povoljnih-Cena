/**
 * Zod schemas for the checkout flow.
 * Used by react-hook-form on both `/checkout/podaci` and individual step forms.
 * Will be reused server-side in Phase 3 when the create-order route handler lands.
 */
import { z } from "zod";

/** Strict-ish RS phone in international format `+381 6X XXX XXXX` (mask-friendly). */
const phoneRegex = /^\+381\s?6\d(\s?\d{2,3}){2,3}$/;

const baseAddress = z.object({
  firstName: z
    .string({ message: "Obavezno polje" })
    .trim()
    .min(2, "Ime je prekratko"),
  lastName: z
    .string({ message: "Obavezno polje" })
    .trim()
    .min(2, "Prezime je prekratko"),
  email: z
    .string({ message: "Obavezno polje" })
    .trim()
    .email("Unesite ispravnu e-poštu"),
  phone: z
    .string({ message: "Obavezno polje" })
    .trim()
    .regex(phoneRegex, "Format: +381 6X XXX XXXX"),
  street: z
    .string({ message: "Obavezno polje" })
    .trim()
    .min(3, "Adresa je prekratka"),
  city: z
    .string({ message: "Obavezno polje" })
    .trim()
    .min(2, "Unesite grad"),
  postalCode: z
    .string({ message: "Obavezno polje" })
    .trim()
    .regex(/^\d{5}$/, "Poštanski broj ima 5 cifara"),
  country: z.string().default("RS"),
});

export const personalAddressSchema = baseAddress.extend({
  liceType: z.literal("fizicko"),
  companyName: z.string().optional(),
  pib: z.string().optional(),
});

export const businessAddressSchema = baseAddress.extend({
  liceType: z.literal("pravno"),
  companyName: z
    .string({ message: "Obavezno polje" })
    .trim()
    .min(2, "Naziv kompanije je obavezan"),
  pib: z
    .string({ message: "Obavezno polje" })
    .trim()
    .regex(/^\d{9}$/, "PIB ima 9 cifara"),
});

export const addressSchema = z.discriminatedUnion("liceType", [
  personalAddressSchema,
  businessAddressSchema,
]);

export type AddressInput = z.infer<typeof addressSchema>;

export const checkoutFormSchema = z
  .object({
    identity: z.enum(["login", "register", "guest"]),
    shipping: addressSchema,
    shipToDifferent: z.boolean().default(false),
    billing: addressSchema.optional(),
    shippingMethod: z.enum(["kurir", "kamion"]),
    paymentMethod: z.enum([
      "ips",
      "kartica",
      "google_pay",
      "apple_pay",
      "uplata_na_racun",
      "pouzece_gotovina",
      "pouzece_kartica",
    ]),
    voucherCode: z.string().trim().optional(),
    notes: z.string().max(500, "Najviše 500 karaktera").optional(),
    consent: z
      .boolean()
      .refine((v) => v === true, "Saglasnost je obavezna pre porudžbine"),
  })
  .refine(
    (v) =>
      !v.shipToDifferent || (v.shipToDifferent && v.billing !== undefined),
    {
      path: ["billing"],
      message: "Unesite drugu adresu za isporuku",
    },
  );

export type CheckoutFormInput = z.infer<typeof checkoutFormSchema>;
