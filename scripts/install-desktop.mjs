import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { manageBridge } from './patch-desktop.mjs';

const run = promisify(execFile);
const defaultApp = '/Applications/DeepSeek Harness.app';

function addPlugin(cli, archive, dshHome) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', [cli, 'plugin', '--profile', 'desktop', 'add', archive, '--ignore-scripts'], {
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error('DSH plugin installation failed (' + (signal ?? code) + ').'));
    });
  });
}

export async function installDesktop(archive, appPath = defaultApp) {
  if (!archive) throw new Error('Usage: node scripts/install-desktop.mjs <release.tgz> [DeepSeek Harness.app]');
  const app = await realpath(appPath);
  const cli = join(app, 'Contents', 'Resources', 'runtime', 'cli', 'bin', 'dsh');
  const executable = join(app, 'Contents', 'MacOS', 'DeepSeek Harness');
  const dshHome = resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'));
  await access(cli, constants.R_OK);
  await access(join(dshHome, 'profiles', 'desktop', 'package.json'), constants.R_OK);

  const source = await realpath(archive);
  const { stdout } = await run('/usr/bin/tar', ['-xOzf', source, 'package/package.json']);
  const packaged = JSON.parse(stdout);
  const expected = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  if (packaged.name !== expected.name || packaged.version !== expected.version) {
    throw new Error('Use the same DSH Glass Skins release archive as the installer.');
  }
  const before = await manageBridge('check', app);
  const { stdout: processes } = await run('/bin/ps', ['-axo', 'comm=']);
  if (processes.split('\n').some(line => line.trim() === executable)) {
    throw new Error('Quit all windows of this DSH app before installing its HUD bridge.');
  }

  const packageDir = join(dshHome, 'plugin-packages');
  await mkdir(packageDir, { recursive: true });
  const stored = join(packageDir, `${expected.name}-${expected.version}.tgz`);
  try {
    await copyFile(source, stored, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await readFile(stored)).equals(await readFile(source))) throw error;
  }

  const hud = await manageBridge('install', app);
  try {
    await addPlugin(cli, stored, dshHome);
  } catch (error) {
    if (before === 'Desktop layout is compatible.') {
      try {
        await manageBridge('remove', app);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Plugin installation failed and the HUD bridge could not be restored.');
      }
    }
    throw error;
  }
  return hud;
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'darwin') throw new Error('DSH Glass Skins is for macOS.');
    console.log(await installDesktop(process.argv[2], process.argv[3]));
  } catch (error) {
    console.error(error.message);
    if (error instanceof AggregateError) {
      for (const cause of error.errors) console.error(cause.message);
    }
    process.exitCode = 1;
  }
}
