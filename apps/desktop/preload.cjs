const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("stoneosDesktop", {
  platform: process.platform,
});
