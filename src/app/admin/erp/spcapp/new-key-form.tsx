'use client';
import { useActionState, useState } from 'react';
import { createSpcappKey, type NewSpcappKey } from './actions';
import type { AdminActionState } from '@/lib/admin/action-state';
const initial: AdminActionState<NewSpcappKey> = { ok: false, message: '' };
export function NewKeyForm() {
  const [state, action, pending] = useActionState(createSpcappKey, initial);
  const [copiedId, setCopiedId] = useState('');
  const [hiddenId, setHiddenId] = useState('');
  const [copyError, setCopyError] = useState(false);
  const result = state.ok ? state.result : undefined;
  return <section className="space-y-4 rounded-xl border bg-surface p-5">
    <h2 className="text-lg font-semibold">Novi serverski ključ</h2>
    <p className="text-sm text-ink-600">Pristup samo za čitanje SPCApp podataka, do 120 zahteva u minutu. Ključ se prikazuje samo nakon kreiranja.</p>
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Naziv<input name="name" required maxLength={100} defaultValue="SPCApp" className="mt-1 block rounded-lg border px-3 py-2" /></label>
      <button disabled={pending} className="rounded-lg bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-50">{pending ? 'Pravljenje…' : 'Napravi ključ'}</button>
    </form>
    {state.message && <p role="status" className={state.ok ? 'text-sm text-ink-700' : 'text-sm text-red-700'}>{state.message}</p>}
    {result && hiddenId !== result.clientId && <div className="space-y-3 rounded-lg border p-4" data-clarity-mask="true">
      <label className="block text-sm">SPCAPP_ERP_API_KEY<input aria-label="SPCApp API ključ" readOnly value={result.token} autoComplete="off" spellCheck={false} className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm" /></label>
      <div className="flex flex-wrap gap-3"><button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={async () => { try { await navigator.clipboard.writeText(result.token); setCopiedId(result.clientId); setCopyError(false); } catch { setCopyError(true); } }}>{copiedId === result.clientId ? 'Kopirano' : 'Kopiraj ključ'}</button>
      <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setHiddenId(result.clientId)}>Sakrij ključ</button></div>
      {copyError && <p role="alert" className="text-sm">Kopiranje nije uspelo; označite i kopirajte ključ iz polja.</p>}
    </div>}
  </section>;
}
