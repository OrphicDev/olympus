"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("olympus", {
  checkEnv: () => ipcRenderer.invoke("env:check"),
  // Pegasus
  pegasusStatus: () => ipcRenderer.invoke("pegasus:status"),
  installPegasus: (code) => ipcRenderer.invoke("pegasus:install", code),
  // Zevs
  zevsStatus: () => ipcRenderer.invoke("zevs:status"),
  installZevs: () => ipcRenderer.invoke("zevs:install"),
  openZevs: () => ipcRenderer.invoke("zevs:open"),
  onZevsProgress: (cb) => ipcRenderer.on("zevs:progress", (_e, d) => cb(d)),
  // Titan (dev — super admin)
  titanStatus: () => ipcRenderer.invoke("titan:status"),
  pickTitanFolder: () => ipcRenderer.invoke("titan:pickFolder"),
  installTitan: () => ipcRenderer.invoke("titan:install"),
  openTitan: () => ipcRenderer.invoke("titan:open"),
  onTitanProgress: (cb) => ipcRenderer.on("titan:progress", (_e, d) => cb(d)),
  // Divers
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
