import { afterEach, expect, test, vi } from 'vitest';
import { saveJson } from './download';

afterEach(() => vi.restoreAllMocks());

test('saveJson clicks an anchor named for the file on a blob of indented JSON, then revokes its URL', async () => {
  const made: Blob[] = [];
  const revoked: string[] = [];
  // jsdom has no blob URLs.
  URL.createObjectURL = (b: Blob) => {
    made.push(b);
    return 'blob:saved';
  };
  URL.revokeObjectURL = (u: string) => {
    revoked.push(u);
  };
  const clicked: { name: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ name: this.download, href: this.href });
  });
  saveJson('funding.json', { v: 1, hint: { amountIn: '5' } });
  expect(clicked).toEqual([{ name: 'funding.json', href: 'blob:saved' }]);
  expect(revoked).toEqual(['blob:saved']);
  expect(made[0]?.type).toBe('application/json');
  expect(await made[0]?.text()).toBe('{\n  "v": 1,\n  "hint": {\n    "amountIn": "5"\n  }\n}');
});
