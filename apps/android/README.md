# StoneOS Android APK

Capacitor shell around the same PWA. The API is unchanged.

```bash
cd apps/android
npx cap add android
npx cap sync android
```

`capacitor.config.json` points the WebView at the factory PWA (`http://10.0.2.2:3000` for the Android emulator). Change `server.url` to the HTTPS origin before a production APK.

Debug APK (unsigned):

```bash
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
cd apps/android/android
gradlew assembleDebug
```

The APK is `apps/android/android/app/build/outputs/apk/debug/app-debug.apk` (gitignored). Signed release builds stay in Android Studio.
