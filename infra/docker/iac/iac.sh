#!/bin/sh
# iac (EVM-007 AC1; ADR-0018 IaC; security-engineer B): the only entry point of an IaC session — no shell, no other
# tofu command, no extra arguments. Credentials come from the secret file /run/secrets/iac (outside the repository,
# created and revoked by Konrad) and are exported for this tofu process only; names outside the allow-list are refused
# and no value is ever printed. Plans and state stay in /iac/state (outside the repository).
#   evia-iac <init|plan|apply|output> <bootstrap|staging>
set -eu
unset TF_LOG TF_LOG_PATH
command="${1:-}"
root="${2:-}"
if [ "$#" -ne 2 ]; then echo "usage: evia-iac <init|plan|apply|output> <bootstrap|staging>" >&2; exit 64; fi
case "$command" in init | plan | apply | output) ;; *) echo "evia-iac: command not allowed" >&2; exit 64 ;; esac
case "$root" in bootstrap | staging) ;; *) echo "evia-iac: root not allowed" >&2; exit 64 ;; esac

secret=/run/secrets/iac
if [ ! -r "$secret" ]; then echo "evia-iac: the IaC secret file is not mounted" >&2; exit 65; fi
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in '' | '#'*) continue ;; esac
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    HCLOUD_TOKEN | SCW_ACCESS_KEY | SCW_SECRET_KEY | AWS_ACCESS_KEY_ID | AWS_SECRET_ACCESS_KEY | TF_VAR_state_passphrase | TF_VAR_scaleway_project_id | TF_VAR_project_id | TF_VAR_state_bucket)
      export "$key=$value"
      ;;
    *)
      echo "evia-iac: a line of the IaC file has a name outside the allow-list (not printed)" >&2
      exit 65
      ;;
  esac
done < "$secret"

src=/src/infra/tofu/$root
state=/iac/state
export TF_DATA_DIR="$state/$root.data"
varfile="/iac/$root.tfvars"

case "$command" in
  init)
    if [ "$root" = staging ]; then
      exec tofu -chdir="$src" init -lockfile=readonly -no-color -backend-config="bucket=${TF_VAR_state_bucket:?}"
    fi
    exec tofu -chdir="$src" init -lockfile=readonly -no-color
    ;;
  plan) exec tofu -chdir="$src" plan -no-color -var-file="$varfile" -out="$state/$root.tfplan" ;;
  apply) exec tofu -chdir="$src" apply -no-color "$state/$root.tfplan" ;;
  output) exec tofu -chdir="$src" output -no-color ;;
esac
