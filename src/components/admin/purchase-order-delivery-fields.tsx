"use client";

import { useState } from "react";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function PurchaseOrderDeliveryFields({
  initialPortDeliveryDate,
  initialDeliveryDate,
}: {
  initialPortDeliveryDate: string;
  initialDeliveryDate: string;
}) {
  const [portDeliveryDate, setPortDeliveryDate] = useState(
    initialPortDeliveryDate,
  );
  const [deliveryDate, setDeliveryDate] = useState(initialDeliveryDate);

  return (
    <>
      <Field
        label="Datum isporuke u luku"
        hint="Kada unesete datum, krajnji datum isporuke se predlaže 15 dana kasnije."
      >
        <Input
          name="portDeliveryDate"
          type="date"
          value={portDeliveryDate}
          onChange={(event) => {
            const value = event.target.value;
            setPortDeliveryDate(value);
            if (value) setDeliveryDate(addDays(value, 15));
          }}
        />
      </Field>
      <Field
        label="Datum isporuke"
        hint="Predloženi datum možete ručno da promenite."
      >
        <Input
          name="deliveryDate"
          type="date"
          value={deliveryDate}
          onChange={(event) => setDeliveryDate(event.target.value)}
        />
      </Field>
    </>
  );
}
