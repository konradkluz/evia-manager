import type { CurrentSession, Document as OrderDocument, DocumentKind } from '@evia/contracts';
import { json, parseBody, problem, type Handler, type Recorded } from './api-fake.ts';
import { BUCKET_URL, DOCUMENTS_BASE, KINDS_ROUTE, mediaApi } from './media-api.ts';
import { stageName } from './stages-api.ts';
import { HEADER, ORDER_ID } from './work-order-api.ts';

export const SITE_ID = HEADER.site?.id ?? '';
export const CUSTOMER_ID = HEADER.customer?.id ?? '';

export { DOCUMENTS_BASE };

/** Synthetic documents of the order ZL-2026-0042 (EVM-047): a stateful fake of the documents API. */
export const KINDS: readonly DocumentKind[] = [
  { code: 'connection_conditions', name: 'Warunki przyłączenia', confidentiality: 'standard' },
  { code: 'power_of_attorney', name: 'Pełnomocnictwo', confidentiality: 'identity_data' },
  { code: 'installation_design', name: 'Projekt instalacji', confidentiality: 'building_security' },
  { code: 'other', name: 'Inny dokument', confidentiality: 'standard' },
];

export function doc(n: number, extra: Partial<OrderDocument> = {}): OrderDocument {
  return {
    id: `01968f3e-0000-7000-8000-00000e${String(n).padStart(6, '0')}`,
    anchor: 'work_order',
    workOrderId: ORDER_ID,
    siteId: null,
    customerId: null,
    kindCode: 'connection_conditions',
    kindName: 'Warunki przyłączenia',
    title: `Dokument ${String(n)}`,
    description: null,
    procedureStageId: null,
    procedureStageName: null,
    versionNumber: 1,
    confidentiality: 'standard',
    confidentialityRaised: false,
    fileState: 'clean',
    stateReasonCode: null,
    declaredSize: 1000,
    originalFilename: `plik-${String(n)}.pdf`,
    canDownload: true,
    createdAt: '2026-10-11T11:55:00.000Z',
    version: 1,
    ...extra,
  };
}

export interface DocumentsServerOptions {
  readonly documents?: readonly OrderDocument[];
  readonly kinds?: readonly DocumentKind[];
  readonly session?: CurrentSession;
  readonly partCount?: number;
  readonly list?: Handler;
  readonly create?: Handler;
  readonly raise?: Handler;
  /** `DELETE …/documents/{id}` (EVM-051); the default answers `204`. */
  readonly remove?: Handler;
  readonly download?: Handler;
  readonly complete?: Handler;
  readonly stateAfterComplete?: OrderDocument['fileState'];
  /** EVM-050: extra routes (the lists and the downloads of the site and of the customer). */
  readonly routes?: Record<string, Handler>;
}

/** Created documents appear in the list in `pending_upload`, then in `stateAfterComplete` after `complete`. */
export function documentsApi(options: DocumentsServerOptions = {}) {
  const created: OrderDocument[] = [];
  const completed = new Set<string>();
  const edited = new Map<string, OrderDocument>();
  const all = () => [
    ...created.map((entry) => (completed.has(entry.id) ? { ...entry, fileState: options.stateAfterComplete ?? 'clean' } : entry)),
    ...(options.documents ?? []).map((entry) => edited.get(entry.id) ?? entry),
  ];
  const list: Handler =
    options.list ??
    (() => {
      const items = all();
      return json(200, { items, nextCursor: null, totalCount: items.length });
    });
  const create: Handler =
    options.create ??
    ((request) => {
      const body = parseBody(request.body) as {
        id: string;
        kindCode: string;
        title: string;
        description?: string;
        anchor?: OrderDocument['anchor'];
        procedureStageId?: string;
        containsIdentityData?: boolean;
        confidentialityOverride?: OrderDocument['confidentiality'];
        file: { fileName: string; declaredSize: number };
      };
      const kind = (options.kinds ?? KINDS).find((entry) => entry.code === body.kindCode);
      const effective =
        body.containsIdentityData === true ? 'identity_data' : (body.confidentialityOverride ?? kind?.confidentiality ?? 'standard');
      const made = doc(600 + created.length, {
        id: body.id,
        ...(body.anchor === 'site' ? { anchor: 'site' as const, workOrderId: null, siteId: SITE_ID } : {}),
        ...(body.anchor === 'customer' ? { anchor: 'customer' as const, workOrderId: null, customerId: CUSTOMER_ID } : {}),
        kindCode: body.kindCode,
        kindName: kind?.name ?? body.kindCode,
        title: body.title,
        description: body.description ?? null,
        procedureStageId: body.procedureStageId ?? null,
        procedureStageName: stageName(body.procedureStageId),
        confidentiality: effective,
        confidentialityRaised: effective !== kind?.confidentiality,
        fileState: 'pending_upload',
        originalFilename: body.file.fileName,
        declaredSize: body.file.declaredSize,
      });
      created.push(made);
      return json(201, made);
    });
  const api = mediaApi({
    ...(options.session === undefined ? {} : { session: options.session }),
    routes: {
      [`GET ${DOCUMENTS_BASE}`]: list,
      [`POST ${DOCUMENTS_BASE}`]: create,
      [KINDS_ROUTE]: () => json(200, { items: options.kinds ?? KINDS, nextCursor: null }),
      ...options.routes,
    },
  });
  const dynamic = new Map<RegExp, Handler>([
    [
      /\/upload-sessions$/,
      (request) => {
        const body = parseBody(request.body) as { id: string };
        return json(201, {
          id: body.id,
          documentId: request.path.split('/').at(-2),
          state: 'active',
          partSize: 16_777_216,
          partCount: options.partCount ?? 1,
          expiresAt: '2026-10-18T11:55:00.000Z',
        });
      },
    ],
    [/\/upload-sessions\/[^/]+\/parts$/, () => json(200, { items: [] })],
    [
      /\/parts\/\d+\/url$/,
      () => json(200, { url: `${BUCKET_URL}?X-Amz-Signature=sig`, expiresAt: '2026-10-11T13:00:00.000Z', contentLength: 1 }),
    ],
    [
      /\/upload-sessions\/[^/]+\/complete$/,
      options.complete ??
        ((request) => {
          const id = request.path.split('/')[6] ?? '';
          completed.add(id);
          return json(200, { ...(created.find((entry) => entry.id === id) ?? doc(0, { id })), fileState: 'uploaded' });
        }),
    ],
    [
      /\/download-url$/,
      options.download ??
        (() =>
          json(200, {
            url: 'https://bucket.example.test/documents/2026/10/file/original?X-Amz-Signature=sig',
            expiresAt: '2026-10-11T12:05:00.000Z',
          })),
    ],
    [
      /\/documents\/[^/]+$/,
      (request) => {
        if (request.method === 'DELETE') return (options.remove ?? (() => new Response(null, { status: 204 })))(request);
        return (
          options.raise ??
          ((raised) => {
            const body0 = raised;
            const body = parseBody(body0.body) as Partial<OrderDocument> & { confidentialityOverride?: OrderDocument['confidentiality'] };
            const id = body0.path.split('/').at(-1) ?? '';
            const found = edited.get(id) ?? (options.documents ?? []).find((entry) => entry.id === id) ?? doc(0, { id });
            const { confidentialityOverride, ...fields } = body;
            const next: OrderDocument = {
              ...found,
              ...fields,
              ...(confidentialityOverride === undefined ? {} : { confidentiality: confidentialityOverride, confidentialityRaised: true }),
              procedureStageName: 'procedureStageId' in body ? stageName(body.procedureStageId) : found.procedureStageName,
              version: found.version + 1,
            };
            edited.set(id, next);
            return json(200, next, { ETag: `"${String(next.version)}"` });
          })
        )(request);
      },
    ],
  ]);
  const base = api.fetch;
  const routed = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.startsWith(`${DOCUMENTS_BASE}/`)) {
      for (const [pattern, handler] of dynamic) {
        if (!pattern.test(path)) continue;
        const recorded: Recorded = {
          method: request.method,
          path,
          query: new URL(request.url).searchParams,
          headers: request.headers,
          body: await request.clone().text(),
        };
        api.requests.push(recorded);
        return handler(recorded);
      }
    }
    return base(input, init);
  }) as typeof fetch;
  return { ...api, fetch: routed, created, completed };
}

export { json, problem };
