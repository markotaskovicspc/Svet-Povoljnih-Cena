"use client";

/** USP strip — delivery, returns, secure pay, support. Sits above newsletter/footer. */
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Truck,
  RotateCcw,
  ShieldCheck,
  Headphones,
  type LucideIcon,
} from "lucide-react";

interface UspItem {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const items: UspItem[] = [
  {
    id: "delivery",
    icon: Truck,
    title: "Brza isporuka",
    body: "Isporuka 3–10 dana širom Srbije. Besplatno preko 30.000 RSD.",
  },
  {
    id: "returns",
    icon: RotateCcw,
    title: "Vraćanje 14 dana",
    body: "Bez objašnjenja. Pun povrat sredstava u skladu sa zakonom.",
  },
  {
    id: "payment",
    icon: ShieldCheck,
    title: "Bezbedno plaćanje",
    body: "Raiffeisen IPS za QR plaćanje, RaiAccept za kartice i novčanike.",
  },
  {
    id: "support",
    icon: Headphones,
    title: "Podrška svaki dan",
    body: "Tim za korisnike dostupan radnim danom 9–20h, vikendom 10–16h.",
  },
];

export function UspStrip() {
  return (
    <section
      aria-label="Naše prednosti"
      className="border-border/60 border-y bg-muted-bg/40"
    >
      <div className="mx-auto grid w-full max-w-[var(--container-page)] grid-cols-1 gap-6 px-6 py-12 sm:grid-cols-2 md:grid-cols-4 md:py-16">
        {items.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{
              duration: 0.45,
              ease: [0.22, 1, 0.36, 1],
              delay: i * 0.05,
            }}
            className="flex items-start gap-3"
          >
            <span className="bg-surface text-walnut ring-border/60 grid size-11 shrink-0 place-items-center rounded-xl ring-1 shadow-soft-1">
              <item.icon className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium text-ink-900">{item.title}</p>
              <p className="mt-1 text-xs text-ink-500">{item.body}</p>
              {item.id === "payment" ? (
                <Image
                  src="/icons/ips-skeniraj.svg"
                  alt="IPS Skeniraj"
                  width={100}
                  height={33}
                  className="mt-2 h-7 w-auto"
                />
              ) : null}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
