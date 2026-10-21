# Dev and CI only (EVM-007 AC4; architect 16; security-engineer B): Linux environment for the tests of the root script
# deploy.sh — bash, GNU coreutils and jq as on the VM, Node.js for node:test, ShellCheck for the shell scripts of
# infra/. Never used on staging or production. Base by tag + digest; jq and ShellCheck in exact Debian versions.
FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1

RUN apt-get update \
 && apt-get install -y --no-install-recommends jq=1.7.1-6+deb13u4 shellcheck=0.10.0-1 \
 && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /tmp
HEALTHCHECK NONE
ENTRYPOINT ["node", "--test", "/src/infra/deploy-agent/test/"]
