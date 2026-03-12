const api = window.openclawAPI;

// ── DOM Elements ──
const navItems = document.querySelectorAll('.nav-item');
const viewPanels = document.querySelectorAll('.view-panel');
const logOutput = document.getElementById('log-output');
const logEmptyState = document.getElementById('log-empty-state');
const webview = document.getElementById('openclaw-webview');
const webviewPlaceholder = document.getElementById('webview-placeholder');

// Status indicators
const titlebarDot = document.getElementById('titlebar-dot');
const titlebarStatusText = document.getElementById('titlebar-status-text');
const gwDot = document.getElementById('gw-dot');
const gwStatusText = document.getElementById('gw-status-text');

// Buttons
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnRestart = document.getElementById('btn-restart');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Window controls
const winMinimize = document.getElementById('window-minimize');
const winMaximize = document.getElementById('window-maximize');
const winClose = document.getElementById('window-close');

winMinimize.addEventListener('click', () => api.minimizeWindow());
winMaximize.addEventListener('click', () => api.maximizeWindow());
winClose.addEventListener('click', () => api.closeWindow());


// ── Navigation ──
navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(n => n.classList.remove('active'));
        viewPanels.forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        const targetId = item.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
    });
});

// ── Log renderer ──
let hasLogs = false;

function renderLog(entry) {
    // Hide empty-state once we have logs
    if (!hasLogs) {
        hasLogs = true;
        if (logEmptyState) logEmptyState.style.display = 'none';
    }

    const div = document.createElement('div');
    div.className = `log-entry log-${entry.type}`;

    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.innerText = time;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'log-msg';
    msgSpan.innerText = entry.message;

    div.appendChild(timeSpan);
    div.appendChild(msgSpan);
    logOutput.appendChild(div);
    logOutput.scrollTop = logOutput.scrollHeight;
}

// ── Status Updates ──
function updateStatusUI(status) {
    const labels = {
        running: 'Running',
        stopped: 'Stopped',
        starting: 'Starting…',
        error: 'Error',
    };
    const label = labels[status] || status.charAt(0).toUpperCase() + status.slice(1);

    // Titlebar pill
    titlebarDot.className = 'titlebar-dot ' + status;
    titlebarStatusText.innerText = label;

    // Sidebar card
    gwDot.className = 'gw-dot ' + status;
    gwStatusText.innerText = label;

    // Button states
    btnStart.disabled = status === 'running' || status === 'starting';
    btnStop.disabled = status !== 'running';
    btnRestart.disabled = status !== 'running';
}

// ── Gateway Ready → load webview ──
api.onGatewayReady((url) => {
    if (webviewPlaceholder) webviewPlaceholder.style.display = 'none';
    if (webview) {
        webview.src = url;
        webview.style.display = 'flex';
    }
});


// ── Gateway Controls ──
btnStart.addEventListener('click', () => {
    updateStatusUI('starting');
    api.startGateway();
});

btnStop.addEventListener('click', () => api.stopGateway());

btnRestart.addEventListener('click', () => {
    logOutput.querySelectorAll('.log-entry').forEach(el => el.remove());
    hasLogs = false;
    if (logEmptyState) logEmptyState.style.display = 'flex';
    api.restartGateway();
});

btnClearLogs.addEventListener('click', () => {
    logOutput.querySelectorAll('.log-entry').forEach(el => el.remove());
    hasLogs = false;
    if (logEmptyState) logEmptyState.style.display = 'flex';
});

// ── Terminal Implementation ──
let term;
let fitAddon;

function initTerminal() {
    if (term) return;

    term = new Terminal({
        background: '#000000',
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        theme: {
            background: '#000000',
            foreground: '#e5e5e5',
            cursor: '#ad89ff',
            selectionBackground: 'rgba(173, 137, 255, 0.3)',
            black: '#000000',
            red: '#ef4444',
            green: '#22c55e',
            yellow: '#f59e0b',
            blue: '#3b82f6',
            magenta: '#ad89ff',
            cyan: '#14b8a6',
            white: '#e5e5e5'
        }
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-view'));
    fitAddon.fit();

    term.onData(data => api.terminalInput(data));

    api.onTerminalOutput(data => {
        term.write(data);
    });

    api.terminalInit();

    // Copy / Paste Keyboard Handling
    term.attachCustomKeyEventHandler(e => {
        // Handle Copy (Ctrl+C or Ctrl+Shift+C)
        if (e.ctrlKey && e.keyCode === 67 && e.type === 'keydown') {
            if (term.hasSelection()) {
                api.clipboardWrite(term.getSelection());
                term.clearSelection();
                return false;
            }
        }
        
        // Handle Paste (Ctrl+V or Ctrl+Shift+V)
        if (e.ctrlKey && e.keyCode === 86 && e.type === 'keydown') {
            const text = api.clipboardRead();
            if (text) {
                api.terminalInput(text);
            }
            return false;
        }
        return true;
    });

    // Resize handling
    window.addEventListener('resize', () => {
        if (document.getElementById('view-terminal').classList.contains('active')) {
            fitAddon.fit();
            api.terminalResize(term.cols, term.rows);
        }
    });
}

// ── Init ──
async function init() {
    api.onLog(entry => renderLog(entry));
    api.onStatusChange(status => updateStatusUI(status));

    const currentStatus = await api.getStatus();
    updateStatusUI(currentStatus);

    const logs = await api.getLogs();
    if (logs && logs.length > 0) {
        logs.forEach(renderLog);
    }

    // Initialize terminal if it's the active view (unlikely at start but for safety)
    if (document.getElementById('view-terminal').classList.contains('active')) {
        initTerminal();
    }
}

// Modify Navigation to init terminal when tab is clicked
navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(n => n.classList.remove('active'));
        viewPanels.forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        const targetId = item.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
        
        if (targetId === 'view-terminal') {
            initTerminal();
            setTimeout(() => {
                fitAddon.fit();
                api.terminalResize(term.cols, term.rows);
            }, 50);
        }
    });
});

init();
