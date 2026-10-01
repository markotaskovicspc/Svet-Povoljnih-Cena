"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { REPORT_PERIOD_PRESETS, resolveReportPeriod } from "@/lib/admin/report-period";

export function AnalyticsFilters({ preset, fromInput, toInput, granularity, exportHref, today }: {
  preset: string;
  fromInput: string;
  toInput: string;
  granularity: string;
  exportHref: string;
  today: string;
}) {
  const [range, setRange] = useState(preset);
  const [from, setFrom] = useState(fromInput);
  const [to, setTo] = useState(toInput);
  return (
    <form method="get" className="grid gap-3 rounded-xl border border-border/60 bg-surface p-4 md:grid-cols-2 xl:grid-cols-5">
      <label className="text-xs font-medium text-ink-600">
        Period
        <select name="range" value={range} onChange={(event) => {
          const value = event.target.value;
          setRange(value);
          if (value !== "custom") {
            const period = resolveReportPeriod({ range: value }, new Date(`${today}T12:00:00Z`));
            setFrom(period.fromInput);
            setTo(period.toInput);
          }
        }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm">
          {REPORT_PERIOD_PRESETS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          <option value="custom">Tačan raspon</option>
        </select>
      </label>
      <label className="text-xs font-medium text-ink-600">
        Od
        <Input name="from" type="date" required value={from} onChange={(event) => { setFrom(event.target.value); setRange("custom"); }} className="mt-1 h-9" />
      </label>
      <label className="text-xs font-medium text-ink-600">
        Do
        <Input name="to" type="date" required value={to} onChange={(event) => { setTo(event.target.value); setRange("custom"); }} className="mt-1 h-9" />
      </label>
      <label className="text-xs font-medium text-ink-600">
        Grupisanje stranica
        <select name="group" defaultValue={granularity} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm">
          <option value="period">Ceo period</option>
          <option value="day">Dnevno</option>
          <option value="week">Nedeljno</option>
          <option value="month">Mesečno</option>
        </select>
      </label>
      <div className="flex items-end gap-2">
        <button className="h-9 rounded-lg bg-walnut px-4 text-sm font-medium text-white">Primeni</button>
        <a href={exportHref} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-ink-700">Excel</a>
      </div>
      <p className="text-xs text-ink-500 md:col-span-2 xl:col-span-5">
        „Ceo period” sabira sve izabrane dane po stranici. „Mesečno” prikazuje svaki kalendarski mesec posebno. Excel izvozi primenjeni period.
      </p>
    </form>
  );
}
