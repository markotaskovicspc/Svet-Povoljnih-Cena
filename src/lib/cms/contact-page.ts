import { z } from "zod";
import { defaultContactPageWidgetData } from "./contact-page-defaults";

export { defaultContactPageWidgetData } from "./contact-page-defaults";

export const CONTACT_CHANNEL_IDS = [
  "email",
  "merchant",
  "warehouse",
  "returns",
] as const;

const contactChannelSchema = z.object({
  id: z.enum(CONTACT_CHANNEL_IDS),
  enabled: z.boolean(),
  label: z.string().trim().max(80),
  value: z.string().trim().max(300),
  note: z.string().trim().max(500),
});

export const contactPageWidgetSchema = z
  .object({
    version: z.literal(1),
    channels: z.array(contactChannelSchema).length(CONTACT_CHANNEL_IDS.length),
  })
  .superRefine((widget, context) => {
    for (const [index, channel] of widget.channels.entries()) {
      if (channel.enabled && !channel.label) {
        context.addIssue({
          code: "custom",
          path: ["channels", index, "label"],
          message: "Unesite naziv aktivne kontakt kartice.",
        });
      }
      if (channel.enabled && !channel.value) {
        context.addIssue({
          code: "custom",
          path: ["channels", index, "value"],
          message: "Unesite glavnu vrednost aktivne kontakt kartice.",
        });
      }
      if (
        channel.enabled &&
        channel.id === "email" &&
        !z.email().safeParse(channel.value).success
      ) {
        context.addIssue({
          code: "custom",
          path: ["channels", index, "value"],
          message: "Unesite ispravnu adresu e-pošte.",
        });
      }
    }

    const ids = widget.channels.map((channel) => channel.id);
    for (const id of CONTACT_CHANNEL_IDS) {
      if (ids.filter((candidate) => candidate === id).length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["channels"],
          message: "Svaka kontakt kartica mora biti zastupljena tačno jednom.",
        });
        break;
      }
    }
  });

export type ContactPageWidgetData = z.infer<typeof contactPageWidgetSchema>;
export type ContactChannel = ContactPageWidgetData["channels"][number];

export function resolveContactPageWidgetData(
  value: unknown,
): ContactPageWidgetData {
  const parsed = contactPageWidgetSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : contactPageWidgetSchema.parse(defaultContactPageWidgetData());
}
