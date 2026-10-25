// A headless Presto for one run: `presto-server` (installed by install-presto-server.sh) on a
// registry-claimed port, its state under a per-run PRESTO_HOME, proving with the toolchain's own
// native bb and told which Aztec release that is — without AZTEC_BB_VERSION it reports `unknown`,
// the SDK asks for a download, and the server fetches bb from GitHub before the first proof.
// Stopped with SIGTERM first: Presto's handler is what ends the bb child (its own process group).
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { type ClaimOptions, claim } from './registry.ts';
import { repoRoot } from './toolchain.ts';

const pin = readFileSync(join(repoRoot, '.aztecrc'), 'utf8').trim();

/** The native `bb` the toolchain lock pins (the `bb` on PATH is a Node wrapper Presto cannot execute). */
export function nativeBbPath(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const os = process.platform === 'darwin' ? 'macos' : 'linux';
  return join(
    homedir(),
    '.aztec',
    'versions',
    pin,
    'node_modules',
    '@aztec-foundation',
    'bb.js',
    'build',
    `${arch}-${os}`,
    'bb',
  );
}

/** `presto-server` on PATH or where the installer puts it; null when this machine has none. */
export function prestoServerBinary(): string | null {
  const local = join(homedir(), '.local', 'bin', 'presto-server');
  return Bun.which('presto-server') ?? (existsSync(local) ? local : null);
}

export interface PrestoLane {
  pid: number;
  port: number;
  url: string;
  home: string;
}

/**
 * Starts the server detached in its own process group and waits for `/health`. `home` is created;
 * its `server.log` is the record. Throws when the binary or the native bb is missing, or the server
 * never answers — the caller decides whether the lane is optional.
 */
export async function startPrestoServer(o: {
  lane: Omit<ClaimOptions, 'service'>;
  home: string;
}): Promise<PrestoLane> {
  const binary = prestoServerBinary();
  if (!binary)
    throw new Error('presto-server is not installed (tools/localnet/bin/install-presto-server.sh)');
  const bb = nativeBbPath();
  if (!existsSync(bb)) throw new Error(`native bb missing at ${bb}`);
  const port = await claim({ ...o.lane, service: 'presto' });
  mkdirSync(o.home, { recursive: true });
  const log = openSync(join(o.home, 'server.log'), 'w');
  const child: ChildProcess = spawn(binary, ['--port', String(port)], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, PRESTO_HOME: o.home, BB_BINARY_PATH: bb, AZTEC_BB_VERSION: pin },
  });
  child.unref();
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60 && child.exitCode === null; i++) {
    const up = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) }).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return { pid: child.pid as number, port, url, home: o.home };
    await delay(500);
  }
  await stopPrestoServer(child.pid as number);
  throw new Error(`presto-server did not answer on ${url} (see ${o.home}/server.log)`);
}

/** SIGTERM to the group, up to 8 s for Presto to end its bb child (it gives that 5 s), then SIGKILL. */
export async function stopPrestoServer(pid: number): Promise<void> {
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 16 && alive(); i++) await delay(500);
  if (alive()) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* gone meanwhile */
    }
  }
}
