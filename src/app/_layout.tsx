import '@tamagui/native/setup-gesture-handler';
import '@tamagui/native/setup-teleport';

import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { TamaguiProvider } from 'tamagui';
import { tamaguiConfig } from '../tamagui.config';

import { setupGestureHandler } from '@tamagui/native/setup-gesture-handler';

setupGestureHandler({ pressEvents: true, sheet: true });

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <TamaguiProvider config={tamaguiConfig} defaultTheme='light'>
        <Stack />
      </TamaguiProvider>
    </GestureHandlerRootView>
  );
}
