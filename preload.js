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
  // Auth + membres
  authSession: () => ipcRenderer.invoke("auth:session"),
  authLogin: (email, password) => ipcRenderer.invoke("auth:login", email, password),
  authSetPassword: (pw) => ipcRenderer.invoke("auth:setPassword", pw),
  authLogout: () => ipcRenderer.invoke("auth:logout"),
  authNeedsBootstrap: () => ipcRenderer.invoke("auth:needsBootstrap"),
  authBootstrap: (d) => ipcRenderer.invoke("auth:bootstrap", d),
  membersList: () => ipcRenderer.invoke("members:list"),
  membersCreate: (d) => ipcRenderer.invoke("members:create", d),
  membersDelete: (id) => ipcRenderer.invoke("members:delete", id),
  membersResetPassword: (id) => ipcRenderer.invoke("members:resetPassword", id),
  membersSetRole: (id, role) => ipcRenderer.invoke("members:setRole", id, role),
  // Hermès (chat)
  chatList: (afterId) => ipcRenderer.invoke("chat:list", afterId),
  chatSend: (body) => ipcRenderer.invoke("chat:send", body),
  // Chronos (calendrier)
  chronosList: (from, to) => ipcRenderer.invoke("chronos:list", from, to),
  chronosCreate: (ev) => ipcRenderer.invoke("chronos:create", ev),
  chronosUpdate: (id, patch) => ipcRenderer.invoke("chronos:update", id, patch),
  chronosDelete: (id) => ipcRenderer.invoke("chronos:delete", id),
  // Présence
  presenceBeat: () => ipcRenderer.invoke("presence:beat"),
  presenceOnline: () => ipcRenderer.invoke("presence:online"),
  // Iris (email + CRM)
  irisStatus: () => ipcRenderer.invoke("iris:status"),
  irisConnect: (email, pass) => ipcRenderer.invoke("iris:connect", email, pass),
  irisDisconnect: () => ipcRenderer.invoke("iris:disconnect"),
  irisSend: (d) => ipcRenderer.invoke("iris:send", d),
  crmEmails: () => ipcRenderer.invoke("crm:emails"),
  crmContacts: () => ipcRenderer.invoke("crm:contacts"),
  // Contrôle par Claude Code (MCP)
  claudeStatus: () => ipcRenderer.invoke("claude:status"),
  claudeInstall: () => ipcRenderer.invoke("claude:install"),
  // Pegasus — clients connectés
  pegasusClients: () => ipcRenderer.invoke("pegasus:clients"),
  // Divers
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
