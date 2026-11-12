// @ts-check
/**
 * evia-work-volumes.sh in a Linux container with stand-ins for the disk tools (EVM-084; decision of Konrad 2026-11-12, RR-75/RR-76: the work volumes of the films and
 * of the scan are encrypted with dm-crypt under an EPHEMERAL key). Run: docker compose -f compose.yaml run --rm deploy-sh-tests. The stand-ins log every call; the
 * state (partition table, mappings, mounts) lives in files of the temporary root, so a reboot is "delete the mappings and the mounts".
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../tofu/modules/vm/templates/evia-work-volumes.sh', import.meta.url).pathname;
const DEVICE = '/dev/disk/by-id/scsi-0HC_Volume_123456';

/** One stand-in script per tool: it logs "tool args" and keeps the state in $STATE. */
const TOOLS = {
  sfdisk: `#!/bin/bash
echo "sfdisk $*" >> "$FAKE_LOG"
if [ "$1" = "-d" ]; then
  case "$(cat "$STATE/pt" 2> /dev/null || echo none)" in
    none) exit 1 ;;
    two) printf 'label: gpt\\n/dev/x1 : start=2048, size=1\\n/dev/x2 : start=9999, size=1\\n' ;;
    *) printf 'label: gpt\\n/dev/x1 : a\\n/dev/x2 : b\\n/dev/x3 : c\\n' ;;
  esac
  exit 0
fi
cat > "$STATE/sfdisk.stdin"
echo two > "$STATE/pt"
`,
  blkid: `#!/bin/bash
echo "blkid $*" >> "$FAKE_LOG"
[ -e "$STATE/signature" ]
`,
  udevadm: `#!/bin/bash
echo "udevadm $*" >> "$FAKE_LOG"
`,
  cryptsetup: `#!/bin/bash
echo "cryptsetup $*" >> "$FAKE_LOG"
case "$1" in
  open) mkdir -p "$EVIA_ROOT/dev/mapper"; : > "$EVIA_ROOT/dev/mapper/\${@: -1}" ;;
  close) rm -f "$EVIA_ROOT/dev/mapper/$2" ;;
esac
`,
  'mkfs.ext4': `#!/bin/bash
echo "mkfs.ext4 $*" >> "$FAKE_LOG"
`,
  chattr: `#!/bin/bash
echo "chattr $*" >> "$FAKE_LOG"
`,
  chown: `#!/bin/bash
echo "chown $*" >> "$FAKE_LOG"
`,
  mount: `#!/bin/bash
echo "mount $*" >> "$FAKE_LOG"
echo "\${@: -1}" >> "$STATE/mounts"
`,
  mountpoint: `#!/bin/bash
grep -qx "\${@: -1}" "$STATE/mounts" 2> /dev/null
`,
};

/** @type {string} */ let root;
/** @type {string} */ let state;
/** @type {string} */ let log;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'work-volumes-'));
  state = join(root, 'state');
  log = join(root, 'calls.log');
  mkdirSync(join(root, 'bin'));
  mkdirSync(state);
  mkdirSync(join(root, 'dev/disk/by-id'), { recursive: true });
  for (const suffix of ['', '-part1', '-part2']) writeFileSync(join(root, DEVICE + suffix), '');
  writeFileSync(log, '');
  for (const [name, body] of Object.entries(TOOLS)) {
    writeFileSync(join(root, 'bin', name), body, { mode: 0o755 });
    chmodSync(join(root, 'bin', name), 0o755);
  }
});

const run = (/** @type {Record<string, string>} */ env = {}) =>
  spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
      EVIA_ROOT: root,
      EVIA_WORK_DEVICE: DEVICE,
      EVIA_WORK_WAIT: '0',
      FAKE_LOG: log,
      STATE: state,
      ...env,
    },
  });
const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
const at = (/** @type {string} */ part, /** @type {number} */ from = 0) =>
  calls().findIndex((line, index) => index >= from && line.includes(part));
const reboot = () => {
  rmSync(join(state, 'mounts'), { force: true });
  rmSync(join(root, 'dev/mapper'), { recursive: true, force: true });
  writeFileSync(log, '');
};

describe('EVM-084 evia-work-volumes.sh: encrypted work volumes with an ephemeral key', () => {
  it('EVM-084: a blank volume gets two partitions, two plain dm-crypt mappings with a key from /dev/urandom, a fresh file system and a mount with noexec,nosuid,nodev', () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const partition = readFileSync(join(state, 'sfdisk.stdin'), 'utf8');
    assert.match(partition, /^label: gpt$/mu);
    assert.match(partition, /^,15360MiB$/mu);
    assert.match(partition, /^,$/mu);
    for (const [name, part, mount] of [
      ['evia-media-video', 'part1', 'var/lib/evia/media-video'],
      ['evia-clamav-scan', 'part2', 'var/lib/evia/clamav-scan'],
    ]) {
      const open = calls().find((line) => line.startsWith('cryptsetup open') && line.includes(`-${part} ${name}`));
      assert.ok(open, `${name} is opened`);
      assert.match(open, /--type plain/u);
      assert.match(open, /--cipher aes-xts-plain64/u);
      assert.match(open, /--key-size 512/u);
      assert.match(open, /--hash plain/u);
      assert.match(open, /--key-file \/dev\/urandom/u);
      const mkfs = at(`mkfs.ext4 -q -F -L ${name} `);
      const mountCall = at(`mount -o nodev,nosuid,noexec `);
      assert.ok(mkfs > at(open), `${name}: the file system after the mapping`);
      assert.ok(at(`${name} ${join(root, mount)}`) > mkfs, `${name}: mounted after mkfs`);
      assert.ok(mountCall >= 0);
      assert.ok(existsSync(join(root, mount)));
    }
    // the order: partitions, then every mapping, then the mounts
    assert.ok(at('sfdisk --quiet') < at('cryptsetup open'));
    // immutable mount points: nothing can be written there while no volume is mounted (a quiet fall back to the root disk)
    assert.ok(at('chattr +i') >= 0 && at('chattr +i') < at('mount -o'));
    assert.ok(calls().some((line) => line.startsWith('chown 10005:10002 ') && line.includes('media-video')));
    assert.ok(calls().some((line) => line.includes('clamav-scan') && line.startsWith('chown ')));
  });

  it('EVM-084: the key lives in RAM only — no key file is written anywhere, no LUKS header, no persistent entry in crypttab or fstab', () => {
    assert.equal(run().status, 0);
    const text = calls().join('\n');
    assert.doesNotMatch(text, /luksFormat|luksOpen|--type luks|\/etc\/evia\/secrets|crypttab|fstab/u);
    for (const line of calls().filter((entry) => entry.startsWith('cryptsetup open'))) {
      const keyFiles = [...line.matchAll(/--key-file (\S+)/gu)].map((match) => match[1]);
      assert.deepEqual(keyFiles, ['/dev/urandom']);
    }
    assert.deepEqual(readdirSync(join(root, 'dev/mapper')).sort(), ['evia-clamav-scan', 'evia-media-video']);
    assert.ok(!existsSync(join(root, 'etc')), 'nothing is written to /etc');
  });

  it('EVM-084: a second run while the volumes are mounted keeps them (no new key, no mkfs, no data lost)', () => {
    assert.equal(run().status, 0);
    writeFileSync(log, '');
    assert.equal(run().status, 0);
    assert.doesNotMatch(calls().join('\n'), /cryptsetup open|mkfs|sfdisk --quiet|mount -o/u);
  });

  it('EVM-084: after a restart (the mappings and the mounts are gone) the volumes are formatted anew with a new key; the partition table stays', () => {
    assert.equal(run().status, 0);
    reboot();
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(calls().filter((line) => line.startsWith('cryptsetup open')).length, 2);
    assert.equal(calls().filter((line) => line.startsWith('mkfs.ext4')).length, 2);
    assert.ok(!calls().some((line) => line.startsWith('sfdisk --quiet')), 'the partitions are not created again');
  });

  it('EVM-084: a mapping that is open but not mounted is closed and opened again with a new key', () => {
    assert.equal(run().status, 0);
    rmSync(join(state, 'mounts'));
    writeFileSync(log, '');
    assert.equal(run().status, 0);
    assert.ok(at('cryptsetup close evia-media-video') >= 0 && at('cryptsetup close evia-media-video') < at('cryptsetup open'));
  });

  it('EVM-084: a volume with a file system but without a partition table, or with another layout, is refused and never formatted', () => {
    writeFileSync(join(state, 'signature'), '');
    let result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing/u);
    assert.doesNotMatch(calls().join('\n'), /sfdisk --quiet|cryptsetup|mkfs|mount -o/u);
    rmSync(join(state, 'signature'));
    writeFileSync(join(state, 'pt'), 'other');
    writeFileSync(log, '');
    result = run();
    assert.equal(result.status, 1);
    assert.doesNotMatch(calls().join('\n'), /cryptsetup|mkfs|mount -o/u);
  });

  it('EVM-084: a missing volume or a device name of another shape stops the start (Docker then does not start either: RequiredBy=docker.service)', () => {
    rmSync(join(root, DEVICE));
    let result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not attached/u);
    for (const device of ['/dev/sda', '/dev/disk/by-id/scsi-0HC_Volume_1; rm -rf /', '/dev/disk/by-id/../../sda', '']) {
      result = run({ EVIA_WORK_DEVICE: device });
      assert.equal(result.status, 1, device);
    }
    assert.doesNotMatch(calls().join('\n'), /cryptsetup|mkfs|mount -o/u);
  });
});
