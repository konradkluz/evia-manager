/**
 * Scanner exceptions (docs/security/requirements.md → "Obsługa wyjątków"; security-engineer B2, A3, A5):
 * every exception has a reason, an owner, a story where required and an expiry date — at most 30 days ahead for
 * Critical/High vulnerabilities and 90 days for everything else; an expired exception fails the gate.
 * Never an exception: malicious packages (MAL-…) and real secrets.
 */
import { daysBetween, list, record, text } from './files.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHORT = 30;
const LONG = 90;

/** Problems of an expiry date (missing, malformed, expired or beyond the horizon). */
export function expiryProblems(where: string, date: string, today: string, horizon: number): string[] {
  const valid =
    DATE.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
  if (!valid) return [`${where}: brak poprawnej daty wygaśnięcia (YYYY-MM-DD)`];
  const days = daysBetween(today, date);
  if (days < 0) return [`${where}: wyjątek wygasł ${date} — usuń go albo napraw przyczynę`];
  if (days > horizon) return [`${where}: data ${date} jest dalej niż ${horizon} dni od dziś`];
  return [];
}

/** True when the reason states a Critical or High severity (shorter horizon). */
const severe = (reason: string): boolean => /\b(critical|high)\b/i.test(reason);

/**
 * osv-scanner.toml — `[[IgnoredVulns]]` with `id`, `ignoreUntil`, `reason` ("… · owner: … · EVM-###"). Parsed line by
 * line (only these keys; no TOML parser is needed for this subset).
 */
export function osvExceptionProblems(toml: string, today: string): string[] {
  const blocks: Array<Record<string, string>> = [];
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line === '[[IgnoredVulns]]') blocks.push({});
    else if (line.startsWith('[')) blocks.push({ __other: line });
    const match = /^(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/.exec(line);
    const block = blocks.at(-1);
    if (match && block) block[match[1] ?? ''] = match[2] ?? match[3] ?? '';
  }
  return blocks.flatMap((block, index) => {
    if (block['__other'] !== undefined)
      return [`osv-scanner.toml: nieobsługiwana sekcja ${block['__other']} — dozwolone tylko [[IgnoredVulns]]`];
    const id = block['id'] ?? '';
    const reason = block['reason'] ?? '';
    const where = `osv-scanner.toml: wyjątek ${index + 1} (${id || 'bez id'})`;
    const problems: string[] = [];
    if (id === '') problems.push(`${where}: brak id`);
    if (id.startsWith('MAL-')) problems.push(`${where}: pakiet złośliwy (MAL-…) nigdy nie ma wyjątku`);
    if (!/owner:\s*\S/.test(reason) || !/EVM-\d{3,}/.test(reason))
      problems.push(`${where}: reason musi zawierać powód, „owner: …” i EVM-###`);
    return [...problems, ...expiryProblems(where, block['ignoreUntil'] ?? '', today, severe(reason) ? SHORT : LONG)];
  });
}

/** .trivyignore.yaml — every entry needs `id`, `statement` ("… · owner: … · EVM-###") and `expired_at`. */
export function trivyExceptionProblems(document: unknown, today: string): string[] {
  const data = record(document);
  return Object.entries(data).flatMap(([kind, entries]) =>
    list(entries).flatMap((entry, index) => {
      const item = record(entry);
      const where = `.trivyignore.yaml: ${kind}[${index}] (${text(item['id']) || 'bez id'})`;
      const statement = text(item['statement']);
      const problems =
        /owner:\s*\S/.test(statement) && /EVM-\d{3,}/.test(statement)
          ? []
          : [`${where}: statement musi zawierać powód, „owner: …” i EVM-###`];
      const horizon = kind === 'vulnerabilities' && severe(statement) ? SHORT : LONG;
      const expiry = item['expired_at'] instanceof Date ? item['expired_at'].toISOString().slice(0, 10) : text(item['expired_at']);
      return [...problems, ...expiryProblems(where, expiry, today, horizon)];
    }),
  );
}

/**
 * .gitleaksignore — only comments and fingerprints; every fingerprint is preceded by a comment
 * "# reason: … · owner: … · review_by: YYYY-MM-DD" (≤ 90 days).
 */
export function gitleaksIgnoreProblems(content: string, today: string): string[] {
  const lines = content.split('\n').map((line) => line.trim());
  return lines.flatMap((line, index) => {
    if (line === '' || line.startsWith('#')) return [];
    const where = `.gitleaksignore: linia ${index + 1}`;
    if (!/^[^:\s]+(:[^:\s]+)+:\d+$/.test(line)) return [`${where}: dozwolone są wyłącznie fingerprinty gitleaks i komentarze`];
    const comment = lines[index - 1] ?? '';
    const reviewBy = /review_by:\s*(\S+)/.exec(comment)?.[1] ?? '';
    const problems = /^#.*reason:\s*\S.*owner:\s*\S/.test(comment)
      ? []
      : [`${where}: brak komentarza z „reason: …” i „owner: …” w linii wyżej`];
    return [...problems, ...expiryProblems(where, reviewBy, today, LONG)];
  });
}

/**
 * zizmor.yml ignores (`rules.<rule>.ignore`) and `# zizmor: ignore[…]` comments in workflows: each needs
 * "reason: … · owner: … · review_by: YYYY-MM-DD" (≤ 90 days) on the same or the previous line.
 */
export function annotatedIgnoreProblems(file: string, content: string, marker: RegExp, today: string): string[] {
  const lines = content.split('\n');
  return lines.flatMap((line, index) => {
    if (!marker.test(line)) return [];
    const context = `${lines[index - 1] ?? ''} ${line}`;
    const where = `${file}: linia ${index + 1}`;
    const reviewBy = /review_by:\s*(\S+)/.exec(context)?.[1] ?? '';
    const problems = /reason:\s*\S.*owner:\s*\S/.test(context) ? [] : [`${where}: wyjątek bez „reason: …” i „owner: …”`];
    return [...problems, ...expiryProblems(where, reviewBy, today, LONG)];
  });
}
