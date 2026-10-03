// Fixture for `semgrep --test` (EVM-006): deliberately unsafe code, never imported or executed.
declare const userInput: string;

// ruleid: evm-no-dynamic-code
eval(userInput);

// ruleid: evm-no-dynamic-code
const add = new Function('a', 'b', userInput);

// ruleid: evm-no-dynamic-code
const sub = Function('a', userInput);

// ok: evm-no-dynamic-code
const data: unknown = JSON.parse(userInput);

export { add, data, sub };
