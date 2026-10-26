/// <reference types="vite/client" />

// Every value is a build-time constant from web-kit (deployments/site.env + the deployment record).
interface ImportMetaEnv {
  readonly VITE_SITE_MODE: 'production' | 'e2e' | 'dev';
  readonly VITE_AZTEC_NODE_URL: string;
  readonly VITE_RP_ID: string;
  /** `<label>` + this suffix are this project's Workers previews; '' outside production builds. */
  readonly VITE_PREVIEW_HOST_SUFFIX: string;
  readonly VITE_SOURCE_COMMIT: string;
  readonly VITE_BB_VERSION: string;
  readonly VITE_CHAIN_ID: string;
  readonly VITE_ROLLUP_VERSION: string;
  /** The version's Registry index, empty until the portal registered it. */
  readonly VITE_VERSION_INDEX: string;
  readonly VITE_ROLLUP_ADDRESS: string;
  readonly VITE_YACANA_MINER: string;
  readonly VITE_YACANA_TOKEN: string;
  readonly VITE_YACANA_MINER_CLASS: string;
  readonly VITE_YACANA_TOKEN_CLASS: string;
  readonly VITE_E2E_QUERY_OVERRIDES: string;
  /** The e2e lane's headless Presto port (plaintext); empty in production. */
  readonly VITE_PRESTO_E2E_PORT: string;
  /** '1' when the wallet's PXE must not prove (e2e builds only); '' otherwise. */
  readonly VITE_E2E_PROVERLESS: string;
  readonly VITE_LAUNCH_MODE: string;
  readonly VITE_EXPLORER_URL: string;
  /** The recorded example claim as JSON, or '' when the profile has none. */
  readonly VITE_EXAMPLE_CLAIM: string;
  /** JSON of the deployment record the build was made for. */
  readonly VITE_DEPLOYMENT_RECORD: string;
  /** The default Ethereum JSON-RPC; a user may pick another from the miner's settings. */
  readonly VITE_ETH_RPC_URL: string;
  /** The Ethereum explorer's origin, or `off`. */
  readonly VITE_L1_EXPLORER_URL: string;
  /** Where this version's last build lives after a flip ('' until a move gives it one); the `versioned` host. */
  readonly VITE_OLD_APP_ORIGIN: string;
  readonly VITE_APP_ROLE: 'apex' | 'old';
  /** JSON of the record's announced migration, or '' when none is announced. */
  readonly VITE_MIGRATION: string;
  /** The record's lifecycle notes as JSON, or empty: the old origin's stop and node retirement. */
  readonly VITE_LIFECYCLE: string;
  /** JSON of the record's portal block, or '' before the L1 deploy. */
  readonly VITE_BRIDGE: string;
  /** The first epoch this miner has: '0', or a continuation's start. Every epoch read floors here. */
  readonly VITE_FIRST_EPOCH: string;
}
