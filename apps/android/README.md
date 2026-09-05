# StoneOS Android APK

Capacitor shell around the same PWA. The API is unchanged.

```bash
cd apps/web && npx next build
cd ../android
npx cap add android
npx cap sync android
npx cap open android
```

In Android Studio: Build → Generate Signed Bundle / APK.

Production builds must set `STONEOS_WEB_URL` to the HTTPS origin of the factory PWA.
