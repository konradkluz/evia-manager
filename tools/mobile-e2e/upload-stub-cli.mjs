#!/usr/bin/env node
// @ts-check
/**
 * The scenario server of the background upload for the scripts of the orchestrator (EVM-130 AC8) — tools/mobile-e2e/README.md.
 *   node tools/mobile-e2e/upload-stub-cli.mjs [--port <n>] [--control-port <n>] [--part-size <bytes>]
 * Prints one line with the ports and runs until it is stopped; the control port is for the host only (loopback).
 */
import { startUploadStub } from './src/upload-stub.mjs';

/** @param {string} name @param {number} fallback */
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > 0 ? Number(process.argv[index + 1]) : fallback;
}

const stub = await startUploadStub({
  port: option('--port', 0),
  controlPort: option('--control-port', 0),
  partSize: option('--part-size', 8 * 1024 * 1024),
});
process.stdout.write(`upload-stub app=${String(stub.port)} control=${String(stub.controlPort)}\n`);
