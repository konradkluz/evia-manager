# IaC container (EVM-007 AC1; ADR-0018 IaC; plan P11): OpenTofu by digest on the already pinned Debian base of the
# repository, two fixed entry points and nothing else (no provider is baked in, no credential, no shell entry point).
#   evia-iac-check — fmt -check, init without a backend from the lock file, validate (iac-check in compose.yaml; no secret)
#   evia-iac       — init | plan | apply | output of bootstrap or staging (iac in compose.iac.yaml; IaC session only)
FROM ghcr.io/opentofu/opentofu:1.13.1-minimal@sha256:dfbc3f0a8bed0adfa2cf49ff418f158afe24080eea6d6e748db8799fc4553db6 AS tofu

FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1

COPY --from=tofu /usr/local/bin/tofu /usr/local/bin/tofu
# CA bundle for the registry (the slim base has none); the minimal OpenTofu image is scratch-based.
COPY --from=ghcr.io/opentofu/opentofu:1.13.1@sha256:1df996fca13806a20d5a3d3ad54acdcf76bcb1aa4ac30b5ba169b9e4cecdbcc8 /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chmod=0555 check.sh /usr/local/bin/evia-iac-check
COPY --chmod=0555 iac.sh /usr/local/bin/evia-iac

ENV TF_IN_AUTOMATION=1 \
    TF_INPUT=0 \
    CHECKPOINT_DISABLE=1

USER node
HEALTHCHECK NONE
ENTRYPOINT ["/usr/local/bin/evia-iac-check"]
