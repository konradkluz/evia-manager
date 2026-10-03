// @ts-check

/**
 * Usage or environment error (bad arguments, no git repository, invalid configuration).
 * The CLI prints the message and exits with code 2 — never 0 or 1.
 */
export class ToolError extends Error {
  /** @param {string} message Polish, user-facing */
  constructor(message) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * Throws a ToolError when the condition is false.
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
export function check(condition, message) {
  if (!condition) throw new ToolError(message);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
