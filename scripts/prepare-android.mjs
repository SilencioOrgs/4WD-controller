import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
if (!existsSync(manifestPath)) {
  console.error("Generate the Android project first with: npx cap add android");
  process.exit(1);
}
let manifest = readFileSync(manifestPath, "utf8");
if (!manifest.includes("android.permission.INTERNET")) {
  manifest = manifest.replace("</manifest>", '    <uses-permission android:name="android.permission.INTERNET"/>\n</manifest>');
}
if (!manifest.includes("android:usesCleartextTraffic")) {
  manifest = manifest.replace(/<application\b/, '<application android:usesCleartextTraffic="true"');
}
if (!manifest.includes("android:screenOrientation")) {
  manifest = manifest.replace(/<activity\b/, '<activity android:screenOrientation="landscape"');
}
writeFileSync(manifestPath, manifest, "utf8");

// The WebView can fill the entire landscape display rather than sit below
// Android status/navigation bars. Repeat when focus is regained after a swipe.
function findMainActivity(dir) {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const found = findMainActivity(full);
      if (found) return found;
    } else if (name === "MainActivity.java") return full;
  }
  return null;
}

const javaPath = findMainActivity("android/app/src/main/java");
if (!javaPath) {
  console.error("Could not find Capacitor Java MainActivity to enable immersive fullscreen");
  process.exit(1);
}
let source = readFileSync(javaPath, "utf8");
if (!source.includes("SYSTEM_UI_FLAG_IMMERSIVE_STICKY")) {
  source = source.replace(/import com\.getcapacitor\.BridgeActivity;/,
    'import com.getcapacitor.BridgeActivity;\nimport android.view.View;');
  source = source.replace(/}\s*$/, `
  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
        View.SYSTEM_UI_FLAG_FULLSCREEN |
        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
      );
    }
  }
}
`);
}
writeFileSync(javaPath, source, "utf8");
console.log("Applied Android landscape, fullscreen immersive UI and local HTTP networking.");
