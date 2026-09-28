import {
  ChartColumn,
  FingerprintPattern,
  type LucideIcon,
  Pickaxe,
  Settings,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type * as React from 'react';
import { cn } from '../lib/cn.ts';

export type IconName = 'mine' | 'wallet' | 'stats' | 'verify' | 'settings' | 'finger';

const GLYPHS: Record<IconName, LucideIcon> = {
  mine: Pickaxe,
  wallet: Wallet,
  stats: ChartColumn,
  verify: ShieldCheck,
  settings: Settings,
  finger: FingerprintPattern,
};

export function Icon({
  name,
  size = 14,
  className,
  ...props
}: Omit<React.ComponentProps<'svg'>, 'name'> & { name: IconName; size?: number }) {
  const Glyph = GLYPHS[name];
  return (
    <Glyph
      data-slot="icon"
      data-icon={name}
      size={size}
      strokeWidth={1.5}
      aria-hidden
      className={cn('shrink-0', className)}
      {...props}
    />
  );
}
