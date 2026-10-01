# StoneOS on phones and tablets

The server stays on Oracle. These are clients that talk to it and keep working
when the signal drops.

## Start here: install the PWA, not an APK

Most factories do not need a built APK. On an Android phone, open the StoneOS
address in **Chrome**, then **⋮ → Add to Home screen** (newer Chrome calls it
**Install app**). You get an app icon, no browser chrome, and the same offline
behaviour as the APK — in about ten seconds, with no build tools, no signing key
and no Play Store.

Do the same on iPhone with **Safari → Share → Add to Home Screen**. There is no
iOS shell in this repo, and the PWA is the only route there.

Build an APK only when you need something the browser cannot give you:
side-loading onto devices with no Play access, an MDM rollout, or native camera
and file integration later.

## What works without a signal

The service worker (`apps/web/public/sw.js`) caches the app shell and every page
as it is opened online. After one online visit a device can:

- open StoneOS and navigate the screens it has already seen
- record new work — cutting sessions, dispatch, muster, expenses

Writes go into the outbox (`packages/sync-client`) and flush when the network
returns. An expired session no longer destroys them: a 401 holds the queue
instead of discarding it, and the shell shows what is waiting.

What is deliberately **not** cached: live figures. Stock counts, outstanding
balances, the GST position and the dashboard are fetched every time, so nobody
acts on a stale number. Offline, those screens say so rather than lying.

## Building the APK

Needs Android Studio (or the Android SDK plus a JDK) on the machine doing the
build. The native project is generated, not committed.

```bash
cd apps/android
npx cap add android      # once — creates apps/android/android/
npx cap sync android     # after any config change
```

Debug APK, unsigned, for side-loading onto your own devices:

```powershell
# Windows
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd apps\android\android
.\gradlew assembleDebug
```

The result is `apps/android/android/app/build/outputs/apk/debug/app-debug.apk`,
which is gitignored. Copy it to the phone and allow installing from unknown
sources. Signed release builds go through Android Studio so the keystore never
lands in the repository.

## Pointing it at your server

`capacitor.config.json` holds the address the WebView loads:

```json
"server": { "url": "http://193.122.159.175", "cleartext": true }
```

Change `url` and run `npx cap sync android` again. Because this is a remote URL,
the APK is a wrapper around the live site: a web deploy reaches every phone with
no new APK, which is usually what you want.

### `cleartext: true` is a liability, not a setting to leave alone

Android 9 and later block plain HTTP by default. That flag turns the block off,
which is the only reason this works against a bare IP today — and it means every
password typed on a phone travels unencrypted, including over mobile networks.

Once the server has a hostname and TLS:

```json
"server": { "url": "https://stoneos.example.com" }
```

Drop `cleartext` entirely. Until then, treat phone access as something for the
factory's own wifi, not the open internet.

## After changing the web app

The APK loads the remote site, so a web deploy is enough — but the service worker
caches aggressively on purpose. Bump `CACHE` in `apps/web/public/sw.js` when the
shell changes, or devices keep serving the old one until they next reach the
network. The `activate` handler deletes every cache except the current name, so a
bumped version cleans up after itself.
