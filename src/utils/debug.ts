/**
 * Debug utilities — only active when VITE_DEBUG=true
 */

export const DEBUG = import.meta.env.VITE_DEBUG === 'true';

export async function debugCapture(label: string): Promise<void> {
  if (!DEBUG) return;
  if (typeof window === 'undefined' || !window.electronAPI?.debugScreenshot) return;
  try {
    await window.electronAPI.debugScreenshot(label);
  } catch {
    // ignore screenshot failures
  }
}
