-- Align existing customer records with ERP module 19, where gender is derived
-- deterministically from the customer's first name.
UPDATE "Customer"
SET
  "gender" = CASE
    WHEN NULLIF(trim("firstName"), '') IS NULL
      THEN 'NEPOZNATO'::"CustomerGender"
    WHEN lower(trim(split_part("firstName", ' ', 1))) IN ('saša', 'sasa', 'staša', 'stasa', 'vanja')
      THEN 'NEPOZNATO'::"CustomerGender"
    WHEN lower(trim(split_part("firstName", ' ', 1))) IN (
      'andreja', 'andrija', 'ilija', 'isaija', 'ivica', 'jovica', 'kosta',
      'luka', 'matija', 'nemanja', 'nikola', 'novica', 'sava', 'vukota', 'života', 'zivota'
    )
      THEN 'MUSKI'::"CustomerGender"
    WHEN lower(trim(split_part("firstName", ' ', 1))) IN (
      'doris', 'ines', 'iris', 'karmen', 'merjem', 'miriam', 'nives'
    )
      THEN 'ZENSKI'::"CustomerGender"
    WHEN right(lower(trim(split_part("firstName", ' ', 1))), 1) = 'a'
      THEN 'ZENSKI'::"CustomerGender"
    ELSE 'MUSKI'::"CustomerGender"
  END,
  "updatedAt" = CURRENT_TIMESTAMP;
