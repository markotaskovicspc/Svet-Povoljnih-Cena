import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CustomerLoginFields } from "@/app/(account)/nalog/prijava/form";
import {
  CustomerRegistrationFields,
  RegistrationError,
} from "@/app/(account)/nalog/registracija/form";
import { NewPasswordFields } from "@/app/(account)/nalog/lozinka/nova/form";
import {
  CUSTOMER_PASSWORD_MIN_LENGTH,
  isValidCustomerPassword,
} from "@/lib/auth/customer-password-policy";

describe("customer password policy", () => {
  it("accepts any six characters and rejects shorter passwords", () => {
    expect(CUSTOMER_PASSWORD_MIN_LENGTH).toBe(6);
    expect(isValidCustomerPassword("123456")).toBe(true);
    expect(isValidCustomerPassword("!!!!!!")).toBe(true);
    expect(isValidCustomerPassword("      ")).toBe(true);
    expect(isValidCustomerPassword("12345")).toBe(false);
  });

  it("keeps the six-character minimum on login and password reset", () => {
    const login = renderToStaticMarkup(<CustomerLoginFields />);
    const reset = renderToStaticMarkup(<NewPasswordFields />);

    expect(login).toMatch(
      /<input[^>]+id="password"[^>]+minLength="6"[^>]+name="password"/,
    );
    expect(reset.match(/minLength="6"/g)).toHaveLength(2);
  });
});

describe("customer registration form", () => {
  it("asks only for email and one password as account credentials", () => {
    const markup = renderToStaticMarkup(<CustomerRegistrationFields />);

    expect(markup).toContain('name="email"');
    expect(markup).toMatch(
      /<input[^>]+id="password"[^>]+minLength="6"[^>]+name="password"/,
    );
    expect(markup).not.toContain('name="firstName"');
    expect(markup).not.toContain('name="lastName"');
    expect(markup).not.toContain('name="confirmPassword"');
  });

  it("explains the six-character minimum", () => {
    const markup = renderToStaticMarkup(
      <RegistrationError error="weak_password" />,
    );

    expect(markup).toContain("najmanje 6 karaktera");
  });
});
