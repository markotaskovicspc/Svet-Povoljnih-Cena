"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

type RowError = { row: number; field: string; message: string };
type ImportPreview = {
  rows: number;
  creates: number;
  updates: number;
  families: number;
  newFamilies: number;
  detachments: number;
};
type ImportSource = {
  worksheet: string;
  headerRow: number;
  columns: string[];
};

export function ArticleImportForm() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    errors?: RowError[];
    warnings?: string[];
    preview?: ImportPreview;
    source?: ImportSource;
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
            preview?: ImportPreview;
            source?: ImportSource;
          }
        | null;
      if (!response.ok || !payload?.ok) {
        setResult({
          ok: false,
          message: payload?.error ?? "Uvoz nije uspeo.",
          errors: payload?.errors,
          warnings: payload?.warnings,
          source: payload?.source,
        });
        return;
      }
      setResult({
        ok: true,
        message: payload.preview
          ? "Provera je uspešna. Pregledajte sažetak i potvrdite atomski upis."
          : `Uvezeno artikala: ${payload.imported ?? 0}.`,
        warnings: payload.warnings,
        preview: payload.preview,
        source: payload.source,
      });
    } finally {
      setRunning(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) {
      formData.set(submitter.name, submitter.value);
    }
    void submit(formData);
  }

  return (
    <div className="max-w-4xl space-y-5">
      <form onSubmit={handleSubmit} className="rounded-2xl border border-border/60 bg-surface p-5">
        <label className="block text-sm font-medium text-ink-900" htmlFor="article-xlsx">
          XLSX datoteka
        </label>
        <input
          id="article-xlsx"
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          onChange={() => setResult(null)}
          className="mt-2 block w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm"
        />
        <p className="mt-3 text-sm text-ink-500">
          Za novi artikal obavezni su: Kratki naziv, Opis za sajt, Dobavljač,
          Kategorija, Tarifni broj, dimenzije i bruto težina
          artikla, broj komada, dimenzije i bruto težina transportnog paketa,
          kao i MPC veća od nule. Ako SKU/Šifra nije uneta, sistem je automatski
          dodeljuje. Uvoz podržava sva izvorna polja
          matičnog kartona: fotografiju kao URL, status, dobavljača,
          kategoriju/podgrupu, grupu,
          kolekciju, atribute, boje, benefite, formatirani opis i zalihe.
          Postojeći COGS se pri uvozu ne menja, jer se vodi isključivo iz
          proknjiženih prijemnica. Uvoz dodatno podržava
          dimenzije i pakovanje, materijal, sertifikate, kanale prodaje, MOQ,
          kao i datum „Novo do“.
        </p>
        <p className="mt-1 text-sm text-ink-500">
          Zemlja porekla iz datoteke ima prednost. Ako ta kolona nije prisutna,
          postojeća vrednost artikla ostaje sačuvana, a kada je nema sistem
          automatski koristi zemlju iz kartice dobavljača.
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
        <p className="mt-1 text-sm text-ink-500">
          Sistem automatski pronalazi list sa artiklima i red zaglavlja. Preview
          prikazuje koji list i koje kolone su prepoznati pre upisa.
        </p>
        <p className="mt-1 text-sm text-ink-500">
          Porodice boja koriste kolone: „Šifra porodice“, „Naziv boje“, „HEX boje“,
          „Redosled boje“, „Glavna boja“ i „Boja spremna za web“. Prazna ćelija
          šifre u prisutnoj koloni odvaja SKU; izostavljena kolona čuva postojeću vezu.
        </p>
        <p className="mt-1 text-sm font-medium text-warning">
          Uvoz je atomski: ako bilo koji red nije ispravan, nijedan red neće
          biti upisan.
        </p>
        <Button name="mode" value="preview" type="submit" className="mt-4" disabled={running}>
          {running ? "Provera…" : "Prikaži preview"}
        </Button>
        {result?.preview ? (
          <Button
            name="mode"
            value="apply"
            type="submit"
            variant="secondary"
            className="mt-4 ml-2"
            disabled={running}
          >
            Potvrdi atomski uvoz
          </Button>
        ) : null}
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
          {result.source ? (
            <div className="mt-3 rounded-lg border border-current/15 bg-surface/70 px-3 py-2 text-ink-700">
              <p className="font-medium">
                Prepoznat list „{result.source.worksheet}“, zaglavlje u redu {result.source.headerRow}.
              </p>
              <p className="mt-1 text-xs">
                Prepoznate kolone: {result.source.columns.join(", ") || "nijedna"}.
              </p>
            </div>
          ) : null}
          {result.preview ? (
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div><dt>Redova</dt><dd className="font-bold">{result.preview.rows}</dd></div>
              <div><dt>Novi SKU</dt><dd className="font-bold">{result.preview.creates}</dd></div>
              <div><dt>Izmene</dt><dd className="font-bold">{result.preview.updates}</dd></div>
              <div><dt>Porodice</dt><dd className="font-bold">{result.preview.families}</dd></div>
              <div><dt>Nove porodice</dt><dd className="font-bold">{result.preview.newFamilies}</dd></div>
              <div><dt>Odvajanja</dt><dd className="font-bold">{result.preview.detachments}</dd></div>
            </dl>
          ) : null}
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
