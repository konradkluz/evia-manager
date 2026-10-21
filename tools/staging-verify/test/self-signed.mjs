// @ts-check
/**
 * A synthetic self-signed certificate for the local TLS servers of the tests (EVM-007 AC6) — built in memory with
 * node:crypto (ECDSA P-256, SHA-256), so the tests need neither openssl on the PATH nor a key committed to the repository.
 */
import { generateKeyPairSync, sign } from 'node:crypto';

/** @param {number} tag @param {Buffer} body @returns {Buffer} DER TLV */
function tlv(tag, body) {
  const length = body.length;
  if (length < 0x80) return Buffer.concat([Buffer.from([tag, length]), body]);
  const bytes = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.concat([Buffer.from([tag, 0x80 | bytes.length, ...bytes]), body]);
}
/** @param {Buffer[]} parts */
const sequence = (...parts) => tlv(0x30, Buffer.concat(parts));
/** @param {string} dotted @returns {Buffer} */
function oid(dotted) {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) chunk.unshift(0x80 | (value & 0x7f));
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}
/** @param {string} type @param {string} value */
const attribute = (type, value) => tlv(0x31, sequence(oid(type), tlv(0x0c, Buffer.from(value, 'utf8'))));
/** @param {Date} date */
const utcTime = (date) => tlv(0x17, Buffer.from(`${date.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`, 'ascii'));

/**
 * @param {{ host: string, organization: string, now?: Date }} subject
 * @returns {{ cert: string, key: string }} PEM
 */
export function selfSigned({ host, organization, now = new Date() }) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const algorithm = sequence(oid('1.2.840.10045.4.3.2'));
  const name = sequence(attribute('2.5.4.10', organization), attribute('2.5.4.3', host));
  const subjectAltName = sequence(oid('2.5.29.17'), tlv(0x04, sequence(tlv(0x82, Buffer.from(host, 'ascii')))));
  const tbs = sequence(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, Buffer.from([1])),
    algorithm,
    name,
    sequence(utcTime(new Date(now.getTime() - 86_400_000)), utcTime(new Date(now.getTime() + 30 * 86_400_000))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, sequence(subjectAltName)),
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = sequence(tbs, algorithm, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const base64 = der.toString('base64').replace(/(.{64})/g, '$1\n');
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`.replace('\n\n', '\n'),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
