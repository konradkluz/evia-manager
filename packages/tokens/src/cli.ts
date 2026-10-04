/**
 * Entry point of the token build (`pnpm --filter @evia/tokens run build`, Turborepo task `build`; EVM-006 AC6).
 * Reads design/tokens from the repository root and writes packages/tokens/dist.
 */
import { fileURLToPath } from 'node:url';
import { buildTokens, OUTPUTS, TokenValidationError } from './build.ts';

export interface CliOptions {
  readonly sourceDir: string;
  readonly outDir: string;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

/** @returns exit code: 0 — built, 1 — invalid tokens */
export async function main({ sourceDir, outDir, stdout, stderr }: CliOptions): Promise<number> {
  try {
    await buildTokens({ sourceDir, outDir });
  } catch (error) {
    if (!(error instanceof TokenValidationError)) throw error;
    stderr('@evia/tokens: design tokens are invalid — fix design/tokens:');
    for (const problem of error.errors) stderr(`  ${problem}`);
    return 1;
  }
  stdout(`@evia/tokens: ${OUTPUTS.length} files → ${outDir} (${OUTPUTS.join(', ')})`);
  return 0;
}

/* v8 ignore start -- process wiring of `node src/cli.ts`; main() is covered by tests */
if (import.meta.main) {
  process.exitCode = await main({
    sourceDir: fileURLToPath(new URL('../../../design/tokens', import.meta.url)),
    outDir: fileURLToPath(new URL('../dist', import.meta.url)),
    stdout: (line) => {
      console.log(line);
    },
    stderr: (line) => {
      console.error(line);
    },
  });
}
/* v8 ignore stop */
