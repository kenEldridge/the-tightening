import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/**
 * Present the system Bluetooth MIDI pairing sheet (CABTMIDICentralViewController).
 * Resolves once the sheet is presented. No-op on non-iOS platforms.
 */
export async function presentBluetoothMidiPairing(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await requireNativeModule('MidiBlePairing').presentPairing();
}
