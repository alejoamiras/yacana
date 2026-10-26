// The Aztec node's row in Settings. The health store is the row's only source of words: the tile
// never probes on its own; the setting is saved only once the switch took.

import { Button, Input, StatusChip, type Step, Stepper } from '@yacana/ui';
import {
  defaultNodeUrl,
  isDefaultNode,
  isPinnedByQuery,
  saveConnection,
} from '@yacana/web-kit/browser/connection';
import { parseNodeUrl } from '@yacana/web-kit/browser/node';
import {
  nodeHealth,
  retryNode,
  standing,
  subscribeNodeHealth,
  tipAgeS,
} from '@yacana/web-kit/browser/node-health';
import { useAtomValue } from 'jotai';
import { useReducer, useSyncExternalStore } from 'react';
import {
  type EditState,
  editReducer,
  probeFailure,
  rebuildFailure,
  rowWords,
  saving,
} from '../lib/node-check';
import type { Session } from '../session';
import { bootAtom, minerAtom, nowAtom } from '../state';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const host = (url: string) => new URL(url).host;

/** The stepper under the field while a save runs: reachable, this deployment, switching. */
export const saveSteps = (state: EditState): Step[] => {
  const probing = state.kind === 'probing';
  const latency = state.kind === 'switching' ? `${(state.latencyMs / 1000).toFixed(1)} s` : undefined;
  return [
    { id: 'reachable', label: 'Reachable', state: probing ? 'active' : 'done', right: latency },
    { id: 'deployment', label: 'This deployment', state: probing ? 'pending' : 'done' },
    {
      id: 'switching',
      label: 'Switching',
      state: probing ? 'pending' : 'active',
      detail: probing
        ? undefined
        : "Rebuilding your view of the chain from the new node. Mining pauses until it's done.",
      right: probing ? undefined : 'about a minute',
    },
  ];
};

function Row({
  nodeUrl,
  onChange,
  onDefault,
}: {
  nodeUrl: string;
  /** Absent, the row reports and offers no way to another node: the old origin's node is the version's, not a setting. */
  onChange?: () => void;
  onDefault: () => void;
}) {
  const health = useSyncExternalStore(subscribeNodeHealth, nodeHealth, nodeHealth);
  const now = useAtomValue(nowAtom);
  const notice = useAtomValue(minerAtom).notice?.kind;
  const pinned = isPinnedByQuery();
  const state = standing(health, now);
  const words = rowWords(
    state,
    health,
    now,
    tipAgeS(health, now),
    notice === 'offline' || notice === 'behind',
  );
  const isDefault = isDefaultNode(nodeUrl);
  return (
    <div className="flex items-start justify-between gap-4" data-testid="node-row" data-standing={state}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2.5 text-sm">
          <span>Aztec node</span>
          <StatusChip tone={words.chip.tone} data-testid="node-chip">
            {words.chip.word}
          </StatusChip>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs text-ink-2">
          <span data-testid="node-in-use">{host(nodeUrl)}</span>
          {isDefault ? (
            <span className="text-ink-3">· default</span>
          ) : (
            <>
              <span className="text-ink-3">· custom</span>
              {onChange && (
                <Button variant="link" className="text-xs" onClick={onDefault} data-testid="node-default">
                  Use the default
                </Button>
              )}
            </>
          )}
        </div>
        <div className="font-mono text-2xs text-ink-3" data-testid="node-line">
          {words.line}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {words.retry && (
          <Button size="sm" onClick={retryNode} data-testid="node-retry">
            Retry
          </Button>
        )}
        {onChange && (
          <Button size="sm" onClick={onChange} disabled={pinned} data-testid="node-change">
            Change
          </Button>
        )}
        {onChange && pinned && <span className="text-2xs text-ink-3">set by the page URL</span>}
      </div>
    </div>
  );
}

function Field({
  state,
  dispatch,
  onSave,
}: {
  state: Exclude<EditState, { kind: 'row' }>;
  dispatch: (e: Parameters<typeof editReducer>[1]) => void;
  onSave: (url: string) => void;
}) {
  const busy = saving(state);
  const opening = useAtomValue(bootAtom).phase === 'opening';
  const error = state.kind === 'editing' ? state.error : undefined;
  return (
    <div className="flex flex-col gap-2" data-testid="node-edit">
      <span className="text-sm">Aztec node</span>
      <div className="flex gap-2">
        <Input
          id="node-url"
          className="font-mono"
          value={state.url}
          placeholder="https://…"
          disabled={busy}
          onChange={(e) => dispatch({ type: 'edit', url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) onSave(state.url);
          }}
          data-testid="node-url"
        />
        <Button
          variant="primary"
          disabled={busy || opening || !state.url.trim()}
          onClick={() => onSave(state.url)}
          data-testid="node-save"
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => dispatch({ type: 'cancel' })}
          data-testid="node-cancel"
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-warn" data-testid="node-error">
          {error}
        </p>
      ) : (
        <p className="text-xs text-ink-3">
          {opening ? (
            'An account is opening: finish or cancel the sign-in first.'
          ) : (
            <>
              Any https node on this deployment.{' '}
              <button
                type="button"
                className="text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink-2"
                disabled={busy}
                onClick={() => dispatch({ type: 'edit', url: defaultNodeUrl() })}
                data-testid="node-fill-default"
              >
                Use the default
              </button>
            </>
          )}
        </p>
      )}
      {busy && <Stepper steps={saveSteps(state)} data-testid="node-stepper" />}
    </div>
  );
}

/** Settings → Network → Aztec node: the row, its edit, and the save that probes then switches. */
export function NodeTile({
  session,
  nodeUrl,
  onSwitched,
  readOnly = false,
}: {
  session: Session;
  nodeUrl: string;
  onSwitched: () => void;
  readOnly?: boolean;
}) {
  const [state, dispatch] = useReducer(editReducer, { kind: 'row' });
  const save = async (typed: string) => {
    // The node in use when the save began: what "Kept …" names, whatever the tile shows meanwhile.
    const former = nodeUrl;
    let url: string;
    try {
      url = parseNodeUrl(typed, import.meta.env.VITE_SITE_MODE).href;
    } catch (e) {
      dispatch({ type: 'probe', url: typed });
      return dispatch({ type: 'failed', url: typed, message: probeFailure(message(e), host(nodeUrl)) });
    }
    dispatch({ type: 'edit', url });
    dispatch({ type: 'probe', url });
    try {
      const probe = await session.probeNode(url);
      dispatch({ type: 'reachable', url, latencyMs: probe.latencyMs });
    } catch (e) {
      return dispatch({ type: 'failed', url, message: probeFailure(message(e), host(nodeUrl)) });
    }
    try {
      await session.switchNode(url);
    } catch (e) {
      // `kept: false` is a switch that could rebuild from neither node: nothing was kept.
      const kept = (e as { kept?: boolean }).kept === false ? null : host(former);
      return dispatch({ type: 'failed', url, message: rebuildFailure(host(url), message(e), kept) });
    }
    // The live node moved: the tile follows it now. The setting is saved only after the switch, so a
    // failed switch never leaves storage pointing at a node the page never took.
    onSwitched();
    if (!saveConnection({ nodeUrl: url }))
      return dispatch({
        type: 'failed',
        url,
        message:
          'Now in use, but the browser refused to save it; free some site storage so it sticks on reload.',
      });
    dispatch({ type: 'saved' });
  };
  return (
    <div className="rounded-[8px] border border-line-2 px-3.5 py-3">
      {state.kind === 'row' ? (
        <Row
          nodeUrl={nodeUrl}
          onChange={readOnly ? undefined : () => dispatch({ type: 'change', url: '' })}
          onDefault={() => {
            dispatch({ type: 'change', url: defaultNodeUrl() });
            void save(defaultNodeUrl());
          }}
        />
      ) : (
        <Field state={state} dispatch={dispatch} onSave={(url) => void save(url)} />
      )}
    </div>
  );
}
