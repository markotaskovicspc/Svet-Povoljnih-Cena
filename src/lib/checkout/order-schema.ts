import { z } from "zod";
import { missingBusinessAddressFields } from "./business-policy";

const lineSchema = z.object({
  sku: z.string().min(1),
  qty: z.int().min(1).max(99),
  withAssembly: z.boolean().optional(),
});

const addressSchema = z
  .object({
    liceType: z.enum(["fizicko", "pravno"]).optional(),
    firstName: z.string().min(2),
    lastName: z.string().min(2),
    phone: z.string().min(8).max(32),
    street: z.string().min(3),
    city: z.string().min(2),
    postalCode: z.string().regex(/^\d{5}$/),
    xExpressTownId: z.coerce.number().int().positive().optional().nullable(),
    xExpressStreetId: z.coerce.number().int().positive().optional().nullable(),
    country: z.string().default("RS"),
    companyName: z.string().optional(),
    pib: z.string().regex(/^\d{9}$/).optional(),
  })
  .superRefine((address, context) => {
    const missing = missingBusinessAddressFields(address);
    if (missing.includes("companyName")) {
      context.addIssue({
        code: "custom",
        path: ["companyName"],
        message: "Naziv firme je obavezan za pravno lice.",
      });
    }
    if (missing.includes("pib")) {
      context.addIssue({
        code: "custom",
        path: ["pib"],
        message: "PIB je obavezan za pravno lice.",
      });
    }
  });

export const createOrderSchema = z
  .object({
    checkoutSessionId: z
      .string()
      .min(12)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    guestEmail: z.email().optional(),
    lines: z.array(lineSchema).min(1).max(50),
    shipping: addressSchema,
    billingSameAsShipping: z.boolean().default(true),
    billing: addressSchema.optional(),
    shippingMethod: z.enum(["KURIR", "KAMION"]),
    glsDeliveryPoint: z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        street: z.string().optional().nullable(),
        city: z.string().optional().nullable(),
        postalCode: z.string().optional().nullable(),
        label: z.string().optional().nullable(),
      })
      .optional()
      .nullable(),
    paymentMethod: z.enum([
      "IPS",
      "KARTICA",
      "GOOGLE_PAY",
      "APPLE_PAY",
      "UPLATA_NA_RACUN",
      "POUZECE_GOTOVINA",
      "POUZECE_KARTICA",
    ]),
    voucherCode: z.string().trim().optional(),
    /** Pay with a tokenized saved card (eligible only for logged-in users). */
    useSavedCard: z.boolean().optional(),
    notes: z.string().max(500).optional(),
    consent: z.literal(true),
    analytics: z
      .object({
        anonymousId: z.string().min(3).max(96),
        sessionId: z.string().min(3).max(96),
        consentVersion: z.string().min(1).max(40),
        path: z.string().max(500),
      })
      .optional(),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.lines.forEach((line, index) => {
      if (seen.has(line.sku)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "sku"],
          message: "Artikal je dupliran u korpi.",
        });
      }
      seen.add(line.sku);
    });
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
