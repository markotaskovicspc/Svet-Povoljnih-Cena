import type { NavNode } from "@/data/site";

const categoryFallbackImages: Record<string, string> = {
  Nameštaj:
    "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=320&h=210&q=80",
  "Sve za kuću":
    "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=320&h=210&q=80",
  "Kućni aparati":
    "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=320&h=210&q=80",
  "Mali kućni aparati":
    "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=320&h=210&q=80",
  "Moda i putovanja":
    "https://images.unsplash.com/photo-1553531384-411a247ccd73?auto=format&fit=crop&w=320&h=210&q=80",
  "Moda & putovanja":
    "https://images.unsplash.com/photo-1553531384-411a247ccd73?auto=format&fit=crop&w=320&h=210&q=80",
  "Baštenski nameštaj":
    "https://images.unsplash.com/photo-1600210491892-03d54c0aaf87?auto=format&fit=crop&w=320&h=210&q=80",
  Kancelarija:
    "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=320&h=210&q=80",
  Trpezarija:
    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=320&h=210&q=80",
  "Dnevna soba":
    "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=320&h=210&q=80",
  Predsoblje:
    "https://images.unsplash.com/photo-1551298370-9d3d53740c72?auto=format&fit=crop&w=320&h=210&q=80",
  Gejming:
    "https://images.unsplash.com/photo-1598550476439-6847785fcea6?auto=format&fit=crop&w=320&h=210&q=80",
  "Spavaća soba":
    "https://images.unsplash.com/photo-1505693314120-0d443867891c?auto=format&fit=crop&w=320&h=210&q=80",
  Bazeni:
    "https://images.unsplash.com/photo-1572331165267-854da2b10ccc?auto=format&fit=crop&w=320&h=210&q=80",
  Alat: "https://images.unsplash.com/photo-1530124566582-a618bc2615dc?auto=format&fit=crop&w=320&h=210&q=80",
  Rasveta:
    "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=320&h=210&q=80",
  "Čišćenje i održavanje":
    "https://images.unsplash.com/photo-1563453392212-326f5e854473?auto=format&fit=crop&w=320&h=210&q=80",
  Dekoracija:
    "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=320&h=210&q=80",
  Kupatilo:
    "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=320&h=210&q=80",
  Tepisi:
    "https://images.unsplash.com/photo-1600166898405-da9535204843?auto=format&fit=crop&w=320&h=210&q=80",
  "Kafe aparati":
    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=320&h=210&q=80",
  "Lepota i nega":
    "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=320&h=210&q=80",
  "Hlađenje i grejanje":
    "https://images.unsplash.com/photo-1567767292278-a4f21aa2d36e?auto=format&fit=crop&w=320&h=210&q=80",
  "Priprema hrane":
    "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=320&h=210&q=80",
  "Kuvanje i pečenje":
    "https://images.unsplash.com/photo-1556911073-38141963c9e0?auto=format&fit=crop&w=320&h=210&q=80",
  Pegle:
    "https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?auto=format&fit=crop&w=320&h=210&q=80",
  Usisivači:
    "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=320&h=210&q=80",
  "Prečišćivači vazduha":
    "https://images.unsplash.com/photo-1585338107529-13afc5f02586?auto=format&fit=crop&w=320&h=210&q=80",
  "Aparati za vodu":
    "https://images.unsplash.com/photo-1559827260-dc66d52bef19?auto=format&fit=crop&w=320&h=210&q=80",
  "Ženske torbe":
    "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=320&h=210&q=80",
  "Ženske čarape":
    "https://images.unsplash.com/photo-1586350977771-b3b0abd50c82?auto=format&fit=crop&w=320&h=210&q=80",
  Aksesoari:
    "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=320&h=210&q=80",
  Koferi:
    "https://images.unsplash.com/photo-1553531384-411a247ccd73?auto=format&fit=crop&w=320&h=210&q=80",
};

const defaultCategoryImage =
  "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=320&h=210&q=80";

export function getCategoryMenuImage(
  node: Pick<NavNode, "imageUrl" | "label">,
) {
  return (
    node.imageUrl ?? categoryFallbackImages[node.label] ?? defaultCategoryImage
  );
}
