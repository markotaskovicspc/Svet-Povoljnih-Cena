"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { runAnanasInventoryHistory } from "@/app/admin/erp/ananas/actions";

type Progress = { postedTotal: number; pendingTotal: number; negatives: number; through: string | null };
export function AnanasInventoryRunner({ enabled, initialStatus }: { enabled: boolean; initialStatus: Progress }) {
  const [running, setRunning] = useState(false), [message, setMessage] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const status = running && progress ? progress : initialStatus;
  const stop = useRef(false), router = useRouter();
  async function run() {
    stop.current = false; setRunning(true); setProgress(null);
    setMessage("Preuzimanje istorije i knjiženje na Ananas lager…");
    try {
      while (!stop.current) {
        const state = await runAnanasInventoryHistory();
        setMessage(state.message);
        if (state.result) setProgress(state.result);
        if (!state.ok || state.result?.complete || state.result?.needsReview) break;
      }
    } catch { setMessage("Obrada je prekinuta. Nastavite od poslednjeg sačuvanog perioda; već knjižene stavke neće se ponoviti."); }
    finally { setRunning(false); router.refresh(); }
  }
  return <div className="mt-4 space-y-3">
    <p className="text-sm">Knjiženo: <strong>{status.postedTotal}</strong> dokumenata. Čeka knjiženje: <strong>{status.pendingTotal}</strong>. Artikli u minusu: <strong>{status.negatives}</strong>. Istorija preuzeta do: {status.through ? new Date(status.through).toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" }) : "nije pokrenuta"}.</p>
    <button className="rounded-lg border px-4 py-2 text-sm" disabled={!enabled || running} onClick={run}>Preuzmi i proknjiži istoriju</button>
    {running && <button className="ml-3 rounded-lg border px-4 py-2 text-sm" onClick={() => { stop.current = true; setMessage("Obrada će stati po završetku tekućeg perioda."); }}>Zaustavi posle ovog perioda</button>}
    <p aria-live="polite" className="text-sm">{message}</p>
  </div>;
}
