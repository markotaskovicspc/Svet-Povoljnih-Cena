import { BannerPlacement } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_BANNER_ID_PREFIX,
  getBuiltInBannerSeeds,
  isBuiltInBannerId,
} from "../../src/lib/banners/builtins";

describe("built-in homepage banners", () => {
  it("exposes every currently rendered hero slide to the admin", () => {
    const hero = getBuiltInBannerSeeds(BannerPlacement.HERO);

    expect(hero).toHaveLength(3);
    expect(hero.map((banner) => banner.title)).toEqual([
      "Izdvojena ponuda",
      "Heroji meseca",
      "Ponuda na jednom mestu",
    ]);
    expect(hero.every((banner) => Boolean(banner.imageDesktop))).toBe(true);
    expect(hero.every((banner) => Boolean(banner.imageMobile))).toBe(true);
  });

  it("exposes both current homepage interstitial banners", () => {
    const afterSecond = getBuiltInBannerSeeds(
      BannerPlacement.HOME_AFTER_SECOND_ROW,
    );
    const afterFourth = getBuiltInBannerSeeds(
      BannerPlacement.HOME_AFTER_FOURTH_ROW,
    );

    expect(afterSecond.map((banner) => banner.title)).toEqual([
      "Niske cene pod trajnom zaštitom",
    ]);
    expect(afterFourth.map((banner) => banner.title)).toEqual([
      "Novo u ponudi",
    ]);
  });

  it("uses stable IDs so the first edit can materialize all fallbacks safely", () => {
    const firstId = String(
      getBuiltInBannerSeeds(BannerPlacement.HERO)[0]?.id,
    );

    expect(firstId.startsWith(BUILT_IN_BANNER_ID_PREFIX)).toBe(true);
    expect(isBuiltInBannerId(firstId)).toBe(true);
    expect(isBuiltInBannerId("cm123")).toBe(false);
  });
});
