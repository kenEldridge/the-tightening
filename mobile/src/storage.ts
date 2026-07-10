import AsyncStorage from '@react-native-async-storage/async-storage';

// Thin typed JSON wrappers over AsyncStorage (localStorage on web). All
// failures are swallowed — persistence is best-effort, never load-bearing.

export async function loadJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): void {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}
