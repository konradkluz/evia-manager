/**
 * Public surface of the local store (EVM-093). The SQL stores are deliberately NOT exported: the contents of the queue and the replica
 * are reachable only through `LocalDataHost.openForUser(userId)` after a full sign-in (owner guard, SR-MOB-13; test design-rules).
 */
import { logDiagnostic } from '../logging/log';
import { createExpoSqliteEngine, E2E_COPY_NAME, expoSqliteEngine } from './expo-sqlite-driver';
import { LocalDataHost, wipeFaultForE2e } from './local-data';
import { createAppFiles, createKeyVault, deviceSecrets, expoCrypto } from './platform';

export { LocalDataHost } from './local-data';
export type { DataLossReason, OpenResult, StoreFacts, UnlockedStore } from './local-data';
export type { InstallationIdentity, KeyHardware, StorageDiagnostic } from './ports';
export type { StorageErrorCode } from './errors';

let host: LocalDataHost | undefined;

/** The single host of the process (one connection per JS process; the port allows a native process later, EVM-109). */
export function localData(): LocalDataHost {
  host ??= new LocalDataHost({
    engine: expoSqliteEngine,
    vault: createKeyVault(),
    files: createAppFiles(),
    crypto: expoCrypto,
    secrets: deviceSecrets,
    diagnostics: logDiagnostic,
  });
  return host;
}

/**
 * Support of the e2e hooks ONLY (EVM-093; src/e2e-hooks/panel.tsx, bundled in the e2e variant): the wipe fault of scenario 13 and the
 * engine of the file copied before the wipe (opened through `LocalDataHost.probe`, never as the database of the app). No key leaves.
 * Referenced by no other module (test design-rules).
 */
export const storageE2eSupport = {
  wipeFault: wipeFaultForE2e,
  copyEngine: () => createExpoSqliteEngine(E2E_COPY_NAME),
};
