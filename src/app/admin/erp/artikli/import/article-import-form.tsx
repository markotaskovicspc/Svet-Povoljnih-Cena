"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type RowError = { row: number; field: string; message: string };

export function ArticleImportForm() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    errors?: RowError[];
    warnings?: string[];
  } | null>(null);

  async function submit(formData: FormData) {
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/erp/articles/import", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            imported?: number;
            error?: string;
            errors?: RowError[];
            warnings?: string[];
          }
        | null;
      if (!response.ok || !payload?.ok) {
        setResult({
          ok: false,
          message: payload?.error ?? "Uvoz nije uspeo.",
          errors: payload?.errors,
          warnings: payload?.warnings,
        });
        return;
      }
      setResult({
        ok: true,
        message: `Uvezeno artikala: ${payload.imported ?? 0}.`,
        warnings: payload.warnings,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <form action={submit} className="rounded-2xl border border-border/60 bg-surface p-5">
        <label className="block text-sm font-medium text-ink-900" htmlFor="article-xlsx">
          XLSX datoteka
        </label>
        <input
          id="article-xlsx"
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="mt-2 block w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm"
        />
        <p className="mt-3 text-sm text-ink-500">
          Obavezna je samo kolona Kratki naziv. Ako SKU/Šifra nije uneta,
          sistem je automatski dodeljuje. Uvoz podržava sva izvorna polja
          matičnog kartona: fotografiju kao URL, status, dobavljača,
          kategoriju/podgrupu, grupu,
          kolekciju, atribute, boje, benefite, formatirani opis, zalihe, COGS,
          dimenzije i pakovanje, materijal, sertifikate, kanale prodaje, MOQ,
          kao i datum „Novo do“.
        </p>
        <p className="mt-1 text-sm text-ink-500">
          Novi red bez kolone „Novo do“ automatski ostaje u sekciji „Novo“ četiri
          kalendarska meseca od prvog objavljivanja. Ako kolona postoji, datum je
          ručni rok, a prazno polje isključuje proizvod iz sekcije. Ponovni uvoz
          bez te kolone ne produžava postojeći rok.
        </p>
        <p className="mt-2 rounded-lg border border-brand-blue/20 bg-brand-blue-50/50 px-3 py-2 text-sm text-ink-700">
          Za artikal „Dok traju zalihe“ unesite <strong>DTZ</strong> u kolonu
          <strong> Status</strong>. DTZ nema datum isteka.
        </p>
        <p className="mt-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
          Stare kolone „T&amp;C od“ i „T&amp;C do“ više se ne koriste. Ako postoje
          u datoteci, biće ignorisane, a uvoz će prikazati upozorenje.
        </p>
        <p className="mt-1 text-sm text-ink-500">
          Kod izmene postojećeg SKU-a menjaju se samo kolone koje postoje u
          datoteci; ostali matični podaci ostaju nepromenjeni.
        </p>
        <p className="mt-1 text-sm font-medium text-warning">
          Uvoz je atomski: ako bilo koji red nije ispravan, nijedan red neće
          biti upisan.
        </p>
        <Button type="submit" className="mt-4" disabled={running}>
          {running ? "Provera i uvoz…" : "Proveri i uvezi"}
        </Button>
      </form>

      {result ? (
        <div
          role={result.ok ? "status" : "alert"}
          className={
            result.ok
              ? "rounded-xl border border-success/20 bg-success/10 p-4 text-sm text-success"
              : "rounded-xl border border-danger/20 bg-danger/10 p-4 text-sm text-danger"
          }
        >
          <p>{result.message}</p>
          {result.warnings?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-warning">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {result.errors?.length ? (
            <div className="mt-3 max-h-96 overflow-auto rounded-lg bg-surface">
              <table className="w-full text-left text-xs text-ink-700">
                <thead className="sticky top-0 bg-muted-bg">
                  <tr>
                    <th className="px-3 py-2">Red</th>
                    <th className="px-3 py-2">Polje</th>
                    <th className="px-3 py-2">Greška</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((error, index) => (
                    <tr key={`${error.row}-${error.field}-${index}`} className="border-t border-border/60">
                      <td className="px-3 py-2">{error.row}</td>
                      <td className="px-3 py-2">{error.field}</td>
                      <td className="px-3 py-2">{error.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
