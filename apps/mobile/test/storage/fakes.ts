// Fakes of the native ports of the local store (EVM-093). Their state lives in a "device" object that survives restarts: a restart is a
// new LocalDataHost (and a new engine) on the same device. Every destructive call is recorded, so a test can assert "nothing deleted".
import { createHash, randomBytes } from 'node:crypto';
import { LocalDataHost, type LocalDataDeps } from '../../src/storage/local-data';
import type {
  AppFiles,
  CryptoSource,
  DeviceSecrets,
  InstallationIdentity,
  KeyHardware,
  KeyRead,
  KeyVault,
  StorageDiagnostic,
} from '../../src/storage/ports';
import type { SchemaPlan } from '../../src/storage/schema';
import { NodeSqliteEngine, type TestDisk } from './node-sqlite-engine';

export interface Device {
  readonly disk: TestDisk;
  key: string | null;
  keyAlias: boolean;
  readonly files: Map<string, string>;
  identity: InstallationIdentity | null;
  refreshToken: string | null;
  otherSecrets: boolean;
  preferences: boolean;
  /** Ordered log of effects across all ports ("vault.write", "engine.open", "files.remove:<name>", …). */
  readonly log: string[];
  /** Effects that delete something. */
  readonly deletions: string[];
  /** Failure injection: the named effect throws (once by default, `sticky` keeps it). */
  readonly fail: Map<string, { after: boolean; sticky: boolean }>;
  hardware: KeyHardware | 'throws';
  random: 'ok' | 'throws' | 'zeros' | 'short';
}

export function newDevice(disk: TestDisk): Device {
  return {
    disk,
    key: null,
    keyAlias: false,
    files: new Map(),
    identity: null,
    refreshToken: null,
    otherSecrets: false,
    preferences: false,
    log: [],
    deletions: [],
    fail: new Map(),
    hardware: 'software',
    random: 'ok',
  };
}

/** Runs an effect with failure injection: `after` = the effect happened, then the "process died" (an error is thrown). */
async function effect(device: Device, name: string, work: () => void, deletes = false): Promise<void> {
  const fault = device.fail.get(name);
  if (fault !== undefined && !fault.sticky) device.fail.delete(name);
  if (fault !== undefined && !fault.after) throw new Error(`synthetic failure of ${name}`);
  work();
  device.log.push(name);
  if (deletes) device.deletions.push(name);
  if (fault !== undefined) throw new Error(`synthetic crash after ${name}`);
  return Promise.resolve();
}

export class FakeVault implements KeyVault {
  readonly #d: Device;
  constructor(device: Device) {
    this.#d = device;
  }
  async read(): Promise<KeyRead> {
    if (this.#d.fail.has('vault.read')) {
      await effect(this.#d, 'vault.read', () => undefined);
    }
    this.#d.log.push('vault.read');
    return this.#d.key === null ? { kind: 'absent' } : { kind: 'present', hex: this.#d.key };
  }
  write(hex: string): Promise<void> {
    return effect(this.#d, 'vault.write', () => {
      this.#d.key = hex;
      this.#d.keyAlias = true;
    });
  }
  destroy(): Promise<void> {
    return effect(
      this.#d,
      'vault.destroy',
      () => {
        this.#d.key = null;
        this.#d.keyAlias = false;
      },
      true,
    );
  }
  hardware(): Promise<KeyHardware> {
    return this.#d.hardware === 'throws' ? Promise.reject(new Error('synthetic')) : Promise.resolve(this.#d.hardware);
  }
}

export class FakeFiles implements AppFiles {
  readonly #d: Device;
  constructor(device: Device) {
    this.#d = device;
  }
  async read(name: string): Promise<string | null> {
    if (this.#d.fail.has(`files.read:${name}`)) await effect(this.#d, `files.read:${name}`, () => undefined);
    return this.#d.files.get(name) ?? null;
  }
  write(name: string, text: string): Promise<void> {
    return effect(this.#d, `files.write:${name}`, () => this.#d.files.set(name, text));
  }
  remove(name: string): Promise<void> {
    return effect(this.#d, `files.remove:${name}`, () => this.#d.files.delete(name), this.#d.files.has(name));
  }
}

export class FakeCrypto implements CryptoSource {
  readonly #d: Device;
  constructor(device: Device) {
    this.#d = device;
  }
  getRandomBytes(length: number): Uint8Array {
    if (this.#d.random === 'throws') throw new Error('no CSPRNG (synthetic)');
    if (this.#d.random === 'zeros') return new Uint8Array(length);
    if (this.#d.random === 'short') return new Uint8Array(randomBytes(length - 1));
    return new Uint8Array(randomBytes(length));
  }
  sha256Hex(text: string): Promise<string> {
    return Promise.resolve(createHash('sha256').update(text).digest('hex'));
  }
}

export class FakeSecrets implements DeviceSecrets {
  readonly #d: Device;
  constructor(device: Device) {
    this.#d = device;
  }
  readIdentity(): Promise<InstallationIdentity | null> {
    return Promise.resolve(this.#d.identity);
  }
  writeIdentity(identity: InstallationIdentity): Promise<void> {
    return effect(this.#d, 'secrets.writeIdentity', () => {
      this.#d.identity = identity;
    });
  }
  deleteIdentity(): Promise<void> {
    return effect(this.#d, 'secrets.deleteIdentity', () => (this.#d.identity = null), true);
  }
  deleteRefreshToken(): Promise<void> {
    return effect(this.#d, 'secrets.deleteRefreshToken', () => (this.#d.refreshToken = null), true);
  }
  deleteAllSecrets(): Promise<void> {
    return effect(
      this.#d,
      'secrets.deleteAllSecrets',
      () => {
        this.#d.refreshToken = null;
        this.#d.otherSecrets = false;
      },
      true,
    );
  }
  deletePreferences(): Promise<void> {
    return effect(this.#d, 'secrets.deletePreferences', () => (this.#d.preferences = false), true);
  }
  deleteCrashReports(): Promise<void> {
    return effect(this.#d, 'secrets.deleteCrashReports', () => undefined, true);
  }
}

/** An engine that logs its effects into the device log and supports the same failure injection. */
export class LoggedEngine extends NodeSqliteEngine {
  readonly #d: Device;
  constructor(device: Device) {
    super(device.disk);
    this.#d = device;
  }
  override async exists(): Promise<boolean> {
    if (this.#d.fail.has('engine.exists')) await effect(this.#d, 'engine.exists', () => undefined);
    return super.exists();
  }
  override async open(): ReturnType<NodeSqliteEngine['open']> {
    await effect(this.#d, 'engine.open', () => undefined);
    return super.open();
  }
  override async remove(): Promise<void> {
    const existed = await super.exists();
    await effect(this.#d, 'engine.remove', () => undefined, existed);
    await super.remove();
  }
}

export interface Booted {
  readonly host: LocalDataHost;
  readonly engine: LoggedEngine;
  readonly diagnostics: StorageDiagnostic[];
}

/** A start of the app on the device (a new process). */
export function boot(device: Device, overrides: Partial<LocalDataDeps> & { schema?: SchemaPlan } = {}): Booted {
  const engine = new LoggedEngine(device);
  const diagnostics: StorageDiagnostic[] = [];
  const host = new LocalDataHost({
    engine,
    vault: new FakeVault(device),
    files: new FakeFiles(device),
    crypto: new FakeCrypto(device),
    secrets: new FakeSecrets(device),
    diagnostics: (event) => diagnostics.push(event),
    ...overrides,
  });
  return { host, engine, diagnostics };
}
