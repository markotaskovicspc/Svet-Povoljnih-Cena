"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { runAnanasInventoryHistory } from "@/app/admin/erp/ananas/actions";

export function AnanasInventoryRunner({ enabled }: { enabled: boolean }) {
  const [running, setRunning] = useState(false), [message, setMessage] = useState("");
  const stop = useRef(false), router = useRouter();
  async function run() {
    stop.current = false; setRunning(true);
    try {
      while (!stop.current) {
        setMessage("Preuzimanje istorije i knjiženje na Ananas lager…");
        const state = await runAnanasInventoryHistory();
        setMessage(state.message); router.refresh();
        if (!state.ok || state.result?.complete || state.result?.needsReview) break;
      }
    } catch { setMessage("Obrada je prekinuta. Nastavite od poslednjeg sačuvanog perioda; već knjižene stavke neće se ponoviti."); }
    finally { setRunning(false); }
  }
  return <div className="mt-4 space-y-3">
    <button className="rounded-lg border px-4 py-2 text-sm" disabled={!enabled || running} onClick={run}>Preuzmi i proknjiži istoriju</button>
    {running && <button className="ml-3 rounded-lg border px-4 py-2 text-sm" onClick={() => { stop.current = true; setMessage("Obrada će stati po završetku tekućeg perioda."); }}>Zaustavi posle ovog perioda</button>}
    <p aria-live="polite" className="text-sm">{message}</p>
  </div>;
}
