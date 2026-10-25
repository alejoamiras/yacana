// Bun 1.4.0 injects its `expect` into every module it transpiles under `bun test`, including
// @aztec-labs/foundation's field module, which then calls `expect.addEqualityTesters` (a Jest/Vitest API
// Bun lacks) and throws at import. A warm transpiler cache hides this locally; CI is always cold.
// Mirror the module's own fallback so the testers land where it would have put them.
import { expect } from 'bun:test';

type Tester = (a: unknown, b: unknown) => boolean | undefined;
const registry = globalThis as { __extraEqualityTesters?: Tester[] };
const api = expect as unknown as { addEqualityTesters?: (testers: Tester[]) => void };
api.addEqualityTesters ??= (testers) => {
  registry.__extraEqualityTesters ??= [];
  registry.__extraEqualityTesters.push(...testers);
};
