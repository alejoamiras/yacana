import { Provider, useAtomValue, useStore } from 'jotai';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { MinerController } from '../controller';
import { pipWindowAtom } from '../pip';
import { PipView } from './LoopTile';

/**
 * Renders the mini window's view into it while one is open, whatever the route: mounted once by the
 * shell, so moving between pages neither closes the window nor empties it.
 */
export function PipHost({
  controller,
  onStart,
}: {
  controller: () => MinerController | undefined;
  onStart: () => void;
}) {
  const store = useStore();
  const pip = useAtomValue(pipWindowAtom);
  useEffect(() => {
    if (!pip) return;
    const root = createRoot(pip.document.body);
    root.render(
      <Provider store={store}>
        <PipView controller={controller} onStart={onStart} win={pip} />
      </Provider>,
    );
    return () => root.unmount();
  }, [pip, store, controller, onStart]);
  return null;
}
