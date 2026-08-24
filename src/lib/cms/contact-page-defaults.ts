export function defaultContactPageWidgetData() {
  return {
    version: 1 as const,
    channels: [
      {
        id: "email" as const,
        enabled: true,
        label: "E-pošta",
        value: "podrska@svetpovoljnihcena.rs",
        note:
          "Za pitanja o porudžbinama, proizvodima i reklamacijama · Ponedeljak–subota, 08:00–20:00",
      },
      {
        id: "merchant" as const,
        enabled: true,
        label: "Sedište trgovca",
        value: "Vojvođanska 401, 11000 Beograd",
        note: "Ovo nije mesto za preuzimanje bez prethodne potvrde",
      },
      {
        id: "warehouse" as const,
        enabled: true,
        label: "Skladište / preuzimanje",
        value: "Evropska bb, 22300 Stara Pazova",
        note: "Dolazak isključivo nakon potvrde podrške",
      },
      {
        id: "returns" as const,
        enabled: true,
        label: "Povraćaj robe",
        value: "Evropska bb, 22300 Stara Pazova",
        note: "Marko Medić · 060 511 5034",
      },
    ],
  };
}
