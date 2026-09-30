/** Live text replaces the old baked-in percentage when the scheduled rate changes. */
export function FirstPurchaseBanner({ percent }: { percent: number }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#073c7b] to-[#061b38] px-8 pb-20 text-center text-white md:flex-row md:gap-12 md:px-24 md:pb-14 md:text-left">
      <div className="md:max-w-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70 md:text-sm">Svet Povoljnih Cena</p>
        <p className="mt-3 text-2xl font-bold leading-tight md:text-4xl lg:text-5xl">Prva kupovina.<br />Još povoljnije.</p>
      </div>
      <div className="shrink-0 text-[clamp(5rem,12vw,10rem)] font-black leading-none tracking-tighter text-[#ff354e]">{percent}%</div>
      <div className="max-w-64">
        <p className="text-base font-semibold md:text-2xl">Popusta za nove kupce</p>
        <p className="mt-2 text-sm leading-relaxed text-white/80">Popust se obračunava na artikle pri prvoj kupovini. Bez promo koda.</p>
      </div>
    </div>
  );
}
