import type { Pictogram } from "@/types";

const WARRANTY_PICTOGRAM_CODE = "3";
const EXPRESS_DELIVERY_PICTOGRAM_CODE = "48h";

export const WARRANTY_2_PLUS_1_PICTOGRAM: Pictogram = {
  id: "storefront-warranty-2-plus-1",
  code: WARRANTY_PICTOGRAM_CODE,
  label: "2+1",
  iconUrl:
    "https://vyebjbcfhgujlvjnoxpl.supabase.co/storage/v1/object/public/product-media/pictograms/3-1787082602280-70e8672f24bb5f45.png",
};

export const EXPRESS_DELIVERY_48H_PICTOGRAM: Pictogram = {
  id: "storefront-delivery-48h",
  code: EXPRESS_DELIVERY_PICTOGRAM_CODE,
  label: "48h",
  iconUrl:
    "https://vyebjbcfhgujlvjnoxpl.supabase.co/storage/v1/object/public/product-media/pictograms/48h-1786805151454-9d1e149f7492dec5.jpeg",
};

function findConfiguredPictogram(
  pictograms: readonly Pictogram[],
  code: string,
  fallback: Pictogram,
) {
  return pictograms.find((pictogram) => pictogram.code === code) ?? fallback;
}

/**
 * Storefront-wide pictogram placement rules.
 *
 * The admin assignments remain authoritative for icon metadata when present,
 * while the fallbacks make the two global rules apply to current and future
 * products without mass-writing ProductPictogram rows.
 */
export function resolveStorefrontPictograms({
  pictograms,
  supplierIntegrationKey,
}: {
  pictograms: readonly Pictogram[];
  supplierIntegrationKey?: string | null;
}) {
  const isRabalux =
    supplierIntegrationKey?.trim().toUpperCase() === "RABALUX";
  const productSpecific = pictograms.filter(
    (pictogram) =>
      pictogram.code !== WARRANTY_PICTOGRAM_CODE &&
      pictogram.code !== EXPRESS_DELIVERY_PICTOGRAM_CODE,
  );
  const featurePictograms = [
    ...productSpecific,
    ...(!isRabalux
      ? [
          findConfiguredPictogram(
            pictograms,
            WARRANTY_PICTOGRAM_CODE,
            WARRANTY_2_PLUS_1_PICTOGRAM,
          ),
        ]
      : []),
  ];
  const cornerPictograms = [
    findConfiguredPictogram(
      pictograms,
      EXPRESS_DELIVERY_PICTOGRAM_CODE,
      EXPRESS_DELIVERY_48H_PICTOGRAM,
    ),
  ];

  return {
    featurePictograms,
    cornerPictograms,
  };
}
