import type { Tab } from "@/types";
import { PromoShortcutTile } from "@/components/home/promo-shortcut-tile";

export function ShortcutStrip({ tabs }: { tabs: Tab[] }) {
  const items = tabs.slice(0, 4);
  if (!items.length) return null;

  return (
    <section aria-label="Brze ponude" className="bg-white">
      <div className="mx-auto flex w-full max-w-[var(--container-page)] snap-x snap-mandatory gap-3 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-4 md:overflow-visible md:px-6 md:py-6">
        {items.map((tab) => {
          return (
            <PromoShortcutTile
              key={tab.id}
              tab={tab}
              canonicalize={false}
              variant="homepage"
              className="w-[78vw] shrink-0 snap-start text-brand-blue md:w-auto md:min-w-0"
            />
          );
        })}
      </div>
    </section>
  );
}
