#!/bin/sh
# iac-check (EVM-007 AC1): checks without credentials — `tofu fmt -check`, `tofu init -backend=false` with providers
# verified against the committed lock files (read-only), `tofu validate`. The same command locally and in CI.
#   check (default) — the gate; red on any problem
#   lock            — prints the lock files for linux_amd64 and linux_arm64 to stdout (to update .terraform.lock.hcl)
set -eu
unset TF_LOG TF_LOG_PATH
src=/src/infra/tofu
roots="bootstrap staging"
mode="${1:-check}"

case "$mode" in
  check)
    tofu fmt -check -recursive -diff "$src"
    for root in $roots; do
      TF_DATA_DIR="/tmp/tofu/$root" tofu -chdir="$src/$root" init -backend=false -lockfile=readonly -no-color > /dev/null
      TF_DATA_DIR="/tmp/tofu/$root" tofu -chdir="$src/$root" validate -no-color
    done
    echo "iac-check: fmt, init (lock file) and validate passed for: $roots"
    ;;
  lock)
    rm -rf /tmp/work && mkdir -p /tmp/work && cp -R "$src/." /tmp/work/
    for root in $roots; do
      rm -f "/tmp/work/$root/.terraform.lock.hcl"
      TF_DATA_DIR="/tmp/tofu/$root" tofu -chdir="/tmp/work/$root" init -backend=false -no-color > /dev/null
      TF_DATA_DIR="/tmp/tofu/$root" tofu -chdir="/tmp/work/$root" providers lock -platform=linux_amd64 -platform=linux_arm64 > /dev/null
      echo "### $root/.terraform.lock.hcl"
      cat "/tmp/work/$root/.terraform.lock.hcl"
    done
    ;;
  *)
    echo "iac-check: allowed modes: check, lock" >&2
    exit 64
    ;;
esac
