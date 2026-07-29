import "server-only";

import { OrderStatus, Prisma, type MarketingContact } from "@generated/prisma-client";
import { z } from "zod";
import { db } from "@/lib/db";

export const audienceFieldSchema = z.enum([
  "source",
  "subscribedAt",
  "registered",
  "city",
  "language",
  "orderCount",
  "totalSpend",
  "lastPurchaseAt",
  "purchasedSku",
  "purchasedCategory",
  "voucher",
  "openedCampaign",
  "clickedCampaign",
]);

export const audienceOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "gte",
  "lte",
  "before",
  "after",
  "is_true",
  "is_false",
]);

export const audienceRuleSchema = z.object({
  id: z.string().min(1).max(80),
  field: audienceFieldSchema,
  operator: audienceOperatorSchema,
  value: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
});

export const audienceGroupSchema = z.object({
  id: z.string().min(1).max(80),
  logic: z.enum(["AND", "OR"]).default("AND"),
  rules: z.array(audienceRuleSchema).max(20).default([]),
});

export const newsletterAudienceFilterSchema = z.object({
  logic: z.enum(["AND", "OR"]).default("AND"),
  groups: z.array(audienceGroupSchema).max(10).default([]),
  manualContactIds: z.array(z.string().min(1)).max(10_000).default([]),
  excludeCampaignIds: z.array(z.string().min(1)).max(100).default([]),
});

export type NewsletterAudienceFilter = z.infer<typeof newsletterAudienceFilterSchema>;
export type AudienceRule = z.infer<typeof audienceRuleSchema>;

export type AudienceProfile = {
  contactId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  language: string;
  source: string | null;
  subscribedAt: Date | null;
  registered: boolean;
  cities: string[];
  orderCount: number;
  totalSpend: number;
  lastPurchaseAt: Date | null;
  purchasedSkus: string[];
  purchasedCategories: string[];
  vouchers: string[];
  openedCampaignIds: string[];
  clickedCampaignIds: string[];
  receivedCampaignIds: string[];
};

export type AudienceRecipient = Pick<
  MarketingContact,
  "id" | "email" | "firstName" | "lastName" | "language"
>;

export function matchesAudienceFilter(profile: AudienceProfile, rawFilter: unknown) {
  const filter = newsletterAudienceFilterSchema.parse(rawFilter ?? {});
  if (filter.manualContactIds.length && !filter.manualContactIds.includes(profile.contactId)) {
    return false;
  }
  if (
    filter.excludeCampaignIds.length &&
    filter.excludeCampaignIds.some((id) => profile.receivedCampaignIds.includes(id))
  ) {
    return false;
  }
  if (!filter.groups.length) return true;
  const groupResults = filter.groups.map((group) => {
    if (!group.rules.length) return true;
    const results = group.rules.map((rule) => matchRule(profile, rule));
    return group.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
  });
  return filter.logic === "AND" ? groupResults.every(Boolean) : groupResults.some(Boolean);
}

export async function resolveNewsletterAudience(rawFilter: unknown, limit = 50_000) {
  const filter = newsletterAudienceFilterSchema.parse(rawFilter ?? {});
  const fields = new Set(filter.groups.flatMap((group) => group.rules.map((rule) => rule.field)));
  const contacts = await db.marketingContact.findMany({
    where: {
      status: "ACTIVE",
      subscribedAt: { not: null },
      ...(filter.manualContactIds.length ? { id: { in: filter.manualContactIds } } : {}),
    },
    take: Math.min(Math.max(limit, 1), 50_000),
    orderBy: { subscribedAt: "asc" },
  });
  const userIds = unique(contacts.map((contact) => contact.userId).filter(isString));
  const needsOrderStats = (["orderCount", "totalSpend", "lastPurchaseAt"] as const).some((field) => fields.has(field));
  const needsCity = fields.has("city");
  const needsVoucher = fields.has("voucher");
  const needsProducts = fields.has("purchasedSku") || fields.has("purchasedCategory");
  const engagementCampaignIds = unique([
    ...filter.excludeCampaignIds,
    ...filter.groups.flatMap((group) => group.rules
      .filter((rule) => rule.field === "openedCampaign" || rule.field === "clickedCampaign")
      .map((rule) => String(rule.value ?? "").trim())
      .filter(Boolean)),
  ]);
  const validOrderWhere: Prisma.OrderWhereInput = {
    userId: { in: userIds },
    status: { notIn: [OrderStatus.KREIRANO, OrderStatus.OTKAZANO, OrderStatus.VRACENO] },
  };
  const [orderStatsRows, cityRows, voucherRows, productRows, engagementRows] = await Promise.all([
    userIds.length && needsOrderStats
      ? db.order.groupBy({
          by: ["userId"],
          where: validOrderWhere,
          _count: { _all: true },
          _sum: { total: true },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
    userIds.length && needsCity
      ? db.order.groupBy({
          by: ["userId", "shipCity"],
          where: validOrderWhere,
        })
      : Promise.resolve([]),
    userIds.length && needsVoucher
      ? db.order.groupBy({
          by: ["userId", "voucherCode"],
          where: { ...validOrderWhere, voucherCode: { not: null } },
        })
      : Promise.resolve([]),
    userIds.length && needsProducts
      ? db.$queryRaw<Array<{ userId: string; sku: string; categoryPath: string | null }>>(Prisma.sql`
          SELECT DISTINCT o."userId" AS "userId", oi."sku", oi."categoryPath"
          FROM "OrderItem" oi
          JOIN "Order" o ON o."id" = oi."orderId"
          WHERE o."userId" IN (${Prisma.join(userIds)})
            AND o."status" NOT IN ('KREIRANO', 'OTKAZANO', 'VRACENO')
        `)
      : Promise.resolve([]),
    contacts.length && engagementCampaignIds.length
      ? db.newsletterCampaignRecipient.findMany({
          where: {
            contactId: { in: contacts.map((contact) => contact.id) },
            campaignId: { in: engagementCampaignIds },
          },
          select: { contactId: true, campaignId: true, status: true },
        })
      : Promise.resolve([]),
  ]);
  const orderStats = new Map(orderStatsRows.map((row) => [row.userId, row]));
  const cities = groupValues(cityRows, (row) => row.userId, (row) => row.shipCity);
  const vouchers = groupValues(voucherRows, (row) => row.userId, (row) => row.voucherCode);
  const purchasedSkus = groupValues(productRows, (row) => row.userId, (row) => row.sku);
  const purchasedCategories = groupValues(productRows, (row) => row.userId, (row) => row.categoryPath);
  const engagement = groupRows(engagementRows, (row) => row.contactId);
  const suppressed = new Set(
    (await db.emailSuppression.findMany({
      where: { email: { in: contacts.map((contact) => contact.email) } },
      select: { email: true },
    })).map((row) => row.email.toLowerCase()),
  );
  const recipients: AudienceRecipient[] = [];
  let excludedSuppressed = 0;
  let excludedRules = 0;

  for (const contact of contacts) {
    if (suppressed.has(contact.email.toLowerCase())) {
      excludedSuppressed += 1;
      continue;
    }
    const stats = contact.userId ? orderStats.get(contact.userId) as {
      _count: { _all: number };
      _sum: { total: Prisma.Decimal | null };
      _max: { createdAt: Date | null };
    } | undefined : undefined;
    const recipientEvents = engagement.get(contact.id) ?? [];
    const profile: AudienceProfile = {
      contactId: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      language: contact.language,
      source: contact.source,
      subscribedAt: contact.subscribedAt,
      registered: Boolean(contact.userId),
      cities: contact.userId ? cities.get(contact.userId) ?? [] : [],
      orderCount: stats?._count._all ?? 0,
      totalSpend: Number(stats?._sum.total ?? 0),
      lastPurchaseAt: stats?._max.createdAt ?? null,
      purchasedSkus: contact.userId ? purchasedSkus.get(contact.userId) ?? [] : [],
      purchasedCategories: contact.userId ? purchasedCategories.get(contact.userId) ?? [] : [],
      vouchers: contact.userId ? vouchers.get(contact.userId) ?? [] : [],
      openedCampaignIds: unique(recipientEvents.filter((row) => row.status === "OPENED" || row.status === "CLICKED").map((row) => row.campaignId)),
      clickedCampaignIds: unique(recipientEvents.filter((row) => row.status === "CLICKED").map((row) => row.campaignId)),
      receivedCampaignIds: unique(recipientEvents.map((row) => row.campaignId)),
    };
    if (!matchesAudienceFilter(profile, filter)) {
      excludedRules += 1;
      continue;
    }
    recipients.push({
      id: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      language: contact.language,
    });
  }
  return {
    filter,
    recipients,
    breakdown: {
      activeContacts: contacts.length,
      matched: recipients.length,
      excludedSuppressed,
      excludedRules,
    },
  };
}

export async function previewNewsletterAudience(rawFilter: unknown) {
  const result = await resolveNewsletterAudience(rawFilter);
  return {
    count: result.recipients.length,
    breakdown: result.breakdown,
    sample: result.recipients.slice(0, 25),
  };
}

export function emptyAudienceFilter(): NewsletterAudienceFilter {
  return { logic: "AND", groups: [], manualContactIds: [], excludeCampaignIds: [] };
}

function matchRule(profile: AudienceProfile, rule: AudienceRule) {
  const value = ruleValue(profile, rule.field);
  const expected = rule.value;
  if (rule.operator === "is_true") return Boolean(value);
  if (rule.operator === "is_false") return !Boolean(value);
  if (Array.isArray(value)) {
    const needle = normalize(expected);
    const contains = value.some((item) => normalize(item).includes(needle));
    if (rule.operator === "contains" || rule.operator === "equals") return contains;
    if (rule.operator === "not_contains" || rule.operator === "not_equals") return !contains;
    return false;
  }
  if (value instanceof Date || rule.field === "subscribedAt" || rule.field === "lastPurchaseAt") {
    const left = value instanceof Date ? value.getTime() : Number.NaN;
    const right = typeof expected === "string" ? new Date(expected).getTime() : Number.NaN;
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (rule.operator === "before" || rule.operator === "lte") return left <= right;
    if (rule.operator === "after" || rule.operator === "gte") return left >= right;
    return left === right;
  }
  if (typeof value === "number") {
    const right = Number(expected);
    if (!Number.isFinite(right)) return false;
    if (rule.operator === "gte") return value >= right;
    if (rule.operator === "lte") return value <= right;
    if (rule.operator === "not_equals") return value !== right;
    return value === right;
  }
  if (typeof value === "boolean") {
    const right = expected === true || expected === "true";
    return rule.operator === "not_equals" ? value !== right : value === right;
  }
  const left = normalize(value);
  const right = normalize(expected);
  if (rule.operator === "contains") return left.includes(right);
  if (rule.operator === "not_contains") return !left.includes(right);
  if (rule.operator === "not_equals") return left !== right;
  return left === right;
}

function ruleValue(profile: AudienceProfile, field: z.infer<typeof audienceFieldSchema>) {
  switch (field) {
    case "source": return profile.source ?? "";
    case "subscribedAt": return profile.subscribedAt;
    case "registered": return profile.registered;
    case "city": return profile.cities;
    case "language": return profile.language;
    case "orderCount": return profile.orderCount;
    case "totalSpend": return profile.totalSpend;
    case "lastPurchaseAt": return profile.lastPurchaseAt;
    case "purchasedSku": return profile.purchasedSkus;
    case "purchasedCategory": return profile.purchasedCategories;
    case "voucher": return profile.vouchers;
    case "openedCampaign": return profile.openedCampaignIds;
    case "clickedCampaign": return profile.clickedCampaignIds;
  }
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("sr-Latn");
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function groupValues<T>(
  rows: T[],
  key: (row: T) => string | null,
  value: (row: T) => string | null,
) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const item = value(row);
    if (!groupKey || !item) continue;
    const values = grouped.get(groupKey) ?? [];
    if (!values.includes(item)) values.push(item);
    grouped.set(groupKey, values);
  }
  return grouped;
}

function groupRows<T>(rows: T[], key: (row: T) => string | null) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    if (!groupKey) continue;
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), row]);
  }
  return grouped;
}

export function audienceFilterJson(filter: NewsletterAudienceFilter): Prisma.InputJsonValue {
  return filter as Prisma.InputJsonValue;
}
