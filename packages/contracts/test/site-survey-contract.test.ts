import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import { parseSyncChange } from '../src/sync.ts';
import {
  zClientConfig,
  zCreateSiteSurveyPayload,
  zCreateSiteSurveyRequest,
  zCreateSiteSurveyResponse,
  zCreateWorkOrderRequest,
  zCurrentSession,
  zListWorkOrdersQuery,
  zSyncMutation,
  zSyncMutationsResponse,
  zSyncWorkOrder,
  zWorkOrderDetails,
  zWorkOrderListItem,
} from '../src/zod.ts';

/**
 * The contract of the site survey (EVM-135; ADR-0024): the command of the phone, the shape of an order without a customer on
 * the phone, in the detail and on the list, the filter of the list, the switch and the code `customer_required` of the operations that wait for a customer.
 * The parallel stories (EVM-136, EVM-137, EVM-138) start from this contract; the operation of the panel (`createSiteSurvey`) joined it with its route
 * (EVM-135 stage 2), because an operation of the panel cannot be marked planned (EVM-090). Synthetic data only.
 */
const V7 = '0198b0a0-0000-7000-8000-000000000135';
const ANY = '0198b0a0-0000-4000-8000-000000000136';
const SURVEY = { expiresAt: '2027-02-14T08:00:00.000Z', extensionCount: 0, requesterPhone: '+48600700800' };
const NEW_SITE = {
  id: V7,
  siteType: 'single_family_house',
  street: 'ul. Fikcyjna',
  buildingNumber: '1',
  postalCode: '00-001',
  city: 'Fikcyjnowo',
};

const syncOrder = {
  type: 'work_order',
  id: V7,
  version: 1,
  number: 'ZL-2026-0135',
  title: 'Wizja lokalna',
  status: 'quoting',
  customerId: null,
  siteId: ANY,
  coordinatorUserId: ANY,
  description: null,
  plannedDate: null,
  createdAt: '2026-11-16T08:00:00.000Z',
  closedAt: null,
  siteSurvey: SURVEY,
};

describe('EVM-135 AC1 the command CreateSiteSurvey v1 of the phone', () => {
  it('EVM-135 AC1 the payload is workOrderId, siteId or newSite, an optional title and an optional requester phone - nothing else', () => {
    expect(Object.keys(zCreateSiteSurveyPayload.shape).sort()).toEqual(['newSite', 'requesterPhone', 'siteId', 'title', 'workOrderId']);
    expect(zCreateSiteSurveyPayload.safeParse({ workOrderId: V7, siteId: ANY }).success).toBe(true);
    expect(
      zCreateSiteSurveyPayload.safeParse({ workOrderId: V7, newSite: NEW_SITE, title: 'Garaż', requesterPhone: '600 700 800' }).success,
    ).toBe(true);
    expect(zCreateSiteSurveyPayload.safeParse({ siteId: ANY }).success).toBe(false);
    expect(zCreateSiteSurveyPayload.safeParse({ workOrderId: V7, siteId: ANY, title: '' }).success).toBe(false);
    expect(zCreateSiteSurveyPayload.safeParse({ workOrderId: V7, siteId: ANY, requesterPhone: 'zadzwoń' }).success).toBe(false);
  });

  it('EVM-135 AC1 the command is a member of the batch of mutations, discriminated by its type', () => {
    const mutation = { mutationId: V7, type: 'CreateSiteSurvey', commandVersion: 1, payload: { workOrderId: V7, siteId: ANY } };
    expect(zSyncMutation.safeParse(mutation).success).toBe(true);
  });

  it('EVM-135 AC1 AC3 the result carries the number, the field errors and the code feature_disabled; quota_exceeded stays the code of the limit', () => {
    const parsed = zSyncMutationsResponse.safeParse({
      serverTime: '2026-11-16T08:00:00.000Z',
      results: [
        { mutationId: V7, outcome: 'applied', workOrderNumber: 'ZL-2026-0135' },
        { mutationId: V7, outcome: 'rejected', code: 'feature_disabled' },
        { mutationId: V7, outcome: 'rejected', code: 'quota_exceeded' },
        {
          mutationId: V7,
          outcome: 'rejected',
          code: 'validation_failed',
          errors: [{ pointer: '/requesterPhone', code: 'invalid_format' }],
        },
        { mutationId: V7, outcome: 'conflict', code: 'id_conflict' },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('EVM-135 AC2 the operation createSiteSurvey of the panel', () => {
  it('EVM-135 AC2 AC4 POST /api/v1/site-surveys for the Administrator and the Editor on the web channel, audited, implemented (not planned)', () => {
    expect(AUTHZ_MANIFEST['createSiteSurvey']).toMatchObject({
      method: 'post',
      path: '/api/v1/site-surveys',
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
    expect(AUTHZ_MANIFEST['createSiteSurvey']?.planned).toBeUndefined();
  });

  it('EVM-135 AC2 W8 the request is id, siteId, an optional title, requester phone and coordinator - no customer, no template, no description', () => {
    expect(Object.keys(zCreateSiteSurveyRequest.shape).sort()).toEqual(['assigneeUserId', 'id', 'requesterPhone', 'siteId', 'title']);
    expect(zCreateSiteSurveyRequest.safeParse({ id: V7, siteId: ANY }).success).toBe(true);
    expect(zCreateSiteSurveyRequest.safeParse({ id: V7 }).success).toBe(false);
    expect(zCreateSiteSurveyRequest.safeParse({ id: ANY, siteId: ANY }).success).toBe(false);
  });

  it('EVM-135 AC2 the answer 201 is the detail of the order (WorkOrderDetails with siteSurvey)', () => {
    expect(zCreateSiteSurveyResponse).toBe(zWorkOrderDetails);
  });
});

describe('EVM-135 AC2 the panel keeps its creation of an ordinary order', () => {
  it('EVM-135 AC2 CreateWorkOrderRequest is unchanged: the customer, the site and the template choice stay required', () => {
    expect(zCreateWorkOrderRequest.safeParse({ id: V7, siteId: ANY, templateId: null }).success).toBe(false);
    expect(zCreateWorkOrderRequest.safeParse({ id: V7, customerId: ANY, siteId: ANY, templateId: null }).success).toBe(true);
  });
});

describe('EVM-135 AC5 AC6 an order without a customer on the phone, in the detail and on the list', () => {
  it('EVM-135 AC5 SyncWorkOrder carries siteSurvey: the object of an open survey or null', () => {
    expect(zSyncWorkOrder.safeParse(syncOrder).success).toBe(true);
    expect(zSyncWorkOrder.safeParse({ ...syncOrder, siteSurvey: null, customerId: ANY }).success).toBe(true);
    expect(zSyncWorkOrder.safeParse({ ...syncOrder, siteSurvey: { ...SURVEY, requesterPhone: '600700800' } }).success).toBe(false);
  });

  it('EVM-135 AC5 the reader of the phone keeps siteSurvey, and a reader of version N-1 (the projection without the field) reads the change without an error', () => {
    const current = parseSyncChange({ op: 'upsert', type: 'work_order', id: V7, entity: syncOrder });
    expect(current).toMatchObject({ kind: 'upsert', entity: { siteSurvey: SURVEY } });
    const previous = zSyncWorkOrder.omit({ siteSurvey: true });
    const read = previous.safeParse(syncOrder);
    expect(read.success).toBe(true);
    expect(read.data).not.toHaveProperty('siteSurvey');
  });

  it('EVM-135 AC6 the detail and the list item have siteSurvey and customer null', () => {
    const details = {
      id: V7,
      number: 'ZL-2026-0135',
      title: 'Wizja lokalna',
      status: 'quoting',
      customer: null,
      site: null,
      coordinator: null,
      version: 1,
      createdAt: '2026-11-16T08:00:00.000Z',
      origin: 'office',
      allowedTransitions: [],
      siteSurvey: SURVEY,
    };
    expect(zWorkOrderDetails.safeParse(details).success).toBe(true);
    expect(zWorkOrderDetails.safeParse({ ...details, siteSurvey: undefined }).success).toBe(false);
    const item = {
      id: V7,
      number: 'ZL-2026-0135',
      title: 'Wizja lokalna',
      status: 'quoting',
      coordinator: null,
      createdAt: details.createdAt,
    };
    expect(zWorkOrderListItem.safeParse({ ...item, customer: null, site: null, siteSurvey: SURVEY }).success).toBe(true);
    expect(zWorkOrderListItem.safeParse({ ...item, siteSurvey: null }).success).toBe(true);
  });
});

describe('EVM-135 AC6 the filter and the sort of the list', () => {
  it('EVM-135 AC6 listWorkOrders takes siteSurvey=only|exclude and the sort by the deadline (which the server allows with only)', () => {
    expect(zListWorkOrdersQuery.safeParse({ siteSurvey: 'only', sort: 'siteSurveyExpiresAt' }).success).toBe(true);
    expect(zListWorkOrdersQuery.safeParse({ siteSurvey: 'exclude' }).success).toBe(true);
    expect(zListWorkOrdersQuery.safeParse({ siteSurvey: 'all' }).success).toBe(false);
    expect(AUTHZ_MANIFEST['listWorkOrders']?.query).toContain('siteSurvey');
  });
});

describe('EVM-135 AC3 the switch is readable by the app and the panel', () => {
  it('EVM-135 AC3 ClientConfig and CurrentSession carry features.siteSurveys', () => {
    expect(Object.keys(zClientConfig.shape)).toContain('features');
    expect(Object.keys(zCurrentSession.shape)).toContain('features');
    expect(zClientConfig.shape.features.safeParse({ siteSurveys: true }).success).toBe(true);
    expect(zCurrentSession.shape.features.safeParse({}).success).toBe(false);
  });
});

describe('EVM-135 AC7 the operations that wait for a customer answer 409 customer_required', () => {
  it('EVM-135 AC7 createPaymentMilestone, createDocument and createMediaExport name customer_required in their 409', async () => {
    const { readFile } = await import('node:fs/promises');
    const bundle = JSON.parse(await readFile(new URL('../dist/openapi.json', import.meta.url), 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, { $ref?: string; description?: string }> }>>;
      components: { responses: Record<string, { description: string }> };
    };
    const conflictOf = (operationId: string): string => {
      for (const item of Object.values(bundle.paths)) {
        for (const operation of Object.values(item)) {
          if (operation.operationId !== operationId) continue;
          const response = operation.responses?.['409'];
          const name = response?.$ref?.split('/').pop();
          return name === undefined ? (response?.description ?? '') : (bundle.components.responses[name]?.description ?? '');
        }
      }
      return '';
    };
    for (const operationId of ['createPaymentMilestone', 'createDocument', 'createMediaExport']) {
      expect(conflictOf(operationId), operationId).toContain('customer_required');
    }
  });
});
