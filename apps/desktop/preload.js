const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('openclawAPI', {
    startGateway: () => ipcRenderer.send('start-gateway'),
    stopGateway: () => ipcRenderer.send('stop-gateway'),
    restartGateway: () => ipcRenderer.send('restart-gateway'),

    getStatus: () => ipcRenderer.invoke('get-status'),
    getLogs: () => ipcRenderer.invoke('get-logs'),

    onLog: (callback) => {
        const fn = (_e, entry) => callback(entry);
        ipcRenderer.on('backend-log', fn);
        return () => ipcRenderer.removeListener('backend-log', fn);
    },
    onStatusChange: (callback) => {
        const fn = (_e, status) => callback(status);
        ipcRenderer.on('gateway-status', fn);
        return () => ipcRenderer.removeListener('gateway-status', fn);
    },
    onGatewayReady: (callback) => {
        const fn = (_e, url) => callback(url);
        ipcRenderer.on('gateway-ready', fn);
        return () => ipcRenderer.removeListener('gateway-ready', fn);
    },

    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (configString) => ipcRenderer.invoke('save-config', configString),

    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    // Terminal
    terminalInput: (data) => ipcRenderer.send('terminal-input', data),
    terminalResize: (cols, rows) => ipcRenderer.send('terminal-resize', { cols, rows }),
    terminalInit: () => ipcRenderer.send('terminal-init'),
    onTerminalOutput: (callback) => {
        const fn = (_e, data) => callback(data);
        ipcRenderer.on('terminal-output', fn);
        return () => ipcRenderer.removeListener('terminal-output', fn);
    },

    // Clipboard
    clipboardRead: () => clipboard.readText(),
    clipboardWrite: (text) => clipboard.writeText(text)
});
