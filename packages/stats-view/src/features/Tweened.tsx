import { useTweenedNumber } from '@yacana/ui';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { unsettledAtom } from '../state';
import { SK_VALUE, Sk } from './Sk';

/**
 * A KPI number that glides to `value` — from 0 on its first number, a skeleton while `value` is
 * still null; while it moves, `id` sits in `unsettledAtom`, so the page can say when every number
 * is at rest. `format` renders the in-flight value (an integer stays an integer).
 */
export function Tweened({
  id,
  value,
  format = (v) => String(Math.round(v)),
}: {
  id: string;
  value: number | null;
  format?: (v: number) => string;
}) {
  const shown = useTweenedNumber(value ?? 0);
  const setUnsettled = useSetAtom(unsettledAtom);
  const settled = value === null || shown === value;
  useEffect(() => {
    setUnsettled((s) => {
      if (settled === !s.has(id)) return s;
      const next = new Set(s);
      settled ? next.delete(id) : next.add(id);
      return next;
    });
  }, [id, settled, setUnsettled]);
  useEffect(
    () => () =>
      setUnsettled((s) => {
        if (!s.has(id)) return s;
        const next = new Set(s);
        next.delete(id);
        return next;
      }),
    [id, setUnsettled],
  );
  if (value === null) return <Sk className={SK_VALUE} />;
  return <>{format(shown)}</>;
}
