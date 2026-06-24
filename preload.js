/**
 * preload.js — Electron context bridge
 *
 * Runs in a privileged context before the renderer loads, with access to
 * Node / Electron APIs. Exposes only the minimum surface the game needs:
 * currently just `quit` so the "Quit to Desktop" button works.
 *
 * contextIsolation is ON (see electron-main.js), so anything the renderer
 * needs from Node/Electron must be explicitly exposed here via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /** Tell the main process to close the app. */
    quit: () => ipcRenderer.send('quit-app'),
});
