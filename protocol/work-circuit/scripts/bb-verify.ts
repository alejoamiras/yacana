// `bb verify` as a three-way answer. bb 5.2.0 exits 1 for a proof it refuses and for a file it
// cannot open alike, so the exit status cannot tell a refusal from a verifier that never ran: the
// diagnostic does, against a closed list, and anything off that list is not a verdict.
import { BB } from './toolchain.ts';

export interface VerifyFiles {
  proof: string;
  publicInputs: string;
  vk: string;
}

/** `wellFormed`: every element decoded and the proof failed the checks, rather than failing to parse. */
export type Verdict = { verified: true } | { verified: false; wellFormed: boolean };

/** bb gave no verdict: an input it could not read, a binary that did not run or was killed, a diagnostic never seen. */
export class OperationalError extends Error {
  readonly operational = true;
}

// bb echoes its paths (one it cannot open; every one under BB_VERBOSE, before it reads anything),
// and a path is the caller's text: it may hold any diagnostic. So a path may not break a line, an
// unreadable input is settled first, and a verdict is a whole line.
const LINE_BREAK = /[\r\n]/;
const UNREADABLE = /Unable to open file/;
const MALFORMED = [
  /^Deserialized point is not on the curve$/,
  /^Non-canonical proof element: value >= field modulus$/,
  /^Proof verification failed: invalid (proof|VK) size\b/,
  // bb's limb-range assertion on a commitment coordinate.
  /^Reason\s*: Conversion error here usually implies some bad proof serde or parsing$/,
  // A coordinate spelled at or above q (c + q for c): the native codec refuses it, the in-circuit one does not.
  /^Reason\s*: Non-canonical field element: value >= fq::modulus$/,
];
const REFUSED = /^Proof verification failed$/;

const lines = (stderr: string): string[] =>
  stderr.split('\n').map((l) => l.replace(/\(mem: [^)]*\)\s*$/, '').trim());

interface Ran {
  exitCode: number | null;
  signal: string | null;
  stderr: string;
}

async function run(files: VerifyFiles, bb: string): Promise<Ran> {
  if ([files.proof, files.publicInputs, files.vk].some((p) => LINE_BREAK.test(p)))
    throw new OperationalError('an input path holds a line break');
  try {
    const child = Bun.spawn(
      [
        bb,
        'verify',
        '-p',
        files.proof,
        '-i',
        files.publicInputs,
        '-k',
        files.vk,
        '--scheme',
        'ultra_honk',
        '-t',
        'noir-recursive-no-zk',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const stderr = await new Response(child.stderr).text();
    const exitCode = await child.exited;
    return { exitCode: child.signalCode ? null : exitCode, signal: child.signalCode, stderr };
  } catch (e) {
    throw new OperationalError(`bb did not run: ${(e as Error).message}`);
  }
}

/** Throws {@link OperationalError} unless bb answered; a refusal is a value, never a throw. */
export async function verify(files: VerifyFiles, bb: string = BB): Promise<Verdict> {
  const { exitCode, signal, stderr } = await run(files, bb);
  if (exitCode === 0) return { verified: true };
  if (exitCode === 1 && !UNREADABLE.test(stderr)) {
    const said = lines(stderr);
    if (said.some((l) => MALFORMED.some((m) => m.test(l)))) return { verified: false, wellFormed: false };
    if (said.some((l) => REFUSED.test(l))) return { verified: false, wellFormed: true };
  }
  const last = stderr.trim().split('\n').at(-1) ?? '';
  throw new OperationalError(
    `bb verify gave no verdict (exit ${exitCode}, signal ${signal ?? 'none'}): ${last}`,
  );
}
