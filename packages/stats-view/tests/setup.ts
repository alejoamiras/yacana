import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// The build defines these from apps/site; the component tests run without that config.
const record = {
  chainId: '31337',
  rollupVersion: '1',
  miner: '0x0000000000000000000000000000000000000000000000000000000000000001',
  token: '0x0000000000000000000000000000000000000000000000000000000000000002',
  minerClassId: '0x03',
  tokenClassId: '0x04',
};
vi.stubEnv('VITE_SITE_MODE', 'e2e');
vi.stubEnv('VITE_EXPLORER_URL', 'https://testnet.aztecscan.xyz');
vi.stubEnv('VITE_SOURCE_COMMIT', 'abcdef0123456789');
vi.stubEnv('VITE_DEPLOYMENT_RECORD', JSON.stringify(record));
// jsdom has no matchMedia; the charts' reduced-motion hook reads it.
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
}));
