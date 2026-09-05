# StoneOS Windows desktop

Electron shell around the same web UI and API. It does not implement a second screen set.

```bash
npm install
npm start --workspace=@stoneos/desktop
npm run dist:win --workspace=@stoneos/desktop
```

The NSIS installer is written to `apps/desktop/dist/StoneOS Setup 0.1.0.exe` (gitignored). Set `STONEOS_WEB_URL` to the deployed PWA origin in production builds. Code signing is skipped unless `CSC_LINK` is provided.
