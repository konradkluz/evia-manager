#!/bin/bash
# Encrypted work volumes of the VM (EVM-084; decision of Konrad 2026-11-12; RR-75 and RR-76 are accepted only with dm-crypt). One Hetzner Volume holds two partitions:
#   /var/lib/evia/media-video    the work area of the films (EVM-046; the worker and the media processor)
#   /var/lib/evia/clamav-scan    the TemporaryDirectory of clamd (every scanned stream, photos with GPS included)
# Both are plain dm-crypt with an EPHEMERAL key: read from /dev/urandom at every start, held only by the kernel, never written anywhere (no key file, no LUKS header,
# no crypttab or fstab entry). After a restart the content is unreadable, so the volumes are formatted anew at every start - they hold work in progress only: a film
# that was being processed is taken again from its original in the bucket after the stale period, a scan is repeated (docs/ops/runbooks/media-processor.md).
# Installed ONLY in an IaC session at /usr/local/sbin/evia-work-volumes (user-data of a new VM; by hand on an existing one) and run by evia-work-volumes.service,
# which is RequiredBy=docker.service and Before=docker.service: when a volume cannot be set up, Docker does not start (a quiet fall back to the unencrypted root disk
# is not possible). The mount points are immutable (chattr +i) while nothing is mounted on them. deploy.sh checks the result again before every deployment.
# A volume with a file system or with another partition layout is REFUSED, never formatted. No eval; every value is validated; EVIA_ROOT (tests only) prefixes paths.
set -euo pipefail
umask 077

readonly ROOT="${EVIA_ROOT:-}"
readonly WAIT="${EVIA_WORK_WAIT:-5}"
# 15 GiB of films (>= 10 GiB asked by the runbook); the rest (>= 3.6 GB of a 20 GB volume) is the scratch space of clamd (>= 2.5 GB).
readonly VIDEO_MIB="${EVIA_WORK_VIDEO_MIB:-15360}"
readonly DEVICE_NAME="${EVIA_WORK_DEVICE:?EVIA_WORK_DEVICE}"
# The user of clamd in the image (uid:gid), from the unit: the scratch space belongs to it alone (mode 0700). No default: read it from the pinned image in the IaC session.
readonly CLAMAV_OWNER="${EVIA_CLAMAV_OWNER:?EVIA_CLAMAV_OWNER}"

log() { printf '%s work-volumes: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >&2; }
fail() {
  log "REFUSED: $1"
  exit 1
}

[[ "$DEVICE_NAME" =~ ^/dev/disk/by-id/scsi-0HC_Volume_[0-9]{1,12}$ ]] || fail "device name"
[[ "$VIDEO_MIB" =~ ^[0-9]{4,6}$ ]] || fail "size of the films partition"
[[ "$CLAMAV_OWNER" =~ ^[1-9][0-9]{0,5}:[1-9][0-9]{0,5}$ ]] || fail "owner of the scratch space of clamd (uid:gid of the user of clamd)"
readonly DEVICE="$ROOT$DEVICE_NAME"

tries=0
while [ ! -e "$DEVICE" ]; do
  tries=$((tries + 1))
  [ "$tries" -le 60 ] || fail "work volume not attached"
  sleep "$WAIT"
done

# The partition table: none (a blank volume: create it), or exactly two partitions. A signature without a table, or any other layout, is somebody's data.
if ! sfdisk -d -- "$DEVICE" > /dev/null 2>&1; then
  if blkid -p -- "$DEVICE" > /dev/null 2>&1; then fail "work volume has a file system or a signature without a partition table: refusing"; fi
  log "blank volume: creating the partition table"
  # named partitions: only a volume with THESE names is ever opened and formatted (a foreign volume with two partitions is somebody's data)
  printf 'label: gpt\nsize=%sMiB, name=evia-media-video\nname=evia-clamav-scan\n' "$VIDEO_MIB" | sfdisk --quiet --no-reread -- "$DEVICE"
  udevadm settle || true
fi
layout="$(sfdisk -d -- "$DEVICE" | sed 's/= */=/g')"
partitions="$(grep -c '^/dev/' <<< "$layout" || true)"
[ "$partitions" = 2 ] || fail "work volume has $partitions partitions instead of 2: refusing"
# the expected layout: first the films (named, of the planned size), second the scratch space of clamd (named)
sector_size="$(sed -n 's/^sector-size: *\([0-9][0-9]*\)$/\1/p' <<< "$layout" | head -n 1)"
sector_size="${sector_size:-512}"
expected_sectors=$((VIDEO_MIB * 1048576 / sector_size))
first="$(grep '^/dev/' <<< "$layout" | sed -n 1p)"
second="$(grep '^/dev/' <<< "$layout" | sed -n 2p)"
[[ "$first" == *'name="evia-media-video"'* && "$first" == *"size=$expected_sectors,"* && "$second" == *'name="evia-clamav-scan"'* ]] ||
  fail "work volume partitions are not ours (names evia-media-video and evia-clamav-scan, the films partition of the planned size): refusing"
for part in 1 2; do
  tries=0
  while [ ! -e "$DEVICE-part$part" ]; do
    tries=$((tries + 1))
    [ "$tries" -le 60 ] || fail "partition $part did not appear"
    sleep "$WAIT"
  done
done

# set_up NAME PARTITION MOUNT-POINT OWNER MODE
set_up() {
  local name="$1" partition="$2" target="$ROOT$3" owner="$4" mode="$5"
  if mountpoint -q -- "$target"; then
    # kept only when it is OUR mapping and a dm-crypt device (also for the scratch space of clamd, which nothing else checks)
    mounted_source="$(findmnt -n -o SOURCE --direction backward --mountpoint "$target" 2> /dev/null | head -n 1)"
    mounted_type="$(lsblk -no TYPE -- "$mounted_source" 2> /dev/null | head -n 1)"
    if [ "$mounted_source" != "$ROOT/dev/mapper/$name" ] || [ "$mounted_type" != crypt ]; then
      fail "$3 is mounted but is not the encrypted mapping $name (type crypt): refusing"
    fi
    log "$3 is mounted: kept"
    return 0
  fi
  # open but not mounted: nothing uses it, a new key is safer than a stale mapping
  [ ! -e "$ROOT/dev/mapper/$name" ] || cryptsetup close "$name"
  # plain dm-crypt, 512-bit XTS key taken from /dev/urandom (64 bytes, no hashing): the key exists only in the kernel
  cryptsetup open --type plain --cipher aes-xts-plain64 --key-size 512 --hash plain --key-file /dev/urandom --keyfile-size 64 --sector-size 4096 "$partition" "$name"
  mkfs.ext4 -q -F -L "$name" "$ROOT/dev/mapper/$name"
  chattr -i "$target" 2> /dev/null || true
  install -d -m 0755 -- "$target"
  chattr +i "$target"
  mount -o nodev,nosuid,noexec "$ROOT/dev/mapper/$name" "$target"
  chown "$owner" "$target"
  chmod "$mode" "$target"
  log "$3: encrypted with a key of the memory, mounted nodev,nosuid,noexec"
}

# The films: the worker (10002) and the media processor (10005, group 10002) only. The scratch space of clamd: the user of clamd alone, mode 0700 (set at every start).
set_up evia-media-video "$DEVICE-part1" /var/lib/evia/media-video 10005:10002 2770
set_up evia-clamav-scan "$DEVICE-part2" /var/lib/evia/clamav-scan "$CLAMAV_OWNER" 0700
