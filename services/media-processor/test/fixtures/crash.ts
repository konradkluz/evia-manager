// A child killed the way the OOM killer does it (EVM-068 AC3).
process.kill(process.pid, 'SIGKILL');
