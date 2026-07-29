"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Logic = "AND" | "OR";
type Rule = { id: string; field: string; operator: string; value?: string | number | boolean };
type Group = { id: string; logic: Logic; rules: Rule[] };
type Filter = {
  logic: Logic;
  groups: Group[];
  manualContactIds: string[];
  excludeCampaignIds: string[];
};

const fields = [
  ["source", "Izvor prijave"],
  ["subscribedAt", "Datum prijave"],
  ["registered", "Ima nalog"],
  ["city", "Grad kupovine"],
  ["language", "Jezik"],
  ["orderCount", "Broj kupovina"],
  ["totalSpend", "Ukupna potrošnja"],
  ["lastPurchaseAt", "Poslednja kupovina"],
  ["purchasedSku", "Kupio SKU"],
  ["purchasedCategory", "Kupio kategoriju"],
  ["voucher", "Koristio vaučer"],
  ["openedCampaign", "Otvorio kampanju"],
  ["clickedCampaign", "Kliknuo kampanju"],
] as const;

const operatorLabels: Record<string, string> = {
  equals: "jednako",
  not_equals: "nije jednako",
  contains: "sadrži",
  not_contains: "ne sadrži",
  gte: "najmanje",
  lte: "najviše",
  before: "pre",
  after: "posle",
  is_true: "da",
  is_false: "ne",
};

const blankFilter: Filter = {
  logic: "AND",
  groups: [],
  manualContactIds: [],
  excludeCampaignIds: [],
};

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function operatorsFor(field: string) {
  if (field === "registered") return ["is_true", "is_false"];
  if (field === "subscribedAt" || field === "lastPurchaseAt") return ["before", "after"];
  if (field === "orderCount" || field === "totalSpend") return ["gte", "lte", "equals"];
  return ["equals", "not_equals", "contains", "not_contains"];
}

function normalizeFilter(input: unknown): Filter {
  if (!input || typeof input !== "object") return blankFilter;
  const raw = input as Partial<Filter>;
  return {
    logic: raw.logic === "OR" ? "OR" : "AND",
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    manualContactIds: Array.isArray(raw.manualContactIds) ? raw.manualContactIds : [],
    excludeCampaignIds: Array.isArray(raw.excludeCampaignIds) ? raw.excludeCampaignIds : [],
  };
}

export function NewsletterAudienceBuilder({
  initialFilter,
  contacts,
  campaigns,
}: {
  initialFilter: unknown;
  contacts: Array<{ id: string; email: string }>;
  campaigns: Array<{ id: string; title: string }>;
}) {
  const [filter, setFilter] = useState<Filter>(() => normalizeFilter(initialFilter));
  const [preview, setPreview] = useState<null | {
    count?: number;
    sample?: Array<{ email: string }>;
    error?: string;
  }>(null);
  const [loading, setLoading] = useState(false);
  const json = useMemo(() => JSON.stringify(filter), [filter]);

  function addGroup() {
    setFilter((current) => ({
      ...current,
      groups: [
        ...current.groups,
        { id: id("group"), logic: "AND", rules: [{ id: id("rule"), field: "source", operator: "equals", value: "" }] },
      ],
    }));
  }

  function changeGroup(groupId: string, mutate: (group: Group) => Group) {
    setFilter((current) => ({
      ...current,
      groups: current.groups.map((group) => group.id === groupId ? mutate(group) : group),
    }));
  }

  async function loadPreview() {
    setLoading(true);
    setPreview(null);
    try {
      const response = await fetch("/api/admin/newsletter/audience-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter }),
      });
      const result = await response.json();
      setPreview(response.ok ? result : { error: result.error ?? "Pregled nije uspeo." });
    } catch {
      setPreview({ error: "Pregled nije uspeo." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="filter" value={json} />
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted-bg/50 p-3 text-sm">
        <span>Grupe poveži sa</span>
        <select
          value={filter.logic}
          onChange={(event) => setFilter((current) => ({ ...current, logic: event.target.value as Logic }))}
          className="h-8 rounded-lg border border-input bg-surface px-2"
        >
          <option value="AND">SVI uslovi (AND)</option>
          <option value="OR">BILO KOJI uslov (OR)</option>
        </select>
        <Button type="button" variant="outline" size="sm" onClick={addGroup}>+ Grupa</Button>
      </div>

      {filter.groups.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-ink-500">
          Bez pravila publika obuhvata sve aktivne kontakte sa potvrđenom saglasnošću. Potiskivanja se uvek automatski isključuju.
        </p>
      ) : null}

      {filter.groups.map((group, groupIndex) => (
        <div key={group.id} className="space-y-3 rounded-xl border border-border/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              Grupa {groupIndex + 1}
              <select
                value={group.logic}
                onChange={(event) => changeGroup(group.id, (current) => ({ ...current, logic: event.target.value as Logic }))}
                className="h-8 rounded-lg border border-input bg-surface px-2 text-xs"
              >
                <option value="AND">sva pravila</option>
                <option value="OR">bilo koje pravilo</option>
              </select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFilter((current) => ({ ...current, groups: current.groups.filter((item) => item.id !== group.id) }))}
            >
              Ukloni grupu
            </Button>
          </div>

          {group.rules.map((rule) => {
            const operators = operatorsFor(rule.field);
            const campaignValue = rule.field === "openedCampaign" || rule.field === "clickedCampaign";
            const noValue = rule.operator === "is_true" || rule.operator === "is_false";
            const dateValue = rule.field === "subscribedAt" || rule.field === "lastPurchaseAt";
            return (
              <div key={rule.id} className="grid gap-2 md:grid-cols-[1.2fr_1fr_1.4fr_auto]">
                <select
                  aria-label="Polje segmenta"
                  value={rule.field}
                  onChange={(event) => changeGroup(group.id, (current) => ({
                    ...current,
                    rules: current.rules.map((item) => item.id === rule.id
                      ? { ...item, field: event.target.value, operator: operatorsFor(event.target.value)[0]!, value: "" }
                      : item),
                  }))}
                  className="h-8 rounded-lg border border-input bg-surface px-2 text-sm"
                >
                  {fields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <select
                  aria-label="Operator segmenta"
                  value={rule.operator}
                  onChange={(event) => changeGroup(group.id, (current) => ({
                    ...current,
                    rules: current.rules.map((item) => item.id === rule.id ? { ...item, operator: event.target.value } : item),
                  }))}
                  className="h-8 rounded-lg border border-input bg-surface px-2 text-sm"
                >
                  {operators.map((operator) => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}
                </select>
                {noValue ? <span className="h-8 rounded-lg bg-muted-bg px-3 py-1.5 text-sm text-ink-500">Vrednost nije potrebna</span> : campaignValue ? (
                  <select
                    aria-label="Kampanja segmenta"
                    value={String(rule.value ?? "")}
                    onChange={(event) => changeGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, value: event.target.value } : item) }))}
                    className="h-8 rounded-lg border border-input bg-surface px-2 text-sm"
                  >
                    <option value="">Izaberi kampanju</option>
                    {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
                  </select>
                ) : (
                  <Input
                    aria-label="Vrednost segmenta"
                    type={dateValue ? "date" : rule.field === "orderCount" || rule.field === "totalSpend" ? "number" : "text"}
                    value={String(rule.value ?? "")}
                    onChange={(event) => changeGroup(group.id, (current) => ({ ...current, rules: current.rules.map((item) => item.id === rule.id ? { ...item, value: event.target.value } : item) }))}
                    placeholder="Vrednost"
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => changeGroup(group.id, (current) => ({ ...current, rules: current.rules.filter((item) => item.id !== rule.id) }))}
                >
                  ×
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => changeGroup(group.id, (current) => ({ ...current, rules: [...current.rules, { id: id("rule"), field: "source", operator: "equals", value: "" }] }))}
          >
            + Pravilo
          </Button>
        </div>
      ))}

      <details className="rounded-xl border border-border/70 p-4">
        <summary className="cursor-pointer text-sm font-medium">Ručni izbor i isključenja</summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="text-xs uppercase tracking-[0.12em] text-ink-500">Samo izabrani kontakti</span>
            <select
              multiple
              size={Math.min(8, Math.max(3, contacts.length))}
              value={filter.manualContactIds}
              onChange={(event) => setFilter((current) => ({ ...current, manualContactIds: Array.from(event.target.selectedOptions, (option) => option.value) }))}
              className="w-full rounded-lg border border-input bg-surface p-2 text-sm"
            >
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.email}</option>)}
            </select>
            <span className="block text-xs text-ink-500">Ako ništa nije izabrano, pravila važe nad svim aktivnim kontaktima.</span>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-xs uppercase tracking-[0.12em] text-ink-500">Isključi primaoce prethodnih kampanja</span>
            <select
              multiple
              size={Math.min(8, Math.max(3, campaigns.length))}
              value={filter.excludeCampaignIds}
              onChange={(event) => setFilter((current) => ({ ...current, excludeCampaignIds: Array.from(event.target.selectedOptions, (option) => option.value) }))}
              className="w-full rounded-lg border border-input bg-surface p-2 text-sm"
            >
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
            </select>
          </label>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={loadPreview} disabled={loading}>
          {loading ? "Računam…" : "Prikaži veličinu publike"}
        </Button>
        {preview?.error ? <span className="text-sm text-destructive">{preview.error}</span> : null}
        {typeof preview?.count === "number" ? (
          <span className="text-sm"><strong>{preview.count.toLocaleString("sr-Latn-RS")}</strong> podobnih kontakata{preview.sample?.length ? ` · uzorak: ${preview.sample.slice(0, 3).map((item) => item.email).join(", ")}` : ""}</span>
        ) : null}
      </div>
    </div>
  );
}
