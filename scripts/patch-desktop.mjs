import {
  lstat, open, realpath, rename, unlink, writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '0.2.2-rc.5';
const marker = 'DSH_GLASS_SKINS_HUD_BRIDGE_V1';
const channel = 'dsh-glass-skins:set-hud-enabled';
const files = ['main.js', 'preload-app.cjs'];

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) {
    throw new Error('Unsupported DSH source layout at ' + anchor.split('\n')[0].trim());
  }
  return source.replace(anchor, () => replacement);
}

export function patchDesktopSources({ main, preload }) {
  if (main.includes(marker) || preload.includes(marker)) {
    throw new Error('The original desktop sources already contain the HUD bridge marker.');
  }

  const factory = 'function createWindow(preload, show = false, primary = false) {';
  const macBackdrop = '\tif (process.platform === "darwin") {\n\t\tconst applyBackdrop = () => {';
  const restoreVibrancy = '\t\t\t\twindow.setVibrancy("sidebar");';
  const showListener = '\t\twindow.on("show", applyBackdrop);';
  const deviceInfo = '\tipcMain.handle(DESKTOP_IPC.deviceInfo, (event) => {';
  const productApi = 'function createProductApi() {\n\treturn {\n\t\tprotocolVersion: 1,';

  main = replaceOnce(main, factory,
    `/* ${marker} */\nconst dshGlassWindowBackdrops = new WeakMap();\n${factory}`);
  main = replaceOnce(main, macBackdrop,
    '\tif (process.platform === "darwin") {\n\t\tlet dshGlassHudEnabled = false;\n\t\tconst applyBackdrop = () => {');
  main = replaceOnce(main, restoreVibrancy,
    '\t\t\t\twindow.setVibrancy(dshGlassHudEnabled ? "hud" : "sidebar");');
  main = replaceOnce(main, showListener, `${showListener}
    if (primary) {
      const setHud = (enabled) => {
        if (dshGlassHudEnabled === enabled) return;
        dshGlassHudEnabled = enabled;
        applyBackdrop();
      };
      dshGlassWindowBackdrops.set(window, setHud);
      window.webContents.on("did-start-navigation", (event) => {
        if (event.isMainFrame && !event.isSameDocument) setHud(false);
      });
      window.webContents.on("render-process-gone", () => setHud(false));
    }`);
  main = replaceOnce(main, deviceInfo, `  ipcMain.handle(${JSON.stringify(channel)}, (event, enabled) => {
    const window = assertProductSender(event);
    if (typeof enabled !== "boolean") throw new TypeError("HUD material requires a boolean");
    const applyHud = dshGlassWindowBackdrops.get(window);
    if (!applyHud) return false;
    applyHud(enabled);
    return true;
  });
${deviceInfo}`);
  preload = replaceOnce(preload, productApi, `${productApi}
    /* ${marker} */
    glass: {
      setHudEnabled: (enabled) => {
        if (typeof enabled !== "boolean") throw new TypeError("HUD material requires a boolean");
        return electron.ipcRenderer.invoke(${JSON.stringify(channel)}, enabled);
      }
    },`);

  return { main, preload };
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readRegular(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch(error => {
      if (error.code === 'ELOOP') throw new Error('Expected a regular file at ' + path);
      throw error;
    });
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Expected a regular file at ' + path);
    return { text: await file.readFile('utf8'), mode: stat.mode & 0o777 };
  } finally {
    await file.close();
  }
}

async function replaceFile(path, text, mode) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, text, { flag: 'wx', mode });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function manageBridge(action, appPath) {
  if (!['check', 'install', 'remove'].includes(action) || !appPath) {
    throw new Error('Usage: node scripts/patch-desktop.mjs check|install|remove "/path/to/DeepSeek Harness.app"');
  }
  const bundle = await realpath(appPath);
  if (!bundle.endsWith('.app')) throw new Error('Select a DeepSeek Harness .app bundle.');
  const resources = join(bundle, 'Contents', 'Resources');
  const application = join(resources, 'app');
  const library = join(application, 'lib');
  if (await exists(join(resources, 'app.asar'))) {
    throw new Error('This bridge supports the unpacked DSH desktop layout only.');
  }
  if (await realpath(library) !== library) throw new Error('Unexpected link in the desktop source path.');
  const manifest = JSON.parse((await readRegular(join(application, 'package.json'))).text);
  if (manifest.name !== '@deepseek-ai/dsh-desktop' || manifest.version !== version) {
    throw new Error('Supported DSH desktop version: ' + version);
  }

  const paths = files.map(filename => join(library, filename));
  const current = await Promise.all(paths.map(readRegular));
  const backupPath = join(library, '.dsh-glass-skins-hud-backup.json');
  const saved = await exists(backupPath)
    ? JSON.parse((await readRegular(backupPath)).text)
    : null;
  const original = saved ?? { main: current[0].text, preload: current[1].text };
  if (typeof original.main !== 'string' || typeof original.preload !== 'string') {
    throw new Error('Invalid HUD bridge backup.');
  }

  const patched = patchDesktopSources(original);
  const before = [original.main, original.preload];
  const after = [patched.main, patched.preload];
  for (const [index, entry] of current.entries()) {
    if (entry.text !== before[index] && entry.text !== after[index]) {
      throw new Error('Desktop source changed since the bridge was backed up: ' + files[index]);
    }
  }

  const installed = current.every((entry, index) => entry.text === after[index]);
  if (action === 'check') {
    if (installed) return 'HUD bridge installed.';
    if (saved) return 'HUD bridge backup found. Installation can be resumed.';
    return 'Desktop layout is compatible.';
  }
  if (action === 'remove' && !saved) return 'HUD bridge was already absent.';

  if (action === 'install' && !saved) {
    await writeFile(backupPath, JSON.stringify(original), { flag: 'wx', mode: 0o600 });
  }

  const destination = action === 'install' ? after : before;
  const changed = [];
  try {
    for (const [index, entry] of current.entries()) {
      if (entry.text === destination[index]) continue;
      const latest = await readRegular(paths[index]);
      if (latest.text !== entry.text) throw new Error('Desktop source changed during the operation.');
      await replaceFile(paths[index], destination[index], entry.mode);
      changed.push(index);
    }
  } catch (error) {
    const skipped = [];
    for (const index of changed.reverse()) {
      try {
        const latest = await readRegular(paths[index]);
        if (latest.text !== destination[index]) throw new Error('Desktop source changed during rollback.');
        await replaceFile(paths[index], current[index].text, current[index].mode);
      } catch {
        skipped.push(files[index]);
      }
    }
    if (skipped.length) throw new Error('Rollback needs attention for ' + skipped.join(', ') + '. The backup was kept.', { cause: error });
    throw error;
  }
  if (action === 'remove') await unlink(backupPath);
  return action === 'install' ? 'HUD bridge installed.' : 'HUD bridge removed.';
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'darwin') throw new Error('The desktop bridge is for macOS.');
    console.log(await manageBridge(process.argv[2], process.argv[3]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
