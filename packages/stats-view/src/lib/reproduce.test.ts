import { describe, expect, test } from 'vitest';
import { reproduceCommand } from './reproduce.ts';

describe('reproduceCommand', () => {
  test('quotes the node URL for the shell, a single quote included', () => {
    expect(reproduceCommand('http://127.0.0.1:1')).toBe(
      "AZTEC_NODE_URL='http://127.0.0.1:1' bun run epoch:stats",
    );
    expect(reproduceCommand('https://n.example/?key=a&net=b')).toBe(
      "AZTEC_NODE_URL='https://n.example/?key=a&net=b' bun run epoch:stats",
    );
    expect(reproduceCommand("https://n.example/it's")).toBe(
      "AZTEC_NODE_URL='https://n.example/it'\\''s' bun run epoch:stats",
    );
  });
});
