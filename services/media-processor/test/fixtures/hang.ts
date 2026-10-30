// A child that never answers and never exits, like a thread of libvips that never returns (EVM-068 AC3).
setInterval(() => undefined, 1000);
