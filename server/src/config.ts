export const config = {
  watchDir: process.env.PHONEDECK_WATCH_DIR ?? "C:\\fileshare\\incoming",
  port: Number(process.env.PHONEDECK_PORT ?? 8080),
  phoneTargetDir: process.env.PHONEDECK_PHONE_TARGET ?? "/sdcard/DCIM/Camera/",
  adbPath: process.env.PHONEDECK_ADB ?? "adb",
  scrcpyPath: process.env.PHONEDECK_SCRCPY ?? "scrcpy",
};
