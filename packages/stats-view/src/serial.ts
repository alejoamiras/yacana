/** Chain reads run one at a time: the poll, a window fetch and a fill page must not each publish a stale whole. */
export interface Serial {
  serial: (fn: () => Promise<void>) => Promise<void>;
  /** `fn` waits its turn at most once: a call while one is queued joins it, a call during a run queues the next. */
  coalesced: (fn: () => Promise<void>) => () => Promise<void>;
}

/** One queue per runtime: a disposed instance's reads never hold up its successor's. */
export function createSerial(): Serial {
  let inFlight: Promise<void> = Promise.resolve();
  const serial = (fn: () => Promise<void>): Promise<void> => {
    const run = inFlight.then(fn);
    inFlight = run.catch(() => {});
    return run;
  };
  const coalesced = (fn: () => Promise<void>): (() => Promise<void>) => {
    let queued: Promise<void> | undefined;
    return () => {
      if (queued) return queued;
      const run = serial(() => {
        queued = undefined;
        return fn();
      });
      queued = run;
      return run;
    };
  };
  return { serial, coalesced };
}
