"use client";
import { useState } from "react";
import { REPORT_PERIOD_PRESETS, resolveReportPeriod } from "@/lib/admin/report-period";
export function PerformanceFilters({preset,fromInput,toInput,q,sort,direction,today}:{preset:string;fromInput:string;toInput:string;q:string;sort:string;direction:string;today:string}) {
  const [range,setRange] = useState(preset), [from,setFrom] = useState(fromInput), [to,setTo] = useState(toInput);
  const field = "mt-1 block h-9 w-full rounded-lg border border-border bg-surface px-2";
  return <form method="get" className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-5">
    <label className="text-xs">Period<select name="range" value={range} onChange={e=>{setRange(e.target.value);if(e.target.value!=='custom'){const p=resolveReportPeriod({range:e.target.value},new Date(today+'T12:00:00Z'));setFrom(p.fromInput);setTo(p.toInput);}}} className={field}>{REPORT_PERIOD_PRESETS.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}<option value="custom">Tačan raspon</option></select></label>
    <label className="text-xs">Od<input name="from" type="date" required value={from} onInput={e=>{setFrom(e.currentTarget.value);setRange('custom');}} className={field}/></label>
    <label className="text-xs">Do<input name="to" type="date" required value={to} onInput={e=>{setTo(e.currentTarget.value);setRange('custom');}} className={field}/></label>
    <label className="text-xs">SKU ili naziv<input name="q" defaultValue={q} maxLength={100} className={field}/></label>
    <input type="hidden" name="sort" value={sort}/><input type="hidden" name="direction" value={direction}/><button className="self-end rounded-lg bg-walnut px-4 py-2 text-sm text-white">Primeni</button>
  </form>;
}
