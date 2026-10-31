// A child that reports a result beyond the protocol (EVM-068 AC3: the result of a child is not trusted).
process.send?.({ ok: true, outputs: [{ variant: 'thumbnail', width: 99999, height: 1 }] }, () => process.exit(0));
