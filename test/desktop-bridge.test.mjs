import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { installDesktop } from '../scripts/install-desktop.mjs';
import { manageBridge, patchDesktopSources } from '../scripts/patch-desktop.mjs';

const vendorMain = `function createWindow(preload, show = false, primary = false) {
  const window = mainWindow;
\tif (process.platform === "darwin") {
\t\tconst applyBackdrop = () => {
      if (window.isDestroyed()) return;
      if (window.isMinimized() || !window.isVisible()) {
        window.setVibrancy(null);
      } else {
\t\t\t\twindow.setVibrancy("sidebar");
      }
    };
    window.on("hide", applyBackdrop);
    window.on("restore", applyBackdrop);
\t\twindow.on("show", applyBackdrop);
  }
  return window;
}
\tipcMain.handle(DESKTOP_IPC.deviceInfo, (event) => {
    assertProductSender(event);
    return {};
  });`;

const vendorPreload = `function createProductApi() {
\treturn {
\t\tprotocolVersion: 1,
  };
}`;

const original = { main: vendorMain, preload: vendorPreload };
const channel = 'dsh-glass-skins:set-hud-enabled';

test('the renderer bridge only sends the named boolean operation', async () => {
  const processed = patchDesktopSources(original);
  const calls = [];
  const api = runInNewContext(processed.preload + '\ncreateProductApi();', {
    electron: { ipcRenderer: { invoke: async (...args) => { calls.push(args); return true; } } },
  });
  assert.equal(await api.glass.setHudEnabled(true), true);
  assert.throws(() => api.glass.setHudEnabled('hud'), { name: 'TypeError' });
  assert.deepEqual(calls, [[channel, true]]);
});

test('unowned senders are rejected and the native material follows window lifecycle', () => {
  const processed = patchDesktopSources(original);
  const windows = new Map();
  const renderer = new Map();
  const handlers = new Map();
  const material = [];
  let visible = true;
  let minimized = false;
  let destroyed = false;

  const frame = { url: 'dsh-app://app/' };
  const webContents = { mainFrame: frame, on: (name, callback) => renderer.set(name, callback) };
  const mainWindow = {
    webContents,
    isVisible: () => visible,
    isMinimized: () => minimized,
    isDestroyed: () => destroyed,
    setVibrancy: type => material.push(type),
    on: (name, callback) => windows.set(name, callback),
  };
  const context = {
    process: { platform: 'darwin' },
    mainWindow,
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    DESKTOP_IPC: { deviceInfo: 'device-info' },
    assertProductSender: (event) => {
      if (event.sender !== webContents || event.senderFrame !== frame || frame.url !== 'dsh-app://app/') {
        throw new Error('unowned sender');
      }
      return mainWindow;
    },
  };
  const create = runInNewContext(processed.main + '\ncreateWindow;', context);
  create(null, false, true);
  const handle = handlers.get(channel);
  const authorized = { sender: webContents, senderFrame: frame };

  assert.throws(() => handle({ ...authorized, sender: {} }, true), /unowned/);
  assert.throws(() => handle({ ...authorized, senderFrame: { ...frame } }, true), /unowned/);
  frame.url = 'https://example.org/';
  assert.throws(() => handle(authorized, true), /unowned/);
  frame.url = 'dsh-app://app/';
  assert.throws(() => handle(authorized, { material: 'hud' }), { name: 'TypeError' });
  assert.deepEqual(material, []);

  assert.equal(handle(authorized, true), true);
  assert.equal(handle(authorized, true), true);
  assert.deepEqual(material, ['hud']);
  assert.equal(handle(authorized, false), true);
  assert.equal(material.at(-1), 'sidebar');
  handle(authorized, true);

  visible = false;
  windows.get('hide')();
  assert.equal(material.at(-1), null);
  visible = true;
  minimized = false;
  windows.get('restore')();
  assert.equal(material.at(-1), 'hud');

  renderer.get('did-start-navigation')({ isMainFrame: false, isSameDocument: false });
  renderer.get('did-start-navigation')({ isMainFrame: true, isSameDocument: true });
  assert.equal(material.at(-1), 'hud');
  renderer.get('did-start-navigation')({ isMainFrame: true, isSameDocument: false });
  assert.equal(material.at(-1), 'sidebar');

  handle(authorized, true);
  renderer.get('render-process-gone')();
  assert.equal(material.at(-1), 'sidebar');
  destroyed = true;
  const calls = material.length;
  windows.get('show')();
  assert.equal(material.length, calls);
});

async function bundleFixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-bridge-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const app = join(temporary, 'Fixture.app');
  const base = join(app, 'Contents', 'Resources', 'app');
  const lib = join(base, 'lib');
  await mkdir(lib, { recursive: true });
  await writeFile(join(base, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-desktop', version: '0.2.2-rc.5',
  }));
  const main = join(lib, 'main.js');
  const preload = join(lib, 'preload-app.cjs');
  await writeFile(main, vendorMain);
  await writeFile(preload, vendorPreload);
  return { app, main, preload, lib };
}

test('install can finish a partial update and remove restores both original files', async (t) => {
  const { app, main, preload, lib } = await bundleFixture(t);
  const backup = join(lib, '.dsh-glass-skins-hud-backup.json');
  assert.match(await manageBridge('check', app), /compatible/);
  await assert.rejects(readFile(backup), { code: 'ENOENT' });
  assert.match(await manageBridge('install', app), /installed/);
  const first = await readFile(main, 'utf8');

  await writeFile(preload, vendorPreload);
  assert.match(await manageBridge('install', app), /installed/);
  assert.equal(await readFile(main, 'utf8'), first);
  assert.match(await readFile(preload, 'utf8'), /setHudEnabled/);

  assert.match(await manageBridge('remove', app), /removed/);
  assert.equal(await readFile(main, 'utf8'), vendorMain);
  assert.equal(await readFile(preload, 'utf8'), vendorPreload);
  await assert.rejects(readFile(backup), { code: 'ENOENT' });
  assert.match(await manageBridge('remove', app), /already absent/);
});

test('the release installer installs both components and rolls back a new bridge if package add fails', async (t) => {
  const { app, main, preload } = await bundleFixture(t);
  const temporary = dirname(app);
  const cliDir = join(app, 'Contents', 'Resources', 'runtime', 'cli', 'bin');
  const profile = join(temporary, 'home', 'profiles', 'desktop');
  const staging = join(temporary, 'package');
  const archive = join(temporary, 'release.tgz');
  await Promise.all([cliDir, profile, staging].map(path => mkdir(path, { recursive: true })));
  await writeFile(join(profile, 'package.json'), '{}');
  const manifest = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  await writeFile(join(staging, 'package.json'), manifest);
  execFileSync('/usr/bin/tar', ['-czf', archive, '-C', temporary, 'package']);
  await writeFile(join(cliDir, 'dsh'), 'printf "%s\\n" "$@" > "$DSH_HOME/args"\ntest ! -f "$DSH_HOME/reject"\n');

  const home = join(temporary, 'home');
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  });

  await writeFile(join(home, 'reject'), '');
  await assert.rejects(installDesktop(archive, app), /plugin installation failed/);
  assert.equal(await readFile(main, 'utf8'), vendorMain);
  assert.equal(await readFile(preload, 'utf8'), vendorPreload);
  await rm(join(home, 'reject'));

  assert.equal(await installDesktop(archive, app), 'HUD bridge installed.');
  assert.match(await readFile(preload, 'utf8'), /setHudEnabled/);
  assert.deepEqual((await readFile(join(home, 'args'), 'utf8')).trim().split('\n'), [
    'plugin', '--profile', 'desktop', 'add',
    join(home, 'plugin-packages', `dsh-glass-skins-${JSON.parse(manifest).version}.tgz`), '--ignore-scripts',
  ]);
});

test('desktop commands execute when invoked through a symlinked path', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-bridge-cli-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const file of ['install-desktop.mjs', 'patch-desktop.mjs']) {
    const alias = join(temporary, file);
    await symlink(fileURLToPath(new URL('../scripts/' + file, import.meta.url)), alias);
    const result = spawnSync(process.execPath, [alias], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:|for macOS/);
  }
});

test('a changed desktop source or a redirected target is refused', async (t) => {
  const { app, main, preload, lib } = await bundleFixture(t);
  await manageBridge('install', app);
  const unrelatedEdit = vendorMain + '\n// another local change';
  await writeFile(main, unrelatedEdit);
  await assert.rejects(manageBridge('remove', app), /changed since/);
  assert.equal(await readFile(main, 'utf8'), unrelatedEdit);

  const alternate = join(lib, 'alternate.cjs');
  await writeFile(alternate, vendorPreload);
  await rm(preload);
  await symlink(alternate, preload);
  await assert.rejects(manageBridge('install', app), /regular file/);
  assert.equal(await readFile(alternate, 'utf8'), vendorPreload);
});

test('an unsupported or ambiguous source cannot be patched', () => {
  assert.throws(() => patchDesktopSources({ ...original, main: '' }), /Unsupported/);
  assert.throws(() => patchDesktopSources({ ...original, preload: vendorPreload.repeat(2) }), /Unsupported/);
});
