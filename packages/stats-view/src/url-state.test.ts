import { describe, expect, test } from 'vitest';
import { fromSearch, selectedFromSearch, withEpoch, withFrom } from './url-state';

describe('the window in the URL', () => {
  test('?from= names the window, absent or malformed means the newest; ?epoch= rides beside it', () => {
    expect(fromSearch('')).toBeNull();
    expect(fromSearch('?from=96')).toBe(96);
    expect(fromSearch('?from=-1')).toBeNull();
    expect(fromSearch('?from=abc')).toBeNull();
    expect(fromSearch('?from=1.5')).toBeNull();
    const both = '?epoch=7&from=3&node=https%3A%2F%2Fn.test';
    expect(fromSearch(both)).toBe(3);
    expect(selectedFromSearch(both)).toBe(7);
  });

  test('writing one keeps the other and the node pin', () => {
    const url = new URL('https://yacana.test/stats?node=https%3A%2F%2Fn.test&epoch=7');
    const withWindow = withFrom(url, 3);
    expect(withWindow.searchParams.get('from')).toBe('3');
    expect(withWindow.searchParams.get('epoch')).toBe('7');
    expect(withWindow.searchParams.get('node')).toBe('https://n.test');
    const followed = withFrom(withWindow, null);
    expect(followed.searchParams.has('from')).toBe(false);
    expect(followed.searchParams.get('epoch')).toBe('7');
    const reselected = withEpoch(withWindow, null);
    expect(reselected.searchParams.has('epoch')).toBe(false);
    expect(reselected.searchParams.get('from')).toBe('3');
  });
});
