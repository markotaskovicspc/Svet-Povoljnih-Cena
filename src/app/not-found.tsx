import Link from "next/link";

export default function NotFound() {
  return <div className="mx-auto max-w-xl px-6 py-20 text-center"><h1 className="font-display text-5xl">Stranica nije pronađena</h1><p className="mt-3 text-ink-600">Proverite adresu ili se vratite na početnu stranicu.</p><Link href="/" className="mt-6 inline-flex font-medium text-walnut underline">Početna stranica</Link></div>;
}
