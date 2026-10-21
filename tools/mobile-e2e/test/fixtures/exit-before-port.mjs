// Fixture of a worker that ends before it reports a port (EVM-009 AC4): the host must reject, not wait forever.
process.exit(0);
