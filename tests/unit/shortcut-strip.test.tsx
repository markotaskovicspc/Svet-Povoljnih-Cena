import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShortcutStrip } from "@/components/home/shortcut-strip";
import type { Tab } from "@/types";

const tabs: Tab[] = [
  {
    id: "heroji-meseca",
    label: "Heroji meseca",
    href: "/heroji-meseca",
    order: 1,
    icon: "Crown",
  },
  {
    id: "mesecna-akcija",
    label: "Mesečna akcija",
    href: "/akcija",
    order: 2,
    icon: "Tag",
  },
  {
    id: "niske-cene-pod-zastitom",
    label: "Niske cene pod trajnom zaštitom",
    href: "/niske-cene-pod-zastitom",
    order: 3,
    icon: "ShieldCheck",
  },
  {
    id: "sve-do-999",
    label: "Sve do 999",
    href: "/ogranicena-ponuda",
    order: 4,
    icon: "Sparkles",
  },
  {
    id: "ignored-fifth-tab",
    label: "Peti prečac",
    href: "/novo",
    order: 5,
    icon: "Sparkles",
  },
];

describe("ShortcutStrip", () => {
  it("renders the first four shortcuts with the compact homepage presentation", () => {
    const html = renderToStaticMarkup(<ShortcutStrip tabs={tabs} />);

    expect(html).toContain('aria-label="Brze ponude"');
    expect(html.match(/data-shortcut-variant="homepage"/g)).toHaveLength(4);
    expect(html).toContain("Niske cene pod trajnom zaštitom");
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("min-h-14");
    expect(html).not.toContain("h-14 min-h-14");
    expect(html).toContain("text-[14.5px]");
    expect(html).toContain("whitespace-normal");
    expect(html).not.toContain("line-clamp-3");
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("min-h-28");
    expect(html).not.toContain("text-2xl");
    expect(html).not.toContain("Peti prečac");
  });
});
