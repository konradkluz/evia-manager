import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkBackupRules, checkDataExtractionRules, checkNetworkSecurityConfig } from '../src/resources.mjs';

/** @param {string} name */
const read = (name) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('XML resources of the built APK (EVM-009 AC6; SR-COMM-04, SR-MOB-02)', () => {
  it('EVM-009 AC6: the resources of the real package pass', () => {
    assert.deepEqual(checkNetworkSecurityConfig(read('evia_network_security_config.xml.txt')), []);
    assert.deepEqual(checkBackupRules(read('evia_backup_rules.xml.txt')), []);
    assert.deepEqual(checkDataExtractionRules(read('evia_data_extraction_rules.xml.txt')), []);
  });

  it('EVM-009 AC6: cleartext, a user CA, a cleartext exception or debug overrides in the network security config are reported', () => {
    const base =
      '<network-security-config><base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system" /></trust-anchors></base-config></network-security-config>';
    assert.deepEqual(checkNetworkSecurityConfig(base), []);
    assert.deepEqual(checkNetworkSecurityConfig(base.replace('"false"', '"true"')), ['base-config does not forbid cleartext traffic']);
    assert.deepEqual(
      checkNetworkSecurityConfig(base.replace('<certificates src="system" />', '<certificates src="system" /><certificates src="user" />')),
      ['trust anchors are not the system store only'],
    );
    assert.deepEqual(checkNetworkSecurityConfig(base.replace('<trust-anchors><certificates src="system" /></trust-anchors>', '')), [
      'trust anchors are not the system store only',
    ]);
    assert.deepEqual(
      checkNetworkSecurityConfig(
        base.replace(
          '</network-security-config>',
          '<domain-config cleartextTrafficPermitted="true"><domain>10.0.2.2</domain></domain-config></network-security-config>',
        ),
      ),
      ['domain-config is present (no cleartext exception in a release build)'],
    );
    assert.deepEqual(
      checkNetworkSecurityConfig(base.replace('</network-security-config>', '<debug-overrides /></network-security-config>')),
      ['debug-overrides is present'],
    );
    assert.deepEqual(checkNetworkSecurityConfig('<network-security-config />'), [
      'base-config does not forbid cleartext traffic',
      'trust anchors are not the system store only',
    ]);
    assert.deepEqual(checkNetworkSecurityConfig('<other />'), ['not a network-security-config']);
  });

  it('EVM-009 AC6: a backup rule that does not exclude every domain, or includes data, is reported', () => {
    const rules =
      '<full-backup-content><exclude domain="root" /><exclude domain="file" /><exclude domain="database" /><exclude domain="sharedpref" /><exclude domain="external" /></full-backup-content>';
    assert.deepEqual(checkBackupRules(rules), []);
    assert.deepEqual(checkBackupRules(rules.replace('<exclude domain="database" />', '')), [
      'full-backup-content does not exclude database',
    ]);
    assert.deepEqual(
      checkBackupRules(rules.replace('</full-backup-content>', '<include domain="file" path="x" /></full-backup-content>')),
      ['full-backup-content includes data'],
    );
    assert.deepEqual(checkBackupRules('<other />'), ['not a full-backup-content']);
  });

  it('EVM-009 AC6: data extraction rules must exclude everything from the cloud backup and the device transfer', () => {
    /** @param {string} name */
    const section = (name) =>
      `<${name}><exclude domain="root" /><exclude domain="file" /><exclude domain="database" /><exclude domain="sharedpref" /><exclude domain="external" /></${name}>`;
    const rules = `<data-extraction-rules>${section('cloud-backup')}${section('device-transfer')}</data-extraction-rules>`;
    assert.deepEqual(checkDataExtractionRules(rules), []);
    assert.deepEqual(checkDataExtractionRules(`<data-extraction-rules>${section('cloud-backup')}</data-extraction-rules>`), [
      'device-transfer is missing',
    ]);
    assert.deepEqual(
      checkDataExtractionRules(
        rules.replace('<exclude domain="sharedpref" />', '<exclude domain="sharedpref" /><include domain="file" />'),
      ),
      ['cloud-backup includes data'],
    );
    assert.deepEqual(checkDataExtractionRules('<other />'), ['not a data-extraction-rules']);
  });
});
