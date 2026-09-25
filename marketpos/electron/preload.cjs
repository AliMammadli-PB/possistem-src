const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marketSystem', {
  staff: {
    list: () => ipcRenderer.invoke('market:staff:list'),
    save: (sessionToken, profile, pin) => ipcRenderer.invoke('market:staff:save', { sessionToken, profile, pin }),
  },
  auth: {
    login: (userId, pin) => ipcRenderer.invoke('market:auth:login', { userId, pin }),
    logout: (sessionToken) => ipcRenderer.invoke('market:auth:logout', sessionToken),
    /** Session restored after a restart, or null when nobody is signed in. */
    current: () => ipcRenderer.invoke('market:auth:current'),
  },
  support: {
    request: (sessionToken, message) =>
      ipcRenderer.invoke('market:support:request', { sessionToken, message }),
    thread: (sessionToken) => ipcRenderer.invoke('market:support:thread', { sessionToken }),
    /** Downloads an attachment then asks the OS to open it. */
    download: (sessionToken, attachmentId, fileName) =>
      ipcRenderer.invoke('market:support:download', { sessionToken, attachmentId, fileName }),
  },
  backup: {
    status: () => ipcRenderer.invoke('market:backup:status'),
    configure: (sessionToken, directory, password) => ipcRenderer.invoke('market:backup:configure', { sessionToken, directory, password }),
    create: (sessionToken, reason) => ipcRenderer.invoke('market:backup:create', { sessionToken, reason }),
    list: () => ipcRenderer.invoke('market:backup:list'),
    restore: (sessionToken, file, password) => ipcRenderer.invoke('market:backup:restore', { sessionToken, file, password }),
  },
  display: {
    get: () => ipcRenderer.invoke('market:display:get'),
    set: (sessionToken, prefs) => ipcRenderer.invoke('market:display:set', { sessionToken, ...prefs }),
    toggleFullscreen: () => ipcRenderer.invoke('market:display:toggle'),
  },
  image: { pick: (sessionToken) => ipcRenderer.invoke('market:image:pick', sessionToken) },
  activation: {
    status: () => ipcRenderer.invoke('market:activation:status'),
    refresh: () => ipcRenderer.invoke('market:activation:refresh'),
    activate: (sessionToken, activationKey) => ipcRenderer.invoke('market:activation:activate', { sessionToken, activationKey }),
  },
  tenant: {
    status: () => ipcRenderer.invoke('market:tenant:status'),
    login: (email, password) => ipcRenderer.invoke('market:tenant:login', { email, password }),
    logout: () => ipcRenderer.invoke('market:tenant:logout'),
  },
  update: {
    status: () => ipcRenderer.invoke('market:update:status'),
    check: (sessionToken) => ipcRenderer.invoke('market:update:check', sessionToken),
    install: (sessionToken) => ipcRenderer.invoke('market:update:install', sessionToken),
    onChanged: (callback) => { const listener = (_event, status) => callback(status); ipcRenderer.on('market:update:changed', listener); return () => ipcRenderer.removeListener('market:update:changed', listener); },
  },
  sync: {
    push: (sessionToken, snapshot, books) => ipcRenderer.invoke('market:sync:push', { sessionToken, snapshot, books }),
    status: () => ipcRenderer.invoke('market:sync:status'),
    bootstrap: (sessionToken) => ipcRenderer.invoke('market:sync:bootstrap', { sessionToken }),
    onChanged: (callback) => { const listener = (_event, status) => callback(status); ipcRenderer.on('market:sync:changed', listener); return () => ipcRenderer.removeListener('market:sync:changed', listener); },
  },
  app: { info: () => ipcRenderer.invoke('market:app:info') },
  printer: {
    list: () => ipcRenderer.invoke('market:printer:list'),
    health: () => ipcRenderer.invoke('market:printer:health'),
    test: (sessionToken, widthMm) => ipcRenderer.invoke('market:printer:test', { sessionToken, widthMm }),
    receipt: (sessionToken, receipt, widthMm) => ipcRenderer.invoke('market:printer:receipt', { sessionToken, receipt, widthMm }),
    detect: (sessionToken, probe) => ipcRenderer.invoke('market:printer:detect', { sessionToken, probe }),
    report: (sessionToken, report, widthMm) => ipcRenderer.invoke('market:printer:report', { sessionToken, report, widthMm }),
    configure: (sessionToken, target) => ipcRenderer.invoke('market:printer:configure', { sessionToken, target }),
    label: (sessionToken, product, count) => ipcRenderer.invoke('market:printer:label', { sessionToken, product, count }),
    setTarget: (sessionToken, target) => ipcRenderer.invoke('market:printer:setTarget', { sessionToken, target }),
  },
  drawer: {
    open: (sessionToken, payload) => ipcRenderer.invoke('market:drawer:open', { sessionToken, ...payload }),
  },
  authExtra: {
    verifyManagerPin: (pin) => ipcRenderer.invoke('market:auth:verifyManagerPin', { pin }),
  },
  terminal: {
    pay: (sessionToken, payload) => ipcRenderer.invoke('market:terminal:pay', { sessionToken, ...payload }),
  },
  fiscal: {
    processPending: (sessionToken) => ipcRenderer.invoke('market:fiscal:processPending', { sessionToken }),
  },
});

contextBridge.exposeInMainWorld('marketCore', {
  /**
   * `options.managerPin` is what the override dialog collected. It is verified
   * in main; the renderer never decides who approved anything.
   */
  invoke: (method, payload, options) => ipcRenderer.invoke('market:invoke', { method, payload, timeoutMs: options?.timeoutMs, sessionToken: options?.sessionToken, managerPin: options?.managerPin }),
  status: () => ipcRenderer.invoke('market:coreStatus:get'),
  restart: (sessionToken) => ipcRenderer.invoke('market:coreRestart', { sessionToken }),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('market:coreStatus', listener);
    return () => ipcRenderer.removeListener('market:coreStatus', listener);
  },
  onEvent: (callback) => {
    const listener = (_event, evt) => callback(evt);
    ipcRenderer.on('market:coreEvent', listener);
    return () => ipcRenderer.removeListener('market:coreEvent', listener);
  },
});
