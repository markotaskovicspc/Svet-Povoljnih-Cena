import type { Tab } from "@/types";
import { PromoShortcutTile } from "@/components/home/promo-shortcut-tile";

export function ShortcutStrip({ tabs }: { tabs: Tab[] }) {
  const items = tabs.slice(0, 4);
  if (!items.length) return null;

  return (
    <section aria-label="Brze ponude" className="bg-white">
      <div className="mx-auto grid w-full max-w-[var(--container-page)] grid-cols-2 gap-2 px-3 py-3 md:grid-cols-4 md:px-6 md:py-6">
        {items.map((tab) => {
          return (
            <PromoShortcutTile
              key={tab.id}
              tab={tab}
              canonicalize={false}
              variant="homepage"
              className="text-brand-blue"
            />
          );
        })}
      </div>
    </section>
  );
}
