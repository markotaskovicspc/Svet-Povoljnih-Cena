-- SPC Analytics (Marko, 12.11.2026): postojeći aktivni SPCApp ključevi smeju da evidentiraju
-- isplatu reklamacije nađenu na izvodu (scope spcapp:reclamation-payout). Ništa drugo se ne menja.
UPDATE "PartnerApiClient"
SET "scopes" = array_append("scopes", 'spcapp:reclamation-payout')
WHERE 'spcapp:read' = ANY("scopes") AND NOT ('spcapp:reclamation-payout' = ANY("scopes"));
