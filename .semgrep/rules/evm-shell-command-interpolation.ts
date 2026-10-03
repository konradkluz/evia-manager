// Fixture for `semgrep --test` (EVM-006): deliberately unsafe code, never imported or executed.
import childProcess, { exec, execFile, execSync } from 'node:child_process';

declare const branch: string;

// ruleid: evm-shell-command-interpolation
exec(`git log ${branch}`);

// ruleid: evm-shell-command-interpolation
execSync('git log ' + branch);

// ruleid: evm-shell-command-interpolation
childProcess.execSync(`git checkout ${branch}`);

// ok: evm-shell-command-interpolation
execFile('git', ['log', branch]);

// ok: evm-shell-command-interpolation
execSync('git status');

// ok: evm-shell-command-interpolation
const match = /x/.exec(`a${branch}`);

export { match };
