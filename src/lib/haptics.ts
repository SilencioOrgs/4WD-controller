import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

export async function tapFeedback(enabled: boolean): Promise<void> {
  if (!enabled || typeof navigator === "undefined") return;
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Light });
    } else if ("vibrate" in navigator) {
      navigator.vibrate(12);
    }
  } catch {
    // No haptic hardware or permission; controls still work.
  }
}
