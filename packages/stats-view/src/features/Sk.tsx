import { Skeleton } from '@yacana/ui';
import { useAtomValue } from 'jotai';
import type { ComponentProps } from 'react';
import { slowAtom } from '../state';

/**
 * A skeleton that stays quiet for the first 300 ms: the geometry is on the page from the first
 * paint, the shimmer only for a beat that is actually late.
 */
export function Sk(props: ComponentProps<typeof Skeleton>) {
  const slow = useAtomValue(slowAtom);
  return <Skeleton quiet={!slow} {...props} />;
}

/** The KPI sizes the canvas measured: a value block and its sub line. */
export const SK_VALUE = 'inline-block h-[22px] w-16 rounded-[4px] align-middle';
export const SK_SUB = 'mt-1 h-2.5 w-[120px]';
