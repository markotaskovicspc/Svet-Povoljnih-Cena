export const CUSTOMER_PASSWORD_MIN_LENGTH = 6;
export const CUSTOMER_PASSWORD_MAX_LENGTH = 200;

export function isValidCustomerPassword(password: string) {
  return (
    password.length >= CUSTOMER_PASSWORD_MIN_LENGTH &&
    password.length <= CUSTOMER_PASSWORD_MAX_LENGTH
  );
}
