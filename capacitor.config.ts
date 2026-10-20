import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.silencio.fourwdcontroller",
  appName: "4WD Controller",
  webDir: "out",
  server: {
    androidScheme: "https",
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
