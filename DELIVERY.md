
## X Express povrat → porudžbina VRAĆENO (2026-11-14)
Marko je izričito tražio. Kada X Express javi „Kreiran povrat“ (RETURNING, RET_ASSIGNED, REVERSE_RETURN, REVERSE_RETURNING), pošiljka ostaje IN_TRANSIT (lista vraćenih porudžbina i prijem povrata rade kao do sada), ali porudžbina prelazi u VRACENO sa događajem statusa i uobičajenim obaveštenjem kupcu. Kasnija skeniranja u tranzitu ne vraćaju porudžbinu u U_ISPORUCI/SPREMNO_ZA_ISPORUKU; isporuka (DELIVERED) i dalje postavlja ISPORUCENO. Logika je u src/lib/courier/order-transition.ts (test courier-order-transition). Bez promene šeme.
