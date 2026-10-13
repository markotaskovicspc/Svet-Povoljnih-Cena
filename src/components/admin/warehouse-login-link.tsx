"use client";
import { useState } from "react";
export function WarehouseLoginLink() {
  const [message, setMessage] = useState("");
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/admin/magacin/prijava`); setMessage("Link je kopiran."); }
    catch { setMessage(`Link za prijavu: ${window.location.origin}/admin/magacin/prijava`); }
  }
  return <div className="mt-3"><button type="button" onClick={copyLink} className="min-h-11 rounded-lg border px-4 py-2 text-sm">Kopiraj link za prijavu</button><p role="status" className="mt-2 break-all text-sm text-ink-500">{message}</p></div>;
}
