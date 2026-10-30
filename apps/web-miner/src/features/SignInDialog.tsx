import { cn, Dialog, DialogContent, DialogTitle } from '@yacana/ui';
import { keysAllowed } from '@yacana/web-kit/browser/host';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import type { MasterRecord } from '../keys/store';
import type { OpeningStep } from '../opening-steps';
import { navigate } from '../routes';
import type { Session } from '../session';
import { type AccountError, type Boot, bootAtom, mineIntentAtom, signInAtom } from '../state';
import { Create } from './account/Create';
import { LogIn } from './account/LogIn';
import { Opening, OpeningFailed } from './account/Opening';
import { Start } from './account/Start';
import { Welcome } from './account/Welcome';
import { WordsBackup } from './account/Words';
import { WordsLogIn } from './account/WordsLogIn';
import { FITS_WINDOW } from './dialogs/Frame';
import { SignOutDialog } from './SignOutDialog';

type Screen = 'start' | 'create' | 'login' | 'words' | 'words-login' | 'welcome';

interface Flow {
  session: Session;
  error?: AccountError;
  busy: boolean;
  canCreate: boolean;
  /** A fresh phrase for the Words screen; kept by the dialog, so an attempt's failure returns to the same words. */
  phrase: string;
  newWords: () => void;
  go: (s: Screen) => void;
  attempt: (from: Screen, run: () => Promise<void>) => Promise<void>;
  notNow: () => void;
}

/** Welcome, with "Use a different account" as the sign-out dialog over it. */
function Stored({ record, flow }: { record: MasterRecord; flow: Flow }) {
  const [other, setOther] = useState(false);
  return (
    <>
      <Welcome
        record={record}
        error={flow.error}
        busy={flow.busy}
        onOpen={() => flow.attempt('welcome', () => flow.session.open(record))}
        onNotNow={flow.notNow}
        onOther={() => setOther(true)}
      />
      <SignOutDialog
        record={record}
        open={other}
        onOpenChange={setOther}
        onSignOut={() => flow.session.forget(record)}
        onBackUp={() => {
          setOther(false);
          // The words are sealed until the account opens: the backup is the wallet's, on the way to Sign out.
          void flow.attempt('welcome', async () => {
            await flow.session.open(record);
            if (flow.session.record?.id === record.id) navigate('wallet', 'backup');
          });
        }}
      />
    </>
  );
}

function Screens({ current, flow }: { current: Screen; flow: Flow }) {
  const { session, error, busy, canCreate, phrase, newWords, go, attempt, notNow } = flow;
  switch (current) {
    case 'create':
      return (
        <Create
          error={error}
          busy={busy}
          onPasskey={() => attempt('create', () => session.createWithPasskey())}
          onWords={() => {
            newWords();
            go('words');
          }}
          onBack={() => go('start')}
        />
      );
    case 'login':
      return (
        <LogIn
          error={error}
          busy={busy}
          oldOrigin={!canCreate}
          onPasskey={() => attempt('login', () => session.restoreWithPasskey())}
          onWords={() => go('words-login')}
          onBack={canCreate ? () => go('start') : undefined}
        />
      );
    case 'words':
      return (
        <WordsBackup
          phrase={phrase}
          error={error}
          onDone={() => attempt('words', () => session.createWithWords(phrase, true))}
          onSkip={() => attempt('words', () => session.createWithWords(phrase, false))}
          onBack={() => go('create')}
        />
      );
    case 'words-login':
      return (
        <WordsLogIn
          error={error}
          busy={busy}
          onOpen={(text) => attempt('words-login', () => session.restoreWithWords(text))}
          onBack={() => go('login')}
        />
      );
    default:
      return <Start onCreate={() => go('create')} onLogIn={() => go('login')} onNotNow={notNow} />;
  }
}

/** A device with an account gets Welcome whatever screen was open; without one, the screen chosen, else the first. */
const screenFor = (stored: MasterRecord | null, chosen: Screen | null, canCreate: boolean): Screen =>
  stored ? 'welcome' : (chosen ?? (canCreate ? 'start' : 'login'));

/** The note belongs to the screen whose attempt failed; Welcome also shows a create's that staged its record. */
const errorFor = (boot: Boot, errorOn: Screen | null, current: Screen): AccountError | undefined =>
  boot.phase === 'signedOut' && (errorOn === current || current === 'welcome') ? boot.error : undefined;

type SignedOut = Extract<Boot, { phase: 'signedOut' }>;
type Failed = SignedOut & { opening: OpeningStep[]; error: AccountError };

/** What the dialog holds: the checklist while opening or after a step failed, else the account's screen. */
function Body({
  boot,
  failed,
  stored,
  current,
  flow,
  onCancelFailed,
}: {
  boot: Boot;
  failed: Failed | null;
  stored: MasterRecord | null;
  current: Screen;
  flow: Flow;
  onCancelFailed: () => void;
}) {
  const { session } = flow;
  if (boot.phase === 'opening')
    return <Opening steps={boot.steps} onCancel={() => void session.cancelOpening()} />;
  if (failed && stored)
    return (
      <OpeningFailed
        steps={failed.opening}
        error={failed.error}
        onRetry={() => flow.attempt('welcome', () => session.open(stored, failed.typedWords))}
        onChangeNode={() => navigate('settings')}
        onCancel={onCancelFailed}
      />
    );
  if (boot.phase !== 'signedOut') return null;
  return stored ? <Stored record={stored} flow={flow} /> : <Screens current={current} flow={flow} />;
}

/** The checklist a step failed on; Cancel strips it from the boot (`hideOpeningFailure`). */
const failedOpening = (boot: Boot): Failed | null =>
  boot.phase === 'signedOut' && boot.opening && boot.error?.step ? (boot as Failed) : null;

/**
 * The account dialog over the cockpit. Signed out, Escape, the veil and "Just watch for now" are one
 * action: dismiss (the cockpit's buttons reopen it). A device with an account gets Welcome, whatever
 * screen was open: a create that staged its record and failed is finished from there, never
 * repeated. Opening, nothing dismisses it — a click on the veil must not abort an account open —
 * and it closes when the account is ready. Cancel inside it aborts once the ceremony is over.
 */
export function SignInDialog({ session }: { session: Session }) {
  const boot = useAtomValue(bootAtom);
  const [wanted, setWanted] = useAtom(signInAtom);
  const setIntent = useSetAtom(mineIntentAtom);
  const opening = boot.phase === 'opening';
  const signedOut = boot.phase === 'signedOut';
  const open = opening || (signedOut && wanted);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [phrase, setPhrase] = useState('');
  /** The screen whose attempt failed: its note stays there and nowhere else. */
  const [errorOn, setErrorOn] = useState<Screen | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) return;
    setScreen(null);
    setPhrase('');
    setErrorOn(null);
  }, [open]);
  const canCreate = keysAllowed(location.hostname, 'create');
  const stored = signedOut ? (boot.slot.record ?? boot.slot.staged) : null;
  const current = screenFor(stored, screen, canCreate);
  const flow: Flow = {
    session,
    error: errorFor(boot, errorOn, current),
    busy,
    canCreate,
    phrase,
    newWords: () => setPhrase(session.newWords()),
    go: (s) => {
      setScreen(s);
      setErrorOn(null);
    },
    attempt: (from, run) => {
      setErrorOn(from);
      setBusy(true);
      return run().finally(() => setBusy(false));
    },
    notNow: () => close(),
  };
  // Leaving the dialog forgets why it was opened: a later Start mining sets the intent again.
  const close = () => {
    setIntent(false);
    setWanted(false);
  };
  const dismiss = (e: Event) => (opening ? e.preventDefault() : close());
  const failed = failedOpening(boot);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !opening && close()}>
      <DialogContent
        hideClose
        size="tx"
        overlayClassName="bg-[rgba(10,10,11,.42)]"
        className={cn(FITS_WINDOW, 'shadow-[0_24px_80px_rgba(0,0,0,.6)]')}
        onEscapeKeyDown={dismiss}
        onInteractOutside={dismiss}
        aria-describedby={undefined}
        data-testid="sign-in"
      >
        <DialogTitle className="sr-only">{opening ? 'Opening your account' : 'Account'}</DialogTitle>
        <Body
          boot={boot}
          failed={failed}
          stored={stored}
          current={current}
          flow={flow}
          onCancelFailed={() => {
            session.hideOpeningFailure();
            close();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
