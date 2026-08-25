import { ChevronLeft } from "lucide-react";

export function DesktopCategoryBackRow({
  label,
  onBack,
}: {
  label: string;
  onBack: () => void;
}) {
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={onBack}
        aria-label={`Nazad iz kategorije ${label}`}
        className="flex min-h-13 w-full items-center gap-3 py-3 pr-5 pl-[4.6rem] text-left text-sm font-bold whitespace-nowrap text-ink-500 uppercase transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none sm:pr-6 sm:pl-[4.85rem]"
      >
        <ChevronLeft className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
      </button>
    </div>
  );
}
