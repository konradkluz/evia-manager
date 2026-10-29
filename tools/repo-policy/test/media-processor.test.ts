/**
 * The image processor as a sensitive, isolated workspace and container (EVM-068 AC5; ADR-0009; SR-FILE-06, SR-INPUT-04, SR-INFRA-11; TM-35, TM-36, TM-76).
 * The configuration of the container is reviewed here the way Compose and Trivy config see it in CI: no network, a read-only file system with tmpfs,
 * no capabilities, not root, limits, no port, a socket in a shared tmpfs, and no other service on that volume.
 */
import { describe, expect, it } from 'vitest';
import { exists, json, list, read, record, text, yaml } from '../src/files.ts';

const processor = record(record(record(yaml('infra/runtime/compose.media.yaml'))['services'])['media-processor']);
const staging = record(record(yaml('infra/runtime/compose.staging.yaml'))['services']);

describe('EVM-068 AC5: the container of the media processor', () => {
  it('EVM-068 AC5: no network, a read-only file system with tmpfs, cap_drop ALL, no-new-privileges, a non-root user, no published port', () => {
    expect(processor['network_mode']).toBe('none');
    expect('networks' in processor).toBe(false);
    expect('ports' in processor).toBe(false);
    expect('expose' in processor).toBe(false);
    expect(processor['read_only']).toBe(true);
    expect(list(processor['tmpfs']).map(text)).toEqual(['/tmp:size=64m,noexec,nosuid,nodev']);
    expect(list(processor['cap_drop'])).toEqual(['ALL']);
    expect('cap_add' in processor).toBe(false);
    expect(list(processor['security_opt'])).toEqual(['no-new-privileges:true']);
    expect(text(processor['user'])).toMatch(/^[1-9][0-9]{4}:[1-9][0-9]{4}$/);
    expect(processor['privileged']).toBeUndefined();
    expect(processor['init']).toBe(true);
    expect(processor['restart']).toBe('unless-stopped');
  });

  it('EVM-068 AC5 (SR-INFRA-11): limits of memory (1.5 GB), CPU and processes, and a health check', () => {
    expect(processor['mem_limit']).toBe('1536m');
    expect(processor['cpus']).toBe(2);
    expect(Number(processor['pids_limit'])).toBeGreaterThanOrEqual(16);
    expect(Number(processor['pids_limit'])).toBeLessThanOrEqual(256);
    expect(list(record(processor['healthcheck'])['test'])).toContain('src/healthcheck.ts');
  });

  it("EVM-068 AC5: the only volume is the work area shared with the worker (a tmpfs of the host), the group is the worker's, and the socket lies in it", () => {
    expect(list(processor['volumes']).map(text)).toEqual(['/run/evia/media-work:/run/media-work']);
    const environment = record(processor['environment']);
    expect(environment['MEDIA_PROCESSOR_SOCKET']).toBe('/run/media-work/processor.sock');
    expect(environment['MEDIA_PROCESSOR_WORKDIR']).toBe('/run/media-work');
    // the worker's gid is the group of the container: the files of a job are shared by the group, not by a world-writable directory
    const workerGid = text(record(staging['worker'])['user']).split(':')[1];
    expect(text(processor['user']).split(':')[1]).toBe(workerGid);
    expect(text(processor['user'])).not.toBe(text(record(staging['worker'])['user']));
    expect(Object.keys(environment).filter((name) => /SECRET|KEY|TOKEN|PASSWORD|DATABASE|S3/.test(name))).toEqual([]);
  });

  it('EVM-068 AC5: the worker mounts the same directory; the api (and any other service of the channel) does not', () => {
    const worker = record(staging['worker']);
    expect(list(worker['volumes']).map(text)).toContain('/run/evia/media-work:/run/media-work');
    expect(record(worker['environment'])['MEDIA_PROCESSOR_SOCKET']).toBe('/run/media-work/processor.sock');
    expect(record(worker['environment'])['MEDIA_PROCESSOR_WORKDIR']).toBe('/run/media-work');
    for (const [name, service] of Object.entries(staging).filter(([name]) => name !== 'worker')) {
      expect(list(record(service)['volumes']).map(text).join(' '), name).not.toContain('media-work');
      expect('MEDIA_PROCESSOR_SOCKET' in record(record(service)['environment']), name).toBe(false);
    }
    // the infrastructure file (clamd, postgres, caddy) and the processor file are different files: clamd never sees the photos of the work area
    expect(read('infra/runtime/compose.infra.yaml')).not.toContain('media-work');
  });

  it('EVM-068 AC5: the processor image is referenced by a digest (placeholder replaced at installation), never by a floating tag; the runbook requires a scan and an SBOM first', () => {
    const compose = read('infra/runtime/compose.media.yaml');
    expect(compose).toMatch(/image: evia-media-processor@sha256:[0-9a-f]{64}$/m);
    expect(compose).not.toMatch(/image: evia-media-processor:/);
    const runbook = read('docs/ops/runbooks/media-processor.md');
    expect(runbook).toContain('@sha256:');
    expect(runbook).toContain('--severity HIGH,CRITICAL');
    expect(runbook).toContain('CycloneDX');
  });

  it('EVM-068 AC5: the image — bases by digest, the exact pnpm, install scripts off, a distroless non-root runtime without a package manager', () => {
    const dockerfile = read('infra/images/media-processor/Dockerfile');
    const code = dockerfile.replace(/^\s*#.*$/gm, '');
    // the external bases (those with a tag); `FROM pnpm` is an earlier stage of this file
    for (const from of (code.match(/^FROM .*$/gm) ?? []).filter((line) => line.includes(':')))
      expect(from, from).toMatch(/@sha256:[0-9a-f]{64}/);
    expect(code).toContain('gcr.io/distroless/nodejs26-debian13:nonroot@sha256:');
    expect(code).toMatch(/^USER 65532:65532$/m);
    expect(code).toContain('--frozen-lockfile --ignore-scripts --prod');
    expect(code).toContain('--filter "@evia/media-processor..."');
    expect(code).not.toMatch(/\b(apt-get|apk|curl|wget)\b/);
    expect(code).not.toMatch(/ADD http|latest/);
    // the same digests as the image of the API (one base, one place for Renovate)
    const api = read('infra/images/api/Dockerfile');
    for (const digest of code.match(/sha256:[0-9a-f]{64}/g) ?? []) expect(api, digest).toContain(digest);
    expect(read('infra/images/media-processor/Dockerfile.dockerignore')).toMatch(/^\*$/m);
  });

  it('EVM-068 AC5: no interpolation in the file (the IaC session runs it with an empty environment)', () => {
    expect(read('infra/runtime/compose.media.yaml').replace(/^\s*#.*$/gm, '')).not.toContain('${');
  });
});

describe('EVM-068 AC5: the workspace is self-contained and the two sides of the protocol agree', () => {
  it('EVM-068 AC5 (architect 7): nothing imports the processor and it imports nothing of the repository; its manifest has only sharp as a dependency', () => {
    const config = read('.dependency-cruiser.cjs');
    expect(config).toContain("name: 'media-processor-self-contained'");
    expect(config).toContain("from: { path: '^services/media-processor/(src|test)/' }");
    expect(config).toContain("to: { path: '^(apps|packages|tools|services/(?!media-processor/))' }");
    expect(config).toContain("name: 'nothing-imports-media-processor'");
    const pkg = record(json('services/media-processor/package.json'));
    expect(Object.keys(record(pkg['dependencies']))).toEqual(['sharp']);
    expect(record(pkg['dependencies'])['sharp']).toBe('0.35.5');
    expect(read('.github/CODEOWNERS')).toContain('/services/media-processor/ @konradkluz');
    expect(read('pnpm-workspace.yaml')).toMatch(/^\s*sharp: false$/m);
    expect(text(record(record(json('package.json'))['scripts'])['gate:backend'])).toContain('--filter=./services/media-processor');
  });

  it('EVM-068 AC3: the numbers and names of the protocol are the same in the processor and in the adapter of the worker (the two share no code)', () => {
    const side = read('services/media-processor/src/protocol.ts');
    const worker = read('apps/api/src/platform/media-processing/image-processor.ts');
    const adapter = read('apps/api/src/platform/media-processing/unix-socket-image-processor.ts');
    expect(side).toContain('VARIANT_EDGES = { thumbnail: 320, preview: 1600 }');
    expect(worker).toContain('VARIANT_EDGES = { thumbnail: 320, preview: 1600 }');
    expect(side).toContain('MAX_RESPONSE_BYTES = 4096');
    expect(adapter).toContain('MAX_RESPONSE_BYTES = 4096');
    expect(side).toContain("CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']");
    expect(read('apps/api/src/modules/media/domain/file-rules.ts')).toContain("'image/heic'");
    expect(side).toContain("ERROR_CODES = ['pixel_limit', 'unsupported', 'timeout', 'internal']");
    expect(adapter).toContain(
      "REPORTED_CODES: readonly ImageProcessingErrorCode[] = ['pixel_limit', 'unsupported', 'timeout', 'internal']",
    );
    // the work area: `input` and `<variant>.webp`, and the timeouts: the job (60 s) is shorter than the wait of the worker (75 s)
    expect(side).toContain("INPUT_FILE = 'input'");
    expect(adapter).toContain("join(dir, 'input')");
    expect(side).toContain('JOB_TIMEOUT_MS = 60_000');
    expect(adapter).toContain('exchangeMs: 75_000');
    // the keys of the derivatives are those of the policy of the bucket
    expect(read('apps/api/src/modules/media/domain/derivatives.ts')).toContain("`${match[1] ?? ''}${variant}.webp`");
    expect(read('infra/tofu/modules/object-storage/main.tf')).toContain('derivative_object_names = ["thumbnail.webp", "preview.webp"]');
  });

  it('EVM-068 AC5: the runbook of the processor exists and names the IaC steps', () => {
    expect(exists('docs/ops/runbooks/media-processor.md')).toBe(true);
    const runbook = read('docs/ops/runbooks/media-processor.md');
    for (const phrase of ['compose.media.yaml', '/run/evia/media-work', 'tofu apply', 'bucket-verify', 'HEIC'])
      expect(runbook, phrase).toContain(phrase);
  });
});
