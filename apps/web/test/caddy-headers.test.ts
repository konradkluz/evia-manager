import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { panelSecurityHeaders, parseMediaOrigin } from '../security-headers.ts';

/** The internal Caddyfile of the release image evia-web (EVM-007 AC2, AC6) — read as text (cwd = apps/web), never imported. */
const caddyfile = readFileSync('../../infra/images/web/Caddyfile', 'utf8');

/** The bucket origin of staging, as in compose.staging.yaml (RR-48). */
const BUCKET = 'https://evia-staging-media.s3.pl-waw.scw.cloud';
const composeStaging = readFileSync('../../infra/runtime/compose.staging.yaml', 'utf8');

/** Caddy replaces `{$NAME:}` with the environment value (empty when unset) when it loads the file. */
const withBucketOrigin = (text: string, origin: string) => text.replaceAll('{$MEDIA_BUCKET_ORIGIN:}', origin);

/** The headers of the first `header { … }` block of the site: `Name "value"` per line, `-Name` removes a header. */
function caddyHeaders(text: string): { set: Record<string, string>; removed: string[] } {
  const block = /header \{\n([\s\S]*?)\n\t\}/.exec(text)?.[1] ?? '';
  const set: Record<string, string> = {};
  const removed: string[] = [];
  for (const line of block.split('\n').map((entry) => entry.trim())) {
    if (line.startsWith('-')) removed.push(line.slice(1));
    const match = /^([\w-]+) "(.*)"$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) set[match[1]] = match[2];
  }
  return { set, removed };
}

describe('release image evia-web serves the headers of the panel (EVM-007 AC2, AC6; SR-WEB-01, SR-WEB-08, SR-INFRA-06)', () => {
  it('EVM-007 AC6: the internal Caddy sets exactly the strict HTTPS headers of security-headers.ts and removes Server', () => {
    const { set, removed } = caddyHeaders(withBucketOrigin(caddyfile, ''));
    // an empty variable leaves a space before the semicolon, which a CSP parser ignores
    expect({ ...set, 'Content-Security-Policy': set['Content-Security-Policy']?.replace(' ;', ';') }).toEqual(
      panelSecurityHeaders({ variant: 'strict', https: true }),
    );
    expect(removed).toEqual(['Server']);
  });

  it('EVM-044 AC6 (RR-48): with MEDIA_BUCKET_ORIGIN connect-src is exactly the headers of the panel with that one origin', () => {
    const { set } = caddyHeaders(withBucketOrigin(caddyfile, BUCKET));
    expect(set).toEqual(panelSecurityHeaders({ variant: 'strict', https: true, mediaOrigin: BUCKET }));
  });

  it('EVM-044 AC6 (RR-48): the web service of staging passes exactly one valid https origin of the media bucket, the same host as the bucket of the IaC', () => {
    const value = /^\s+MEDIA_BUCKET_ORIGIN: (\S+)$/m.exec(composeStaging.slice(composeStaging.indexOf('\n  web:')))?.[1];
    expect(parseMediaOrigin(value)).toBe(BUCKET);
    expect(composeStaging.match(/MEDIA_BUCKET_ORIGIN:/g)).toHaveLength(1);
  });

  it('EVM-007 AC6: no admin API, no TLS inside the image, the SPA fallback to index.html', () => {
    expect(caddyfile).toMatch(/^\tadmin off$/m);
    expect(caddyfile).toMatch(/^\tauto_https off$/m);
    expect(caddyfile).toContain('try_files {path} /index.html');
    expect(caddyfile).toMatch(/^:8080 \{$/m);
  });

  it('EVM-007 AC6: the parser of this test reads set and removed headers', () => {
    expect(caddyHeaders('x {\n\theader {\n\t\t-Server\n\t\tA "b"\n\t}\n}')).toEqual({ set: { A: 'b' }, removed: ['Server'] });
    expect(caddyHeaders('')).toEqual({ set: {}, removed: [] });
  });
});
