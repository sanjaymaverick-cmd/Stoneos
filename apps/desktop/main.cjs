const { app, BrowserWindow } = require("electron");

const WEB_ORIGIN = process.env.STONEOS_WEB_URL || "http://localhost:3000";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: require("path").join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });
  win.loadURL(WEB_ORIGIN);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
