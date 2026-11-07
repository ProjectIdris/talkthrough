// Isolated native renderer probe: synthetic geometry only, no user screen or app state.
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const out = process.argv[2];
app.setPath('userData', join(out, 'profile'));
app.setPath('sessionData', join(out, 'profile'));
let window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 256, height: 128, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<html><body></body></html>');
  await window.webContents.executeJavaScript(readFileSync(join(out, 'probe.js'), 'utf8'));
  const result = await window.webContents.executeJavaScript('window.surfaceOcclusionResult');
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
  window.destroy();
  app.exit(0);
}).catch(error => { console.error(error); if (window) window.destroy(); app.exit(1); });
