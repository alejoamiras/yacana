// Settings. The node is changed here signed out too, so the page stays free of the sign-in dialog.

import {
  Button,
  ExternalLink,
  KvRow,
  Label,
  PowerSlider,
  PrestoCard,
  Segmented,
  Switch,
  type Theme,
  Tile,
  TileBoundary,
  TileHeader,
  useTheme,
} from '@yacana/ui';
import { relyingParty } from '@yacana/web-kit/browser/host';
import { ownVersionName } from '@yacana/web-kit/browser/version-name';
import { useAtomValue, useSetAtom } from 'jotai';
import type * as React from 'react';
import { useEffect, useState } from 'react';
import { bridgeRecord, isOldRole } from '../bridge/env';
import { NodeTile } from '../components/NodeTile';
import type { Connection } from '../config';
import type { MinerController } from '../controller';
import { links } from '../explorer';
import { EthRpcTile } from '../features/EthRpcTile';
import { SignOutDialog } from '../features/SignOutDialog';
import { type PrestoView, usePresto } from '../features/use-presto';
import { apexHost, FAQ_HREF } from '../lib/apex';
import { shortAddress } from '../lib/format';
import { useTileLog } from '../lib/tile-log';
import { PRESTO_SITE } from '../presto';
import { navigate } from '../routes';
import type { Session } from '../session';
import { type BooleanSetting, useSettings } from '../settings';
import { bootAtom, signInAtom } from '../state';

function Toggle({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line py-2.5 first:border-t-0">
      <Label htmlFor={id} className="flex-col items-start gap-1">
        <span className="text-ink">{label}</span>
        {hint && <span className="text-xs font-normal text-ink-2">{hint}</span>}
      </Label>
      <Switch id={id} checked={value} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

/**
 * Presto first, then the browser prover's threads: while Presto is remembered or proving the slider
 * is shown but not in force (Presto's own speed setting decides), and says what it is for.
 */
function MiningTile({
  cores,
  threads,
  onThreads,
  presto,
  flags,
}: {
  cores: number;
  threads: number;
  onThreads: (t: number) => void;
  presto: PrestoView;
  flags: React.ReactNode;
}) {
  return (
    <Tile>
      <TileHeader>mining</TileHeader>
      {presto.configured && (
        <PrestoCard
          standing={presto.standing}
          needsLook={presto.needsLook}
          onLook={presto.look}
          onUseBrowser={presto.chooseBrowser}
          site={PRESTO_SITE}
          className="mb-3"
        />
      )}
      <div className="flex flex-col gap-2 pb-2.5">
        <PowerSlider
          cores={cores}
          threads={threads}
          onChange={onThreads}
          disabled={presto.decides}
          label="browser threads"
        />
        <p className="text-xs text-ink-2" data-testid="power-note">
          {presto.decides
            ? 'Not in use while Presto proves; Presto’s own speed setting decides. Yacana falls back to these threads if Presto drops out.'
            : 'This slider affects browser proving only; one core stays with the page.'}
        </p>
      </div>
      {flags}
    </Tile>
  );
}

/** The open account: its address and method, Stay open for a passkey, Sign out; signed out, the way in. */
function AccountTile({ session }: { session: Session }) {
  const boot = useAtomValue(bootAtom);
  const openSignIn = useSetAtom(signInAtom);
  const [signOut, setSignOut] = useState(false);
  if (boot.phase !== 'ready')
    return (
      <Tile>
        <TileHeader>account</TileHeader>
        <p className="text-xs text-ink-2">Open an account to see its options.</p>
        {/* Settings stays free of the sign-in dialog (the node is changed here); this is the way in. */}
        <Button
          size="sm"
          variant="uv"
          className="mt-3"
          onClick={() => {
            openSignIn(true);
            navigate('mine');
          }}
          data-testid="sign-in-settings"
        >
          Sign in
        </Button>
      </Tile>
    );
  const record = boot.record;
  return (
    <Tile>
      <TileHeader>account</TileHeader>
      <div className="flex items-center justify-between gap-3 pb-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span data-testid="settings-account">
            <ExternalLink
              href={links.address(boot.account)}
              full={boot.account}
              className="font-mono text-sm text-ink"
            >
              {shortAddress(boot.account)}
            </ExternalLink>
          </span>
          <span className="text-xs text-ink-3">
            {record.method === 'passkey' ? 'passkey' : '12 words'}
            {isOldRole() ? ` · the same account as ${apexHost()}` : ''}
          </span>
        </div>
        <Button size="sm" onClick={() => setSignOut(true)} data-testid="sign-out">
          Sign out
        </Button>
      </div>
      {record.method === 'passkey' && (
        <Toggle
          id="stay-open"
          label="Stay open on this device"
          hint="On: anyone who can use this browser could open and spend from this account without your passkey. Off: one touch per open."
          value={!record.askEveryOpen}
          onChange={(v) => void session.setStayOpen(v)}
        />
      )}
      <SignOutDialog
        record={record}
        open={signOut}
        onOpenChange={setSignOut}
        onSignOut={() => session.forget(record)}
        onBackUp={() => {
          setSignOut(false);
          navigate('wallet', 'backup');
        }}
      />
    </Tile>
  );
}

function AboutTile() {
  const old = isOldRole();
  return (
    <Tile>
      <TileHeader>about</TileHeader>
      {old && <KvRow label="this origin" value={`${location.host} · retired`} />}
      <KvRow label="source" value={import.meta.env.VITE_SOURCE_COMMIT.slice(0, 12)} />
      <KvRow label="build" value={import.meta.env.VITE_SITE_MODE} />
      <KvRow label="bb.js" value={import.meta.env.VITE_BB_VERSION} />
      <KvRow label="relying party" value={relyingParty(location.hostname)} />
      <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3" data-testid="about-line">
        {old
          ? `The old app, kept so what is still on ${ownVersionName()} can leave. Yacana runs in your browser; whoever serves this page controls it.`
          : 'Yacana runs in your browser. Whoever serves this page controls it; the source is public — run your own build if that matters.'}{' '}
        <ExternalLink href={FAQ_HREF} className="font-sans whitespace-nowrap text-ink-2">
          More on /faq
        </ExternalLink>
      </p>
    </Tile>
  );
}

export function Settings({
  connection,
  controller,
  session,
}: {
  connection: Connection;
  controller: () => MinerController | undefined;
  session: Session;
}) {
  const [s, set] = useSettings();
  const { setTheme } = useTheme();
  const onError = useTileLog();
  // The node in use follows a live switch; `connection` is what the page booted with.
  const [nodeUrl, setNodeUrl] = useState(session.nodeUrl ?? connection.nodeUrl);
  const [ethRpcUrl, setEthRpcUrl] = useState(session.ethRpcUrl);
  const cores = navigator.hardwareConcurrency || 2;
  const threads = s.threads ?? Math.max(1, cores - 1);
  const presto = usePresto(session);
  useEffect(() => setTheme(s.theme), [s.theme, setTheme]);
  // Notifications need the browser's permission, asked for on the toggle (a user gesture).
  const toggle = async (k: BooleanSetting, v: boolean) => {
    if (k === 'notify' && v && typeof Notification !== 'undefined' && Notification.permission !== 'granted')
      if ((await Notification.requestPermission()) !== 'granted') return;
    set({ [k]: v });
  };
  const flag = (k: BooleanSetting, id: string, label: string, hint?: string, disabled?: boolean) => (
    <Toggle
      id={id}
      label={label}
      hint={hint}
      value={s[k]}
      onChange={(v) => void toggle(k, v)}
      disabled={disabled}
    />
  );
  const canPip = 'documentPictureInPicture' in window;
  const canBattery = 'getBattery' in navigator;
  // The old origin keeps what makes the page work: the node it reads (not a setting there), the RPC, the account.
  const old = isOldRole();
  return (
    <div className={old ? 'mx-auto flex w-full max-w-[760px] flex-col gap-4' : 'grid gap-4 md:grid-cols-2'}>
      <TileBoundary name="network" onError={onError} className="md:col-span-2">
        <Tile className="md:col-span-2">
          <TileHeader aside={old ? undefined : 'chain reads and claims go through the node'}>
            network
          </TileHeader>
          <div className="grid gap-3">
            <NodeTile
              session={session}
              nodeUrl={nodeUrl}
              onSwitched={() => setNodeUrl(session.nodeUrl ?? nodeUrl)}
              readOnly={old}
            />
            {bridgeRecord() && (
              <EthRpcTile
                session={session}
                ethRpcUrl={ethRpcUrl}
                onSwitched={() => setEthRpcUrl(session.ethRpcUrl)}
              />
            )}
          </div>
        </Tile>
      </TileBoundary>
      {!old && (
        <TileBoundary name="mining" onError={onError}>
          <MiningTile
            cores={cores}
            threads={threads}
            presto={presto}
            onThreads={(t) => {
              set({ threads: t });
              controller()?.reconfigure(t);
            }}
            flags={
              <>
                {flag(
                  'pauseOnBattery',
                  'pause-battery',
                  'Pause on battery',
                  canBattery ? undefined : 'not reported by this browser',
                  !canBattery,
                )}
                {flag(
                  'backgroundProving',
                  'background',
                  'Keep proving in a background tab',
                  'off: mining pauses while the tab is hidden',
                )}
                {flag('resumeOnOpen', 'resume', 'Resume mining when the page opens')}
              </>
            }
          />
        </TileBoundary>
      )}
      {!old && (
        <TileBoundary name="alerts" onError={onError}>
          <Tile>
            <TileHeader>alerts</TileHeader>
            {flag('notify', 'notify', 'Notify on a win', 'no amounts in the notification')}
            {flag('sound', 'sound', 'Sound on a win')}
            {flag('tabStatus', 'tab-status', 'Report in the tab title and icon')}
            {flag(
              'pipOnStart',
              'pip-on-start',
              'Open the mini window when mining starts',
              canPip
                ? "your Start click opens it; browsers don't let a page open it when you switch tabs"
                : 'not supported by this browser',
              !canPip,
            )}
          </Tile>
        </TileBoundary>
      )}
      <TileBoundary name="account" onError={onError}>
        <AccountTile session={session} />
      </TileBoundary>
      <TileBoundary name="appearance" onError={onError}>
        <Tile>
          <TileHeader>appearance</TileHeader>
          <Segmented
            value={s.theme}
            onChange={(theme) => set({ theme })}
            options={THEMES}
            aria-label="theme"
          />
        </Tile>
      </TileBoundary>
      <TileBoundary name="about" onError={onError} className="md:col-span-2">
        <AboutTile />
      </TileBoundary>
    </div>
  );
}
