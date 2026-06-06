import { createAnimations } from '@tamagui/animations-reanimated';
import { defaultConfig } from '@tamagui/config/v5';
import { createTamagui } from 'tamagui';

const animations = createAnimations({
  '60ms': { type: 'timing', duration: 60 },
  '100ms': { type: 'timing', duration: 100 },
  '120ms': { type: 'timing', duration: 120 },
  '150ms': { type: 'timing', duration: 150 },
  '200ms': { type: 'timing', duration: 200 },
  quick: { damping: 20, mass: 1.2, stiffness: 250 },
});

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  animations,

  settings: {
    ...defaultConfig.settings,
    onlyAllowShorthands: false,
    fastSchemeChange: false,
  },
});

export type Conf = typeof tamaguiConfig;
declare module 'tamagui' {
  interface TamaguiCustomConfig extends Conf {}
}
