const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

// Keep a global reference so the window isn't garbage-collected
let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 720,
        title: 'The Broken Flagon',
        icon: path.join(__dirname, 'build-assets', 'icon.png'),
        backgroundColor: '#0c0a08',  // match the game's dark background
        webPreferences: {
            // No Node integration in the renderer — the game is pure browser JS
            nodeIntegration: false,
            contextIsolation: true,
            // Preload exposes only the minimum IPC surface the game needs
            preload: path.join(__dirname, 'preload.js'),
            // Allow localStorage (required for save game persistence)
            partition: 'persist:brokenflagon',
        },
        // Start maximized on Steam / typical play setups
        show: false,
    });

    mainWindow.loadFile('index.html');

    // Show once ready to avoid white flash
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Open external links in the system browser, not a new Electron window
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://') || url.startsWith('http://')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC handlers ────────────────────────────────────────────────────────────

// Renderer calls window.electronAPI.quit() → preload sends 'quit-app' → here
ipcMain.on('quit-app', () => { app.quit(); });


app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        // macOS: re-create window when dock icon clicked with no windows open
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    // macOS convention: app stays running until explicit Cmd+Q
    if (process.platform !== 'darwin') app.quit();
});
