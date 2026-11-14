// @ts-check
/**
 * Static checks of the built APK for EVM-102 (SR-PRIV-09, SR-MOB-12, MASVS-PRIVACY-1):
 * - AC5 `checkTelemetry`: no SDK of error reporting, analytics, advertising or session recording (manifest components and meta-data,
 *   DEX packages, the AD_ID permission, permissions of screen capture) and the only addresses in the package configuration are the
 *   API and the object storage. The check says nothing about network traffic — that is a manual analysis (EVM-112).
 * - AC6 `clauseBlockers`: the privacy clauses built into the package are final. The state is declared by the build in `extra`
 *   of the Expo configuration (`privacyClauses`, apps/mobile/plugins/expo-config.ts). The result is NOT a problem of `verify`
 *   (CI stays green while the clauses are a draft); only `sign` refuses a package that has blockers.
 * Findings carry the rule and the name of the component or package — never contents.
 */
import { childrenNamed, parseXml } from './xml.mjs';

/** Meta-data of the package: the address of the API (https) and the hosts of the object storage (comma separated, no scheme). */
export const API_BASE_URL_META = 'pl.eviacharge.API_BASE_URL';
export const STORAGE_HOSTS_META = 'pl.eviacharge.STORAGE_HOSTS';

/** Package prefixes of SDKs that report errors, measure usage, serve advertising or record the screen. */
const SDK_PREFIXES = Object.freeze([
  'com.google.firebase',
  'com.google.android.gms',
  'com.google.mlkit',
  'com.google.android.datatransport',
  'io.sentry',
  'com.bugsnag',
  'com.crashlytics',
  'io.fabric',
  'com.microsoft.appcenter',
  'com.microsoft.clarity',
  'com.amplitude',
  'com.segment.analytics',
  'com.mixpanel',
  'com.flurry',
  'com.adjust',
  'com.appsflyer',
  'com.onesignal',
  'com.datadog',
  'com.newrelic',
  'io.embrace',
  'com.instabug',
  'com.smartlook',
  'com.uxcam',
  'com.fullstory',
  'com.logrocket',
  'io.hotjar',
  'com.facebook.appevents',
  'com.facebook.ads',
  'com.applovin',
  'com.unity3d.ads',
  'com.ironsource',
  'com.huawei.hms.ads',
  'com.amazon.device.ads',
]);

/** Meta-data names that configure analytics or advertising SDKs. */
const SDK_META = /^(?:firebase_|google_analytics_|google_app_id\b|com\.google\.android\.gms\.|io\.sentry\.|com\.crashlytics\.)/;

/** The advertising identifier and the privacy-sandbox ad services (MASVS-PRIVACY-1), and the capture of the screen. */
const FORBIDDEN_PERMISSION =
  /^(?:com\.google\.android\.gms\.permission\.AD_ID|android\.permission\.(?:ACCESS_ADSERVICES_[A-Z_]+|CAPTURE_VIDEO_OUTPUT|CAPTURE_SECURE_VIDEO_OUTPUT|READ_FRAME_BUFFER|FOREGROUND_SERVICE_MEDIA_PROJECTION))$/;

/** @param {string} name a class or package name @returns {string | undefined} the matching SDK prefix */
function sdkPrefixOf(name) {
  return SDK_PREFIXES.find((prefix) => name === prefix || name.startsWith(`${prefix}.`));
}

/** A host name: labels of letters, digits and hyphens; no scheme, port, path, wildcard or whitespace. */
const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * Addresses in the configuration of the package: the meta-data of the API and of the object storage are optional (absent = nothing to
 * check), when they are there they must be well formed, the API address must be https, and no other meta-data of the app may carry
 * an address.
 * @param {import('./xml.mjs').XmlElement} application
 * @returns {string[]}
 */
function hostProblems(application) {
  /** @type {string[]} */
  const problems = [];
  for (const meta of childrenNamed(application, 'meta-data')) {
    const name = meta.attributes['android:name'] ?? '';
    const value = meta.attributes['android:value'] ?? '';
    if (name === API_BASE_URL_META) {
      if (!/^https:\/\/[^\s/?#@:]+(?::\d{1,5})?(?:\/[^\s?#]*)?$/i.test(value)) problems.push(`${name} is not an https address`);
    } else if (name === STORAGE_HOSTS_META) {
      const hosts = value.split(',').map((host) => host.trim());
      if (value.trim() === '' || !hosts.every((host) => HOST_NAME.test(host))) problems.push(`${name} is not a list of host names`);
    } else if (name.startsWith('pl.eviacharge.') && /(?:URL|URI|HOST|HOSTS|ENDPOINT|DOMAIN)S?$/i.test(name)) {
      problems.push(`unexpected address in the package configuration (${name}); only the API and the object storage are allowed`);
    }
  }
  return problems;
}

/**
 * @param {{ manifest: string, dexPackages: string | null }} input
 *   `manifest`: the output of `apkanalyzer manifest print`; `dexPackages`: the output of `apkanalyzer dex packages --defined-only`
 *   (`null` when the tool failed: reported by verify itself)
 * @returns {string[]} problems
 */
export function checkTelemetry({ manifest, dexPackages }) {
  /** @type {string[]} */
  const problems = [];
  /** @type {import('./xml.mjs').XmlElement | null} */
  let root = null;
  try {
    root = parseXml(manifest);
  } catch {
    // an unreadable manifest is reported by checkManifest; only the DEX part can still be checked
  }

  for (const tag of ['uses-permission', 'uses-permission-sdk-23']) {
    for (const element of root === null ? [] : childrenNamed(root, tag)) {
      const name = element.attributes['android:name'] ?? '';
      if (FORBIDDEN_PERMISSION.test(name)) problems.push(`permission ${name} (advertising identifier or capture of the screen)`);
    }
  }

  const application = root === null ? undefined : childrenNamed(root, 'application')[0];
  if (application !== undefined) {
    for (const tag of ['activity', 'activity-alias', 'service', 'receiver', 'provider']) {
      for (const component of childrenNamed(application, tag)) {
        const name = component.attributes['android:name'] ?? '';
        const prefix = sdkPrefixOf(name);
        if (prefix !== undefined) problems.push(`${tag} ${name} belongs to a telemetry, analytics or advertising SDK (${prefix})`);
      }
    }
    for (const meta of childrenNamed(application, 'meta-data')) {
      const name = meta.attributes['android:name'] ?? '';
      if (SDK_META.test(name)) problems.push(`meta-data ${name} configures a telemetry, analytics or advertising SDK`);
    }
    problems.push(...hostProblems(application));
  }

  if (dexPackages !== null) {
    /** @type {Set<string>} */
    const found = new Set();
    for (const line of dexPackages.split(/\r?\n/)) {
      const name = line.trim().split(/\s+/).at(-1) ?? '';
      const prefix = /^[A-Za-z_][\w.$]*$/.test(name) ? sdkPrefixOf(name) : undefined;
      if (prefix !== undefined) found.add(prefix);
    }
    for (const prefix of [...found].sort())
      problems.push(`DEX contains the package ${prefix} of a telemetry, analytics or advertising SDK`);
  }
  return problems;
}

/** The declaration of the build: `"privacyClauses":{"draft":false,"markers":false,…}` (a flat object, plain JSON in the assets). */
const DECLARATION = /"privacyClauses"\s*:\s*(\{[^{}]*\})/;

/**
 * @param {{ path: string, text: string }[]} files the text assets of the package (those verify has read)
 * @returns {string[]} reasons why `sign` must refuse the package; empty when the clauses are final
 */
export function clauseBlockers(files) {
  for (const { text } of files) {
    const match = DECLARATION.exec(text);
    if (match?.[1] === undefined) continue;
    /** @type {unknown} */
    let declaration;
    try {
      declaration = JSON.parse(match[1]);
    } catch {
      return ['the declaration of the privacy clauses in the package is unreadable'];
    }
    if (typeof declaration !== 'object' || declaration === null)
      return ['the declaration of the privacy clauses in the package is unreadable'];
    const { draft, markers } = /** @type {{ draft?: unknown, markers?: unknown }} */ (declaration);
    /** @type {string[]} */
    const blockers = [];
    if (draft !== false) blockers.push('the privacy clauses are a draft (DRAFT); a lawyer or the owner must approve them first');
    if (markers !== false)
      blockers.push('the privacy clauses still contain markers [DO UZUPEŁNIENIA] or [PRAWNIK/IOD]; fill them in first');
    return blockers;
  }
  return ['the package does not declare the state of the privacy clauses (build it from a version with the privacy screen)'];
}
