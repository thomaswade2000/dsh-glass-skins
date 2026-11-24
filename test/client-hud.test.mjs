import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');

test('HUD follows saved skin, light appearance, accessibility and unload', () => {
  let dark = false;
  let onAppearance;
  let onMediaChange;
  let disposeStyle;
  const nativeCalls = [];
  const domAttributes = new Map();
  const settings = new Map([['dsh-glass-skins.preference', 'sky']]);
  const stylesheet = { setAttribute() {}, remove() {} };
  const root = {
    dataset: { platform: 'darwin' },
    setAttribute: (key, value) => domAttributes.set(key, value),
    removeAttribute: key => domAttributes.delete(key),
    style: { setProperty() {}, removeProperty() {} },
  };
  const body = { hasAttribute: () => dark };
  const media = {
    matches: false,
    addEventListener(name, callback) { onMediaChange = callback; },
    removeEventListener() { onMediaChange = undefined; },
  };

  const apply = runInNewContext(source + '\napply;', {
    require: () => ({}),
    styles: '',
    document: {
      documentElement: root,
      body,
      head: { appendChild() {} },
      createElement: () => stylesheet,
    },
    window: {
      dshDesktop: { glass: { setHudEnabled: async enabled => { nativeCalls.push(enabled); } } },
      matchMedia: () => media,
      addEventListener(name, callback) { this.onStorage = callback; },
      removeEventListener() {},
    },
    localStorage: { getItem: key => settings.get(key) ?? null },
    MutationObserver: class {
      constructor(callback) { onAppearance = callback; }
      observe() {}
      disconnect() { onAppearance = undefined; }
    },
  });

  apply({
    effect(enter, label) {
      const dispose = enter();
      if (label === 'dsh-glass-skins: native glass') disposeStyle = dispose;
    },
    locale: { register() {}, bind: () => key => key },
    slots: { inject() {} },
  });
  assert.deepEqual(nativeCalls, [true]);
  assert.equal(domAttributes.get('data-dsh-glass-skin'), 'sky');

  dark = true;
  onAppearance();
  onAppearance();
  dark = false;
  onAppearance();
  media.matches = true;
  onMediaChange();
  media.matches = false;
  onMediaChange();
  disposeStyle();

  assert.deepEqual(nativeCalls, [true, false, true, false, true, false]);
  assert.equal(onAppearance, undefined);
  assert.equal(onMediaChange, undefined);
  assert.equal(domAttributes.size, 0);
});
