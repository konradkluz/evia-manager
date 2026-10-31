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

  it('EVM-068 AC5 (SR-INFRA-11): limits of memory (2 GB: ffmpeg decodes H.265 of a film, EVM-046), CPU and processes, and a health check', () => {
    expect(processor['mem_limit']).toBe('2048m');
    expect(processor['cpus']).toBe(2);
    expect(Number(processor['pids_limit'])).toBeGreaterThanOrEqual(16);
    expect(Number(processor['pids_limit'])).toBeLessThanOrEqual(256);
    expect(list(record(processor['healthcheck'])['test'])).toContain('src/healthcheck.ts');
  });

  it("EVM-068 AC5: the only volume is the work area shared with the worker (a tmpfs of the host), the group is the worker's, and the socket lies in it", () => {
    // photos: the tmpfs of the host; films (EVM-046): a separate DISK volume of the host - the departure from P3 is recorded in media-pipeline.md
    expect(list(processor['volumes']).map(text)).toEqual([
      '/run/evia/media-work:/run/media-work',
      '/var/lib/evia/media-video:/var/lib/media-video',
    ]);
    const environment = record(processor['environment']);
    expect(environment['MEDIA_PROCESSOR_SOCKET']).toBe('/run/media-work/processor.sock');
    expect(environment['MEDIA_PROCESSOR_WORKDIR']).toBe('/run/media-work');
    expect(environment['MEDIA_PROCESSOR_VIDEO_WORKDIR']).toBe('/var/lib/media-video');
    // the worker's gid is the group of the container: the files of a job are shared by the group, not by a world-writable directory
    const workerGid = text(record(staging['worker'])['user']).split(':')[1];
    expect(text(processor['user']).split(':')[1]).toBe(workerGid);
    expect(text(processor['user'])).not.toBe(text(record(staging['worker'])['user']));
    expect(Object.keys(environment).filter((name) => /SECRET|KEY|TOKEN|PASSWORD|DATABASE|S3/.test(name))).toEqual([]);
  });

  it('EVM-068 AC5: the worker mounts the same directory; the api (and any other service of the channel) does not', () => {
    const worker = record(staging['worker']);
    expect(list(worker['volumes']).map(text)).toContain('/run/evia/media-work:/run/media-work');
    expect(list(worker['volumes']).map(text)).toContain('/var/lib/evia/media-video:/var/lib/media-video');
    expect(record(worker['environment'])['MEDIA_PROCESSOR_VIDEO_WORKDIR']).toBe('/var/lib/media-video');
    expect(record(worker['environment'])['MEDIA_PROCESSOR_SOCKET']).toBe('/run/media-work/processor.sock');
    expect(record(worker['environment'])['MEDIA_PROCESSOR_WORKDIR']).toBe('/run/media-work');
    for (const [name, service] of Object.entries(staging).filter(([name]) => name !== 'worker')) {
      expect(list(record(service)['volumes']).map(text).join(' '), name).not.toContain('media-work');
      expect(list(record(service)['volumes']).map(text).join(' '), name).not.toContain('media-video');
      expect('MEDIA_PROCESSOR_SOCKET' in record(record(service)['environment']), name).toBe(false);
    }
    // the infrastructure file (clamd, postgres, caddy) and the processor file are different files: clamd never sees the photos of the work area
    expect(read('infra/runtime/compose.infra.yaml')).not.toContain('media-work');
    expect(read('infra/runtime/compose.infra.yaml')).not.toContain('media-video');
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

  it('EVM-068 AC5 EVM-046: the image — bases by digest, the exact pnpm, install scripts off, a non-root runtime whose only added package is ffmpeg at a pinned version', () => {
    const dockerfile = read('infra/images/media-processor/Dockerfile');
    const code = dockerfile.replace(/^\s*#.*$/gm, '');
    // the external bases (those with a tag); `FROM pnpm` is an earlier stage of this file
    for (const from of (code.match(/^FROM .*$/gm) ?? []).filter((line) => line.includes(':')))
      expect(from, from).toMatch(/@sha256:[0-9a-f]{64}/);
    // EVM-046: ffprobe and ffmpeg need a runtime with libraries (Debian slim, the same digest as the API); the exact version of the package is required at build time
    expect(code).toMatch(/^FROM node:26.10.0-trixie-slim@sha256:[0-9a-f]{64} AS runtime$/m);
    expect(code).toContain('ARG FFMPEG_VERSION');
    expect(code).toContain('test -n "${FFMPEG_VERSION}"');
    expect(code).toContain('apt-get install -y --no-install-recommends "ffmpeg=${FFMPEG_VERSION}"');
    // a literal backslash-n (a typo for a line continuation) would break the build; the RUN must be real continued lines
    expect(code).not.toContain(String.raw`\n`);
    expect(code).toMatch(
      /test -n "\$\{FFMPEG_VERSION\}" \\\r?\n\s+&& apt-get update \\\r?\n\s+&& apt-get install[^\n]*\\\r?\n\s+&& rm -rf \/var\/lib\/apt\/lists\/\* \\\r?\n\s+&& ffmpeg -version/,
    );
    expect(code).toContain('ENTRYPOINT ["/usr/local/bin/node"]');
    expect(code).toMatch(/^USER 65532:65532$/m);
    expect(code).toContain('--frozen-lockfile --ignore-scripts --prod');
    expect(code).toContain('--filter "@evia/media-processor..."');
    // the only use of the package manager is the one pinned ffmpeg (EVM-046)
    expect(code.match(/apt-get install/g)).toHaveLength(1);
    expect(code).not.toMatch(/\b(apk|curl|wget)\b/);
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
    expect(read('apps/api/src/modules/media/domain/derivatives.ts')).toContain("${videoPreview(variant, mediaType) ? 'mp4' : 'webp'}");
    expect(read('infra/tofu/modules/object-storage/main.tf')).toContain(
      'derivative_object_names = ["thumbnail.webp", "preview.webp", "preview.mp4"]',
    );
  });

  it('EVM-068 AC5: the runbook of the processor exists and names the IaC steps', () => {
    expect(exists('docs/ops/runbooks/media-processor.md')).toBe(true);
    const runbook = read('docs/ops/runbooks/media-processor.md');
    for (const phrase of ['compose.media.yaml', '/run/evia/media-work', 'tofu apply', 'bucket-verify', 'HEIC'])
      expect(runbook, phrase).toContain(phrase);
  });
});

describe('EVM-046: the two sides of the video protocol agree', () => {
  it('EVM-046 AC2 AC5: the limits, the codes, the steps and the file names are the same in the processor and in the adapter of the worker (the two share no code)', () => {
    const side = read('services/media-processor/src/video-protocol.ts');
    const port = read('apps/api/src/platform/media-processing/video-processor.ts');
    const adapter = read('apps/api/src/platform/media-processing/unix-socket-video-processor.ts');
    expect(side).toContain("VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime']");
    expect(side).toContain("VIDEO_ERROR_CODES = ['unsupported', 'too_long', 'timeout', 'internal', 'invalid_output']");
    expect(adapter).toContain(
      "REPORTED_CODES: readonly VideoProcessingErrorCode[] = ['unsupported', 'too_long', 'timeout', 'internal', 'invalid_output']",
    );
    expect(side).toContain('MAX_VIDEO_SECONDS = 1800');
    expect(adapter).toContain('durationSeconds > 1800');
    expect(adapter).toContain('MAX_RESPONSE_BYTES = 4096');
    expect(side).toContain('MAX_PREVIEW_BYTES = 1_073_741_824');
    expect(port).toContain('MAX_VIDEO_PREVIEW_BYTES = 1_073_741_824');
    expect(side).toContain('PREVIEW_BOX = { width: 1280, height: 720 }');
    expect(port).toContain('PREVIEW_LIMIT = { width: 1280, height: 720 }');
    expect(side).toContain("VIDEO_PREVIEW_FILE = 'preview.mp4'");
    expect(adapter).toContain("'preview.mp4'");
    expect(side).toContain("VIDEO_FRAME_FILE = 'thumbnail.webp'");
    expect(adapter).toContain("'thumbnail.webp'");
    // the order of the times: ffmpeg killed after 15 min < the wait of the worker (16 min) < the stale period of a take (20 min)
    expect(side).toContain('TRANSCODE_TIMEOUT_MS = 15 * 60_000');
    expect(adapter).toContain('transcodeMs: 16 * 60_000');
    expect(read('apps/api/src/modules/media/domain/derivatives.ts')).toContain('STALE_VIDEO_PROCESSING_MS = 20 * 60_000');
  });

  it('EVM-046 AC3: clamd limits are at least the scan limit of the API and the runbooks name the work area of films', () => {
    expect(read('apps/api/src/modules/media/domain/video-rules.ts')).toContain('SCAN_LIMIT_BYTES = 2_000_000_000');
    // 2000M = 2 097 152 000 B > 2 000 000 000 B and < 2^31
    const limit = 2000 * 1024 * 1024;
    expect(limit).toBeGreaterThan(2_000_000_000);
    expect(limit).toBeLessThan(2 ** 31);
    const runbook = read('docs/ops/runbooks/media-processor.md');
    for (const phrase of ['/var/lib/evia/media-video', 'noexec', 'FFMPEG_VERSION']) expect(runbook, phrase).toContain(phrase);
  });
});
