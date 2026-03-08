const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
Menu.setApplicationMenu(null); // Hide default menu bar

const path = require('path');
const { spawn } = require('child_process');
const { createServer } = require('net');
const fs = require('fs');
const os = require('os');
const http = require('http');

let mainWindow;
let tray;
let gatewayProcess;
let isQuitting = false;
let isStartingGateway = false;

const GATEWAY_PORT = 18789;
const openclawScriptPath = path.join(__dirname, '..', '..', 'scripts', 'run-node.mjs');
const openclawHome = path.join(os.homedir(), '.openclaw');
const openclawConfigPath = path.join(openclawHome, 'openclaw.json');

const logBuffer = [];
const MAX_LOG_LINES = 1000;

function appendLog(message, type = 'info') {
    if (!message) return;
    const logEntry = { timestamp: Date.now(), message: message.trim(), type };
    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backend-log', logEntry);
    }
}

/** Read gateway auth token from openclaw.json or env */
function readGatewayToken() {
    try {
        if (fs.existsSync(openclawConfigPath)) {
            const raw = fs.readFileSync(openclawConfigPath, 'utf8');
            const cfg = JSON.parse(raw);
            return cfg?.gateway?.auth?.token || process.env.OPENCLAW_GATEWAY_TOKEN || '';
        }
    } catch (_) {}
    return process.env.OPENCLAW_GATEWAY_TOKEN || '';
}

/** Poll until localhost:18789 is accepting connections, then resolve */
function waitForServer(port, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        function attempt() {
            const req = http.get(`http://localhost:${port}`, (res) => {
                res.destroy();
                resolve();
            });
            req.on('error', () => {
                if (Date.now() - start > timeoutMs) {
                    reject(new Error(`Timeout waiting for server on port ${port}`));
                } else {
                    setTimeout(attempt, 500);
                }
            });
            req.setTimeout(500, () => {
                req.destroy();
                if (Date.now() - start > timeoutMs) {
                    reject(new Error(`Timeout waiting for server on port ${port}`));
                } else {
                    setTimeout(attempt, 500);
                }
            });
        }
        attempt();
    });
}

/** Kill any process already occupying the gateway port (stale session) */
function killStaleGateway() {
    return new Promise((resolve) => {
        // Check if port is in use; if so, find the PID and kill it
        const finder = spawn('cmd', ['/c', `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${GATEWAY_PORT} ^| findstr LISTENING') do taskkill /F /PID %a`], {
            shell: true,
            env: process.env
        });
        finder.on('close', () => resolve());
        finder.on('error', () => resolve());
        setTimeout(resolve, 3000); // max wait 3s
    });
}

async function startGateway() {
    if (gatewayProcess) {
        appendLog('Gateway is already running.', 'warn');
        return;
    }
    if (isStartingGateway) {
        appendLog('Gateway start already in progress.', 'warn');
        return;
    }
    isStartingGateway = true;

    appendLog('Checking for stale gateway processes...', 'info');
    await killStaleGateway();
    await new Promise(r => setTimeout(r, 500)); // brief pause after kill

    appendLog('Starting OpenClaw Gateway...', 'info');

    gatewayProcess = spawn('node', [openclawScriptPath, 'gateway', '--port', String(GATEWAY_PORT)], {
        cwd: path.join(__dirname, '..', '..'),
        env: { ...process.env, FORCE_COLOR: '0' },
        shell: false
    });

    gatewayProcess.stdout.on('data', (data) => appendLog(data.toString(), 'stdout'));
    gatewayProcess.stderr.on('data', (data) => appendLog(data.toString(), 'stderr'));

    gatewayProcess.on('close', (code) => {
        appendLog(`Gateway process exited with code ${code}`, 'warn');
        gatewayProcess = null;
        isStartingGateway = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('gateway-status', 'stopped');
        }
        updateTrayMenu();
    });

    appendLog('Waiting for gateway to become ready...', 'info');
    waitForServer(GATEWAY_PORT).then(() => {
        isStartingGateway = false;
        appendLog('Gateway is ready! Notifying renderer.', 'info');
        const token = readGatewayToken();
        const gatewayUrl = token
            ? `http://localhost:${GATEWAY_PORT}#token=${encodeURIComponent(token)}`
            : `http://localhost:${GATEWAY_PORT}`;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('gateway-status', 'running');
            mainWindow.webContents.send('gateway-ready', gatewayUrl);
        }
        updateTrayMenu();
    }).catch((err) => {
        isStartingGateway = false;
        appendLog(`Gateway readiness check failed: ${err.message}`, 'error');
    });
}

function stopGateway() {
    if (gatewayProcess) {
        appendLog('Stopping OpenClaw Gateway...', 'info');
        gatewayProcess.kill('SIGTERM');
        gatewayProcess = null;
        updateTrayMenu();
    }
}

function restartGateway() {
    appendLog('Restarting gateway...', 'info');
    stopGateway();
    setTimeout(startGateway, 1500);
}

function updateTrayMenu() {
    if (!tray || tray.isDestroyed()) return;
    const running = !!gatewayProcess;
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show OpenClaw', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
        { type: 'separator' },
        { label: running ? '● Gateway Running' : '○ Gateway Stopped', enabled: false },
        { label: 'Restart Gateway', click: () => restartGateway() },
        { label: running ? 'Stop Gateway' : 'Start Gateway', click: () => running ? stopGateway() : startGateway() },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);
}

function createTray() {
    // Create a 16x16 pixel blank image as a fallback icon
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('OpenClaw Desktop');
    updateTrayMenu();
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        show: false,
        title: 'OpenClaw Desktop',
        frame: false, // Frameless window
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true
        }
    });


    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => mainWindow.show());

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            appendLog('App minimized to tray.', 'info');
        }
    });
}

/* ── IPC Handlers ── */
ipcMain.handle('get-logs', () => logBuffer);
ipcMain.handle('get-status', () => (gatewayProcess ? 'running' : 'stopped'));
ipcMain.on('start-gateway', () => startGateway());
ipcMain.on('stop-gateway', () => stopGateway());
ipcMain.on('restart-gateway', () => restartGateway());

// Window controls
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});
ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});


ipcMain.handle('get-config', async () => {
    try {
        if (fs.existsSync(openclawConfigPath)) {
            return await fs.promises.readFile(openclawConfigPath, 'utf8');
        }
        return '{}';
    } catch (e) {
        appendLog(`Error reading config: ${e.message}`, 'error');
        return '{}';
    }
});

ipcMain.handle('save-config', async (_event, configString) => {
    try {
        if (!fs.existsSync(openclawHome)) {
            await fs.promises.mkdir(openclawHome, { recursive: true });
        }
        await fs.promises.writeFile(openclawConfigPath, configString, 'utf8');
        appendLog('Configuration saved.', 'info');
        return { success: true };
    } catch (e) {
        appendLog(`Error saving config: ${e.message}`, 'error');
        return { success: false, error: e.message };
    }
});

/* ── Terminal (PTY) ── */
const pty = require('node-pty');
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
let ptyProcess = null;

function createPty() {
    if (ptyProcess) return;

    ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: path.join(__dirname, '..', '..'),
        env: process.env
    });

    ptyProcess.onData((data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal-output', data);
        }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
        appendLog(`Terminal process exited with code ${exitCode}`, 'info');
        ptyProcess = null;
    });
}

ipcMain.on('terminal-input', (event, data) => {
    if (!ptyProcess) createPty();
    if (ptyProcess) ptyProcess.write(data);
});

ipcMain.on('terminal-resize', (event, { cols, rows }) => {
    if (ptyProcess) ptyProcess.resize(cols, rows);
});

ipcMain.on('terminal-init', () => {
    if (!ptyProcess) createPty();
});

/* ── App Lifecycle ── */
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

app.whenReady().then(() => {
    createWindow();
    createTray();
    startGateway();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else mainWindow.show();
    });
});

app.on('before-quit', () => {
    isQuitting = true;
    stopGateway();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
