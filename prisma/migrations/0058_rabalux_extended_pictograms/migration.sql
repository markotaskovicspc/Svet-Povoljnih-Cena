-- Seed every customer-facing Rabalux pictogram that can be derived reliably
-- from structured fields present in the imported Serbian catalog feed.
INSERT INTO "Pictogram" ("id", "code", "label", "iconUrl") VALUES
  ('rabalux-pictogram-color-temperature', 'rabalux-color-temperature', 'Promena temperature boje', '/brand/pictograms/rabalux/color-temperature.png'),
  ('rabalux-pictogram-rgb', 'rabalux-rgb', 'RGB svetlo', '/brand/pictograms/rabalux/rgb.png'),
  ('rabalux-pictogram-memory', 'rabalux-memory', 'Memorijska funkcija', '/brand/pictograms/rabalux/memory.png'),
  ('rabalux-pictogram-timer', 'rabalux-timer', 'Tajmer', '/brand/pictograms/rabalux/timer.png'),
  ('rabalux-pictogram-nightlight', 'rabalux-nightlight', 'Noćno svetlo', '/brand/pictograms/rabalux/nightlight.png'),
  ('rabalux-pictogram-own-design', 'rabalux-own-design', 'Rabalux dizajn', '/brand/pictograms/rabalux/own-design.png'),
  ('rabalux-pictogram-starry-effect', 'rabalux-starry-effect', 'Efekat zvezdanog neba', '/brand/pictograms/rabalux/starry-effect.png'),
  ('rabalux-pictogram-backlight', 'rabalux-backlight', 'Pozadinsko osvetljenje', '/brand/pictograms/rabalux/backlight.png'),
  ('rabalux-pictogram-textile-cable', 'rabalux-textile-cable', 'Tekstilni kabl', '/brand/pictograms/rabalux/textile-cable.png'),
  ('rabalux-pictogram-bluetooth', 'rabalux-bluetooth', 'Bluetooth kontrola', '/brand/pictograms/rabalux/bluetooth.png'),
  ('rabalux-pictogram-usb-port', 'rabalux-usb-port', 'USB priključak', '/brand/pictograms/rabalux/usb-port.png'),
  ('rabalux-pictogram-usb-charging', 'rabalux-usb-charging', 'USB punjenje', '/brand/pictograms/rabalux/usb-charging.png'),
  ('rabalux-pictogram-speaker', 'rabalux-speaker', 'Ugrađeni zvučnik', '/brand/pictograms/rabalux/speaker.png'),
  ('rabalux-pictogram-microwave-sensor', 'rabalux-microwave-sensor', 'Mikrotalasni senzor pokreta', '/brand/pictograms/rabalux/microwave-sensor.png'),
  ('rabalux-pictogram-motion-sensor', 'rabalux-motion-sensor', 'Senzor pokreta', '/brand/pictograms/rabalux/motion-sensor.png'),
  ('rabalux-pictogram-light-sensor', 'rabalux-light-sensor', 'Svetlosni senzor', '/brand/pictograms/rabalux/light-sensor.png'),
  ('rabalux-pictogram-solar', 'rabalux-solar', 'Solarno napajanje', '/brand/pictograms/rabalux/solar.png'),
  ('rabalux-pictogram-wireless-charging', 'rabalux-wireless-charging', 'Bežično punjenje', '/brand/pictograms/rabalux/wireless-charging.png'),
  ('rabalux-pictogram-fan', 'rabalux-fan', 'Ventilator', '/brand/pictograms/rabalux/fan.png'),
  ('rabalux-pictogram-battery', 'rabalux-battery', 'Baterija / akumulator', '/brand/pictograms/rabalux/battery.png')
ON CONFLICT ("code") DO UPDATE SET
  "label" = EXCLUDED."label",
  "iconUrl" = EXCLUDED."iconUrl";
