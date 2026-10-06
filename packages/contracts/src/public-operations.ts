/**
 * Operations reachable without a session (`x-evia-authz: { public: true }`). Checked twice (defence in depth):
 * by the contract lint (redocly-plugin.ts) and at runtime by the API authorization guard. Adding an entry needs a
 * security-engineer review.
 */
export const PUBLIC_OPERATIONS: readonly string[] = Object.freeze(['getHealth']);
