import type { Customer } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import { buildPatch, changedFields, currentText, formOf } from '../src/customers/customer-form.ts';

const JAN: Customer = {
  id: '01968f3e-0000-7000-8000-00000000aaa1',
  kind: 'person',
  firstName: 'Jan',
  lastName: 'Przykładowy',
  phone: '+48600000001',
  email: 'jan.przykladowy@example.com',
  postalAddress: { street: 'ul. Testowa', buildingNumber: '7', postalCode: '00-001', city: 'Warszawa' },
  notes: 'Kontakt po 16:00.',
  displayName: 'Jan Przykładowy',
  version: 3,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

const FIRMA: Customer = {
  id: '01968f3e-0000-7000-8000-00000000aaa2',
  kind: 'company',
  companyName: 'Firma Testowa sp. z o.o.',
  taxId: '5260250274',
  contactPersonName: 'Ewa Kontaktowa',
  phone: '+48600000002',
  displayName: 'Firma Testowa sp. z o.o.',
  version: 1,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const withoutEmail: Customer = { ...JAN };
delete withoutEmail.email;

describe('form of the dialog "Edytuj dane klienta" (EVM-039 AC3)', () => {
  it('EVM-039 AC3 the form holds the customer as sent, the phone shown as +48 600 000 001', () => {
    expect(formOf(JAN)).toMatchObject({
      kind: 'person',
      firstName: 'Jan',
      lastName: 'Przykładowy',
      phone: '+48 600 000 001',
      email: 'jan.przykladowy@example.com',
      street: 'ul. Testowa',
      city: 'Warszawa',
      notes: 'Kontakt po 16:00.',
      companyName: '',
    });
    expect(formOf(FIRMA)).toMatchObject({
      kind: 'company',
      companyName: 'Firma Testowa sp. z o.o.',
      taxId: '5260250274',
      email: '',
      street: '',
    });
  });

  it('EVM-039 AC3 nothing typed means an empty patch — and no field of the server is ever in it (AC4)', () => {
    const form = formOf(JAN);
    expect(changedFields(form, form)).toEqual([]);
    expect(buildPatch(form, form)).toEqual({});
    expect(buildPatch(form, { ...form, phone: ' +48 600 000 001 ' })).toEqual({});
  });

  it('EVM-039 AC3 a changed phone and a new e-mail are the only fields of the patch', () => {
    const initial = formOf(withoutEmail);
    const patch = buildPatch(initial, { ...initial, phone: '600 000 008', email: ' NOWY@example.com ' });
    expect(patch).toEqual({ phone: '600 000 008', email: 'NOWY@example.com' });
  });

  it('EVM-039 AC3 an emptied optional field is null (cleared); the phone, a required field, is never emptied by the patch', () => {
    const initial = formOf(JAN);
    expect(buildPatch(initial, { ...initial, email: '  ', notes: '' })).toEqual({ email: null, notes: null });
  });

  it('EVM-039 AC3 a touched address goes whole, an emptied one as null', () => {
    const initial = formOf(JAN);
    expect(buildPatch(initial, { ...initial, city: 'Łódź', apartmentNumber: '4' })).toEqual({
      postalAddress: { street: 'ul. Testowa', buildingNumber: '7', apartmentNumber: '4', postalCode: '00-001', city: 'Łódź' },
    });
    expect(buildPatch(initial, { ...initial, street: '', buildingNumber: '', postalCode: '', city: '' })).toEqual({ postalAddress: null });
  });

  it('EVM-039 AC3 a change of the kind names the kind and the fields of the new kind; company-only fields are sent for a company', () => {
    const initial = formOf(JAN);
    expect(
      buildPatch(initial, { ...initial, kind: 'company', companyName: 'Nowa Firma', taxId: ' 5260250274 ', contactPersonName: '' }),
    ).toEqual({
      kind: 'company',
      companyName: 'Nowa Firma',
      taxId: '5260250274',
    });
    const company = formOf(FIRMA);
    expect(buildPatch(company, { ...company, kind: 'person', firstName: 'Anna', lastName: 'Nowak' })).toEqual({
      kind: 'person',
      firstName: 'Anna',
      lastName: 'Nowak',
    });
    expect(buildPatch(company, { ...company, taxId: '', contactPersonName: 'Ktoś Inny' })).toEqual({
      taxId: null,
      contactPersonName: 'Ktoś Inny',
    });
  });

  it('EVM-039 AC3 "Aktualnie" is the text of the customer as the API holds it now', () => {
    expect(currentText(JAN, 'phone')).toBe('+48 600 000 001');
    expect(currentText(JAN, 'email')).toBe('jan.przykladowy@example.com');
    expect(currentText(FIRMA, 'email')).toBe('');
  });
});
