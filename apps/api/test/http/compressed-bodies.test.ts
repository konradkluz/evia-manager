/**
 * EVM-119 (RR-39): the API never decodes a compressed request body. Real compressed payloads (synthetic data) are sent
 * to a public and to a protected operation; the answer is 415 in the standard error format, without the decoder's words.
 */
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { zProblem } from '@evia/contracts/zod';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_RESOLVER } from '../../src/platform/http/principal.ts';
import { DATABASE_PROBE } from '../../src/platform/tokens.ts';
import { createTestApp, PANEL_ORIGIN, type TestApp } from '../support/app.ts';
import { principal, resolverOf } from '../support/principals.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const PUBLIC_PATH = '/api/v1/auth/activation/check';
const PROTECTED_PATH = '/api/v1/test-widgets';
const TOKEN = 'A'.repeat(43);
const MARKER = 'synthetic-marker-4f1c9d';

const plain = (padding = 'x'): Buffer => Buffer.from(JSON.stringify({ token: TOKEN, padding, marker: MARKER }));
const ENCODERS: ReadonlyArray<readonly [string, (data: Buffer) => Buffer]> = [
  ['br', (data) => brotliCompressSync(data)],
  ['gzip', (data) => gzipSync(data)],
  ['deflate', (data) => deflateSync(data)],
];

const publicApp = async () => {
  current = await createTestApp();
  return request(current.app.getHttpServer());
};
const signedInApp = async () => {
  current = await createTestApp({
    configure: (builder) =>
      builder
        .overrideProvider(SESSION_RESOLVER)
        .useValue(resolverOf({ principal: principal() }))
        .overrideProvider(DATABASE_PROBE)
        .useValue({ ping: () => Promise.resolve() }),
  });
  return request(current.app.getHttpServer());
};

type Server = ReturnType<typeof request>;
const post = (server: Server, path: string, encoding: string | undefined, body: Buffer) => {
  const test = server.post(path).set('Origin', PANEL_ORIGIN).set('Sec-Fetch-Site', 'same-origin').set('Content-Type', 'application/json');
  return (encoding === undefined ? test : test.set('Content-Encoding', encoding)).send(body);
};

describe('compressed request bodies are refused (EVM-119; RR-39)', () => {
  it('EVM-119 AC1 br, gzip and deflate are 415 in the problem format on a public operation, without decoding', async () => {
    const server = await publicApp();
    for (const [encoding, encode] of ENCODERS) {
      const response = await post(server, PUBLIC_PATH, encoding, encode(plain()));
      expect(response.status, encoding).toBe(415);
      expect(response.headers['content-type'], encoding).toMatch(/^application\/problem\+json/);
      expect(zProblem.safeParse(response.body).success, encoding).toBe(true);
      expect(response.body, encoding).toMatchObject({ status: 415, code: 'unsupported_media_type' });
    }
  });

  it('EVM-119 AC1 br, gzip and deflate are 415 on a protected operation with a session', async () => {
    const server = await signedInApp();
    for (const [encoding, encode] of ENCODERS) {
      const response = await post(server, PROTECTED_PATH, encoding, encode(plain()));
      expect(response.status, encoding).toBe(415);
      expect(response.body, encoding).toMatchObject({ status: 415, code: 'unsupported_media_type' });
    }
  });

  it('EVM-119 AC1 the name is case-insensitive and a list or an unknown coding is refused too', async () => {
    const server = await publicApp();
    for (const encoding of ['GZIP', 'Br', 'gzip, br', 'identity, gzip', 'gzip,identity', 'zstd', 'compress', 'x-gzip']) {
      const response = await post(server, PUBLIC_PATH, encoding, gzipSync(plain()));
      expect(response.status, encoding).toBe(415);
      expect(response.body, encoding).toMatchObject({ code: 'unsupported_media_type' });
    }
  });

  it('EVM-119 AC2 no Content-Encoding, identity and IDENTITY are answered as before (the body reaches validation)', async () => {
    const server = await publicApp();
    for (const encoding of [undefined, 'identity', 'IDENTITY']) {
      const response = await post(server, PUBLIC_PATH, encoding, plain());
      expect(response.status, String(encoding)).toBe(400);
      expect(response.body, String(encoding)).toMatchObject({ code: 'validation_failed' });
    }
    const signedIn = await signedInApp();
    for (const encoding of [undefined, 'identity']) {
      const response = await post(signedIn, PROTECTED_PATH, encoding, plain());
      expect(response.status, String(encoding)).not.toBe(415);
    }
  });

  it('EVM-119 AC4 an oversized compressed body is 415 (not 413) with no body, decoder detail or log of the body', async () => {
    const server = await publicApp();
    const big = plain('y'.repeat(200_000));
    for (const [encoding, encode] of ENCODERS) {
      const response = await post(server, PUBLIC_PATH, encoding, encode(big));
      expect(response.status, encoding).toBe(415);
      expect(response.text, encoding).not.toMatch(/synthetic-marker|brotli|zlib|gunzip|inflate|incorrect header|content encoding/i);
    }
    const signedIn = await signedInApp();
    const huge = gzipSync(plain('z'.repeat(3_000_000)));
    const response = await post(signedIn, PROTECTED_PATH, 'gzip', huge);
    expect(response.status).toBe(415);
    expect(response.text).not.toContain(MARKER);
    expect(current?.logs.text ?? '').not.toContain(MARKER);
  });

  it('EVM-119 AC4 an oversized body without compression keeps the answer 413 (the limits are unchanged)', async () => {
    const server = await publicApp();
    const response = await post(server, PUBLIC_PATH, undefined, plain('x'.repeat(9000)));
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ code: 'payload_too_large' });
  });
});
