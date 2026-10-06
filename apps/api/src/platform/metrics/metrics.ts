/**
 * Application metrics (SR-LOG-06; ADR-0013): counters held in the process, with a fixed list of label names per counter
 * and label values that are short codes (`[a-z_]`, never free text, an identifier or an address — cardinality stays
 * bounded and no personal data can get in, SR-LOG-02). Exposing them to Prometheus / OpenTelemetry belongs to EVM-007
 * (monitoring); until then they are readable through `snapshot()` and asserted in tests.
 */
export type Labels = Readonly<Record<string, string>>;

export interface Counter {
  increment(labels: Labels): void;
}

export interface CounterSample {
  readonly name: string;
  readonly labels: Labels;
  readonly value: number;
}

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const LABEL_VALUE = /^[a-z][a-z_]{0,31}$/;

export class MetricsRegistry {
  readonly #counters = new Map<string, Map<string, CounterSample>>();
  readonly #labelNames = new Map<string, readonly string[]>();

  /** Registers (or returns) a counter with the label names it accepts. */
  counter(name: string, labelNames: readonly string[]): Counter {
    if (!NAME.test(name)) throw new Error('invalid metric name');
    const known = this.#labelNames.get(name);
    if (known !== undefined && known.join(',') !== labelNames.join(',')) throw new Error(`metric ${name} is registered with other labels`);
    this.#labelNames.set(name, labelNames);
    const samples = this.#counters.get(name) ?? new Map<string, CounterSample>();
    this.#counters.set(name, samples);
    return {
      increment: (labels) => {
        const keys = Object.keys(labels);
        if (keys.length !== labelNames.length || !labelNames.every((label) => Object.hasOwn(labels, label))) {
          throw new Error(`metric ${name} takes the labels ${labelNames.join(', ')}`);
        }
        if (!Object.values(labels).every((value) => LABEL_VALUE.test(value)))
          throw new Error(`metric ${name}: a label value must be a short code`);
        const key = labelNames.map((label) => `${label}=${labels[label]}`).join('|');
        const sample = samples.get(key);
        samples.set(key, { name, labels: { ...labels }, value: (sample?.value ?? 0) + 1 });
      },
    };
  }

  snapshot(): CounterSample[] {
    return [...this.#counters.values()].flatMap((samples) => [...samples.values()]);
  }
}
