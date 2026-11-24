import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { zCreateDocumentBody, zCreateDocumentUploadSessionBody, zUpdateDocumentBody } from '../src/zod.ts';

/**
 * The contract of the documents of a site survey (EVM-147; ADR-0025): the offer (`quote`) of the order is accepted before the customer, the anchors of the
 * location and the customer, the payments and the ZIP still wait for the customer, the other kinds and the class `identity_data` are a `400` at the field,
 * the rejected survey is read only - and the note of a version (`change_note`) does not exist in the contract. Synthetic data only.
 */
interface Operation {
  readonly operationId?: string;
  readonly responses?: Record<string, { readonly $ref?: string; readonly description?: string }>;
}
interface Bundle {
  readonly paths: Record<string, Record<string, Operation>>;
  readonly components: {
    readonly responses: Record<string, { readonly description: string }>;
    readonly schemas: Record<
      string,
      { readonly description?: string; readonly additionalProperties?: unknown; readonly properties?: object }
    >;
  };
}
const bundle = async (): Promise<Bundle> => JSON.parse(await readFile(new URL('../dist/openapi.json', import.meta.url), 'utf8')) as Bundle;

const describedAnswer = (contract: Bundle, operationId: string, status: string): string => {
  for (const item of Object.values(contract.paths)) {
    for (const operation of Object.values(item)) {
      if (operation.operationId !== operationId) continue;
      const response = operation.responses?.[status];
      const name = response?.$ref?.split('/').pop();
      return name === undefined ? (response?.description ?? '') : (contract.components.responses[name]?.description ?? '');
    }
  }
  return '';
};

const THE_RULE = 'Oferta/wycena';
/** Why the note of a version must stay absent: whoever changes this changes it on purpose (ADR-0025 pt 4, the binding condition). */
const CHANGE_NOTE_GUARD =
  'ADR-0025 pkt 4: change_note must stay absent from the contract (always NULL); the first story that writes it adds GRANT UPDATE (change_note) and its erasure in the purge of a site survey and in the replay of the register';

describe('EVM-147 AC8 the 409 of the documents and the media tell the new rule', () => {
  it('EVM-147 AC8 createDocument: an anchor of the location or the customer is customer_required, a rejected survey work_order_closed, the offer of the order is allowed', async () => {
    const text = describedAnswer(await bundle(), 'createDocument', '409');
    expect(text).toContain('customer_required');
    expect(text).toContain('work_order_closed');
    expect(text).toContain(THE_RULE);
    expect(text).toContain('płatności i ZIP');
    expect(text).not.toContain('każda kotwica');
  });

  it('EVM-147 AC8 createPaymentMilestone and createMediaExport still wait for the customer and say that the offer of the order is allowed', async () => {
    const contract = await bundle();
    for (const operationId of ['createPaymentMilestone', 'createMediaExport']) {
      const text = describedAnswer(contract, operationId, '409');
      expect(text, operationId).toContain('customer_required');
      expect(text, operationId).toContain(THE_RULE);
    }
  });

  it('EVM-147 AC4 AC8 updateDocument and restoreDocument name work_order_closed of a rejected survey; deleteDocument and purgeDocumentFile do not (art. 17)', async () => {
    const contract = await bundle();
    expect(describedAnswer(contract, 'updateDocument', '409')).toContain('work_order_closed');
    expect(describedAnswer(contract, 'updateDocument', '409')).toContain('file_erased');
    expect(describedAnswer(contract, 'restoreDocument', '409')).toContain('work_order_closed');
    expect(describedAnswer(contract, 'deleteDocument', '409')).not.toContain('work_order_closed');
  });

  it('EVM-147 AC2 AC3 AC8 the 400 of a field: requires_customer at /kindCode and /confidentialityOverride, in the request of the creation and of the change', async () => {
    const { schemas } = (await bundle()).components;
    const create = schemas['CreateDocumentRequest']?.description ?? '';
    expect(create).toContain('`/kindCode`, `requires_customer`');
    expect(create).toContain('`/confidentialityOverride`, `requires_customer`');
    expect(create).toContain('building_security');
    expect(schemas['UpdateDocumentRequest']?.description ?? '').toContain('`/confidentialityOverride`, `requires_customer`');
    expect(schemas['DocumentAnchor']?.description ?? '').toContain('409 customer_required');
  });
});

describe('EVM-147 AC5 the contract accepts no change_note (ADR-0025 pt 4)', () => {
  const requests = ['CreateDocumentRequest', 'UpdateDocumentRequest', 'CreateDocumentUploadSessionRequest'];

  it('EVM-147 AC5 the requests of the creation, the change and the upload session are closed and have no field of a note of a version', async () => {
    const { schemas } = (await bundle()).components;
    for (const name of requests) {
      const schema = schemas[name];
      expect(schema?.additionalProperties, `${name}: ${CHANGE_NOTE_GUARD}`).toBe(false);
      const fields = Object.keys(schema?.properties ?? {});
      expect(
        fields.filter((field) => /change_?note/i.test(field)),
        `${name}: ${CHANGE_NOTE_GUARD}`,
      ).toEqual([]);
    }
  });

  it('EVM-147 AC5 the generated schemas know no changeNote and never carry it through', () => {
    const shapes = { zCreateDocumentBody, zUpdateDocumentBody, zCreateDocumentUploadSessionBody };
    for (const [name, schema] of Object.entries(shapes)) {
      const fields = Object.keys(schema.shape);
      expect(
        fields.filter((field) => /change_?note/i.test(field)),
        `${name}: ${CHANGE_NOTE_GUARD}`,
      ).toEqual([]);
    }
    const parsed = zCreateDocumentUploadSessionBody.safeParse({
      id: '0198b0a0-0000-7000-8000-000000000147',
      changeNote: 'x',
      change_note: 'x',
    });
    expect(parsed.success && ('changeNote' in parsed.data || 'change_note' in parsed.data), CHANGE_NOTE_GUARD).toBe(false);
  });
});
