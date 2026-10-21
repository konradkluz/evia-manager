import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emulatorsOf, parseAdbDevices, selectEmulator } from '../src/adb.mjs';

const HEADER = 'List of devices attached\n';

describe('adb devices (EVM-009 AC4; ADR-0015)', () => {
  it('EVM-009 AC4: parses the serials and states, skipping the header, blank lines and daemon messages', () => {
    const output = `* daemon not running; starting now at tcp:5037\r\n* daemon started successfully\r\n${HEADER}emulator-5554\tdevice\r\nR58M123ABC\tunauthorized\r\n\r\n`;
    assert.deepEqual(parseAdbDevices(output), [
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'R58M123ABC', state: 'unauthorized' },
    ]);
  });

  it('EVM-009 AC4: an empty list is no devices', () => {
    assert.deepEqual(parseAdbDevices(HEADER), []);
    assert.deepEqual(parseAdbDevices(''), []);
  });

  it('EVM-009 AC4: only emulators count, a phone on the cable does not', () => {
    const devices = parseAdbDevices(`${HEADER}emulator-5554\tdevice\nR58M123ABC\tdevice\n`);
    assert.deepEqual(
      emulatorsOf(devices).map((device) => device.serial),
      ['emulator-5554'],
    );
  });

  it('EVM-009 AC4: exactly one ready emulator is selected', () => {
    const devices = parseAdbDevices(`${HEADER}emulator-5554\tdevice\nR58M123ABC\tdevice\n`);
    assert.deepEqual(selectEmulator(devices), { ok: true, serial: 'emulator-5554' });
  });

  it('EVM-009 AC4: no emulator is reported as such', () => {
    assert.deepEqual(selectEmulator(parseAdbDevices(`${HEADER}R58M123ABC\tdevice\n`)), { ok: false, reason: 'none', serials: [] });
  });

  it('EVM-009 AC4: more than one emulator is a refusal — never a guess (the machine runs one at a time)', () => {
    const devices = parseAdbDevices(`${HEADER}emulator-5554\tdevice\nemulator-5556\tdevice\n`);
    assert.deepEqual(selectEmulator(devices), { ok: false, reason: 'several', serials: ['emulator-5554', 'emulator-5556'] });
  });

  it('EVM-009 AC4: an emulator that is still starting or offline is not ready', () => {
    for (const state of ['offline', 'unauthorized', 'bootloader']) {
      assert.deepEqual(selectEmulator(parseAdbDevices(`${HEADER}emulator-5554\t${state}\n`)), {
        ok: false,
        reason: 'not-ready',
        serials: ['emulator-5554'],
      });
    }
  });
});
