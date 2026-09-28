import { describe, expect, test } from 'vitest';
import { routeFromPath } from './routes';

describe('routes', () => {
  test('bridge and verify by their first segment; anything else is the observatory', () => {
    // Under the test's base of `/`; production serves the app under `/stats/`.
    expect(routeFromPath('/bridge')).toBe('bridge');
    expect(routeFromPath('/bridge/')).toBe('bridge');
    expect(routeFromPath('/verify')).toBe('verify');
    expect(routeFromPath('/')).toBe('stats');
  });
});
