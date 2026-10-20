import { existsSync, readFileSync, writeFileSync } from "node:fs";

const path = "android/app/src/main/AndroidManifest.xml";
if (!existsSync(path)) {
  console.error("Generate the Android project first with: npx cap add android");
  process.exit(1);
}
let manifest = readFileSync(path, "utf8");
if (!manifest.includes("android.permission.INTERNET")) {
  manifest = manifest.replace("</manifest>", '    <uses-permission android:name="android.permission.INTERNET"/>\n</manifest>');
}
if (!manifest.includes("android:usesCleartextTraffic")) {
  manifest = manifest.replace(/<application\b/, '<application android:usesCleartextTraffic="true"');
}
if (!manifest.includes("android:screenOrientation")) {
  manifest = manifest.replace(/<activity\b/, '<activity android:screenOrientation="landscape"');
}
writeFileSync(path, manifest, "utf8");
console.log("Applied Android landscape + cleartext localhost/robot networking permissions.");
