# Login And Registration UX

## Summary

Add a real registration path behind the login page CTA and reuse the existing Auth.js OAuth setup so customers can sign in or create an account with Google, Facebook, or Apple. The implementation target is `/Users/luka/svet povoljnih cena`; the currently open `svet akcija` folder only contains plan files.

## Key Changes

- Update `/nalog/prijava`:
  - Replace the current guest-only note with clear copy: "Nemate nalog? Registrujte se."
  - Link to `/nalog/registracija`, preserving `callbackUrl`.
  - Keep email/password login and existing OAuth server actions.
  - Present configured Google, Facebook, and Apple buttons with polished, accessible button text.
- Add `/nalog/registracija`:
  - Create a registration page matching the current login layout and visual language.
  - Include email, password, confirm password, optional first/last name, and a submit button.
  - Use `registerCustomer`, then sign the customer in with credentials and redirect to the safe `callbackUrl`.
  - Handle duplicate email, invalid password, and password mismatch with friendly Serbian messages.
  - Add "Vec imate nalog? Prijavite se." linking back to `/nalog/prijava`.
- Share auth UI behavior:
  - Extract repeated social-auth rendering into a small account-level component/helper.
  - Keep OAuth buttons conditional on provider env vars, because Auth.js cannot complete social login/register without provider credentials.
  - Preserve the current safe callback rules blocking external URLs, admin redirects, and login/register loops.

## Public Interfaces

- New public route: `/nalog/registracija`.
- No database schema change.
- No Auth.js provider contract change; social registration uses the existing Prisma adapter behavior where OAuth sign-in creates the customer account if needed.

## Test Plan

- Run `npm run lint`.
- Run `npm run build` if the local environment has required env vars.
- Visit `/nalog/prijava` and confirm the register CTA is visible, localized, and preserves `callbackUrl`.
- Visit `/nalog/registracija`:
  - New email creates an account and redirects to `/nalog` or the callback.
  - Existing email shows a duplicate-email message.
  - Password mismatch shows an error without creating a user.
- With OAuth env vars configured, verify Google, Facebook, and Apple buttons appear on both login and registration pages and redirect through Auth.js.
- Without OAuth env vars, verify the page still works cleanly with email/password and does not show broken provider buttons.

## Assumptions

- Registration should be a real email/password page, not just a link.
- Social login and social registration are the same Auth.js OAuth flow with different page copy.
- Existing dirty changes in `src/lib/api/search.ts` and `svet akcija/` should be preserved.
