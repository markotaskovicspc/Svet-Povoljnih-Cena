export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6 px-4 py-8 md:px-8">
      <p className="text-sm text-ink-500">Učitavanje podataka…</p>
      <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-8 w-64 rounded-lg bg-muted-bg" />
        <div className="h-12 rounded-lg bg-muted-bg" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-10 rounded-lg bg-muted-bg" />
        ))}
      </div>
    </div>
  );
}
