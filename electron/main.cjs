const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development';

  // Use a real app icon in both dev and packaged builds.
  // Windows prefers .ico; other platforms can use .png.
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = app.isPackaged
    ? path.join(app.getAppPath(), 'public', iconFile)
    : path.join(process.cwd(), 'public', iconFile);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'Capy-note',
    backgroundColor: '#0a0a0a'
  });

  // In development we load the Vite dev server.
  // In production (packaged) we load the built dist/index.html.
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // Finde den richtigen Pfad zur index.html (für unterschiedliche Packaging-Setups)
    const possiblePaths = [
      path.join(app.getAppPath(), 'dist', 'index.html'),
      path.join(process.resourcesPath, 'app', 'dist', 'index.html'),
      path.join(__dirname, '..', 'dist', 'index.html'),
      path.join(__dirname, 'dist', 'index.html'),
      './dist/index.html'
    ];

    let indexPath = null;
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          indexPath = p;
          console.log('Found index.html at:', p);
          break;
        }
      } catch (_) {
        // ignore
      }
    }

    if (indexPath) {
      mainWindow.loadFile(indexPath);
    } else {
      // Zeige Fehlermeldung mit Debug-Info
      mainWindow.loadURL(`data:text/html;charset=utf-8,
        <html>
          <head><title>Capy-note - Fehler</title></head>
          <body style="background:#1a1a1a;color:white;font-family:sans-serif;padding:40px;">
            <h1>🦫 Capy-note</h1>
            <p>Die App konnte nicht geladen werden.</p>
            <p><strong>Debug Info:</strong></p>
            <pre style="background:#333;padding:10px;overflow:auto;">
__dirname: ${__dirname}
app.getAppPath(): ${app.getAppPath()}
process.resourcesPath: ${process.resourcesPath || 'N/A'}
Geprüfte Pfade:
${possiblePaths.join('\n')}
            </pre>
            <p>Bitte melden Sie diesen Fehler.</p>
          </body>
        </html>
      `);
    }
  }

  // Do NOT auto-open DevTools (user request). It stays available in the menu.

  mainWindow.once('ready-to-show', () => {
    try { mainWindow.show(); } catch (_) {}
  });

  mainWindow.webContents.on('did-fail-load', (_evt, errorCode, errorDescription, validatedURL) => {
    console.error('did-fail-load', { errorCode, errorDescription, validatedURL });
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Datei',
      submenu: [{ role: 'quit', label: 'Beenden' }]
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'toggleDevTools', label: 'Entwicklertools' },
        { role: 'togglefullscreen', label: 'Vollbild' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
