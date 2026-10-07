/**
 * A phone number for the eye (styleguide § 6.3): `+48600123456` is shown as `+48 600 123 456`. Only the display changes —
 * the API keeps and sends E.164, and the panel never normalises what a person types (the server does, AC2). A number that is
 * not a Polish one in E.164 is shown as it came.
 */
export function formatPhone(phone: string): string {
  const match = /^\+48(\d{3})(\d{3})(\d{3})$/.exec(phone);
  return match === null ? phone : `+48 ${match[1] ?? ''} ${match[2] ?? ''} ${match[3] ?? ''}`;
}
