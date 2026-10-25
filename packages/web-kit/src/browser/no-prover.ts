// What the read-only apps resolve the proving packages to: nothing of bb.js or the Noir WASM ships
// with a page that never proves. aztec.js binds these names at import; touching one is a bug that
// says so instead of a 4 MB download.
const gone = (name: string) =>
  new Proxy(() => undefined, {
    get: () => {
      throw new Error(`this page has no prover: ${name} is not part of its bundle`);
    },
    apply: () => {
      throw new Error(`this page has no prover: ${name} is not part of its bundle`);
    },
    construct: () => {
      throw new Error(`this page has no prover: ${name} is not part of its bundle`);
    },
  });

export const Barretenberg = gone('Barretenberg');
export const BarretenbergSync = gone('BarretenbergSync');
export const BN254_G1_GENERATOR = gone('BN254_G1_GENERATOR');
export const BN254_G2_GENERATOR = gone('BN254_G2_GENERATOR');
export const flattenChonkProofFields = gone('flattenChonkProofFields');
export const randomBytes = gone('randomBytes');
export const serializeWitness = gone('serializeWitness');

/** Data, not proving: the SDK tags circuits with it at import. bb.js's enum, names and values both ways. */
export const CircuitKind = {
  App: 0,
  Kernel: 1,
  HidingKernel: 2,
  0: 'App',
  1: 'Kernel',
  2: 'HidingKernel',
} as const;
