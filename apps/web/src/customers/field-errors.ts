import type { TFunction } from 'i18next';
import type { FieldName } from './customer-form.ts';

/** The text under a field for a code of the server (never the value — the API sends none, SR-ERR-02). */
export function errorText(t: TFunction, field: FieldName, code: string): string {
  switch (code) {
    case 'required':
      return t('customers.errors.required');
    case 'too_long':
      return t('customers.errors.tooLong');
    case 'invalid_characters':
      return t('customers.errors.invalidCharacters');
    case 'invalid_format':
      switch (field) {
        case 'phone':
          return t('customers.errors.phone');
        case 'email':
          return t('customers.errors.email');
        case 'taxId':
          return t('customers.errors.taxId');
        case 'postalCode':
          return t('customers.errors.postalCode');
        default:
          return t('customers.errors.invalid');
      }
    default:
      return t('customers.errors.invalid');
  }
}
