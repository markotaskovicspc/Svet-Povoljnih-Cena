import Link from "next/link";

/** Only link references that resolve to a real ERP batch. React escapes the note. */
export function PickupReferenceNote({ note, batches }: {
  note: string;
  batches: readonly { id: string; number: string }[];
}) {
  const ids = new Map(batches.map((batch) => [batch.number, batch.id]));
  return <>{note.split(/(\bPRE-\d{4}-\d+\b)/g).map((part, index) => {
    const id = ids.get(part);
    return id ? <Link key={index} href={`/admin/erp/preuzimanja/${id}`} className="font-medium text-walnut underline">{part}</Link> : part;
  })}</>;
}
