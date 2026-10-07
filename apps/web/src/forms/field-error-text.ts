import type { TFunction } from 'i18next';

/**
 * The text under a field for a code of the server (EVM-021 AC2, AC3, AC5). The API sends a pointer and a code, never the value
 * (SR-ERR-02); the panel turns the code into a sentence, and for `invalid_format` the name of the field decides which one.
 */
export function fieldErrorText(t: TFunction, field: string, code: string): string {
  switch (code) {
    case 'required':
      return t('formErrors.required');
    case 'too_long':
      return t('formErrors.tooLong');
    case 'invalid_characters':
      return t('formErrors.invalidCharacters');
    case 'out_of_range':
      return field === 'connectionPowerKw' ? t('formErrors.power') : t('formErrors.invalid');
    case 'not_allowed_for_site_type':
      return t('formErrors.garageOnly');
    case 'wrong_party_kind':
      return t('formErrors.wrongPartyKind');
    case 'unknown_party':
      return t('formErrors.unknownParty');
    case 'invalid_format':
      switch (field) {
        case 'phone':
          return t('formErrors.phone');
        case 'email':
          return t('formErrors.email');
        case 'postalCode':
          return t('formErrors.postalCode');
        case 'connectionPowerKw':
          return t('formErrors.power');
        default:
          return t('formErrors.invalid');
      }
    default:
      return t('formErrors.invalid');
  }
}
