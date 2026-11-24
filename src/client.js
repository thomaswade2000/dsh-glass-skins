const { createElement: h, useState, useSyncExternalStore } = require('react');

const sectionId = 'dsh-glass-skins';
const namespace = 'settings.dsh-glass-skins';
const storageKeys = {
  skin: 'dsh-glass-skins.preference',
  transparency: 'dsh-glass-skins.transparency',
  optimize: 'dsh-glass-skins.optimize-main-ui',
};
const skinAttribute = 'data-dsh-glass-skin';
const transparencyProperty = '--dsh-glass-transparency';
const transparencyId = 'dsh-glass-transparency';
const maximumTransparency = 85;
const defaults = { skin: 'native', transparency: 60, optimize: true };
const choices = ['native', 'sky', 'pearl', 'mint'];

const en = {
  title: 'Skins',
  description: 'Use macOS window glass in light appearance.',
  dark: 'Your selected skin will return in light appearance.',
  transparency: 'Glass transparency',
  transparencyHint: 'Move right to show more of the background.',
  nativeHint: 'Choose a glass skin to adjust transparency.',
  reducedNote: 'macOS Reduce Transparency is on. The selected value is saved.',
  saveError: 'Could not save your skin preference.',
  optimize: 'Optimize the main interface',
  optimizeHint: 'Group sidebar actions in Quick Actions and move account and feedback into Settings.',
  quickActions: 'Quick Actions',
  accountFeedback: 'Account and feedback',
  account: 'Account',
  feedback: 'Feedback',
  accountLoading: 'Checking account status…',
  native: 'Native',
  sky: 'Clear Blue',
  pearl: 'Pearl Mist',
  mint: 'Mint',
};

const zh = {
  title: '皮肤',
  description: '在浅色外观下使用 macOS 原生磨砂。',
  dark: '回到浅色外观时将恢复所选皮肤。',
  transparency: '玻璃透明度',
  transparencyHint: '向右拖动，背景会透得更多。',
  nativeHint: '选择一款磨砂皮肤后可调节。',
  reducedNote: 'macOS 已开启「降低透明度」，滑块数值仍会保存。',
  saveError: '无法保存皮肤偏好。',
  optimize: '优化主界面',
  optimizeHint: '把侧栏入口收进「快速操作」，在设置中管理账户和反馈。',
  quickActions: '快速操作',
  accountFeedback: '账户和反馈',
  account: '账户',
  feedback: '反馈',
  accountLoading: '正在读取账户状态…',
  native: '原生',
  sky: '晴蓝',
  pearl: '雾白',
  mint: '薄荷',
};

function readPreferences() {
  try {
    const skin = localStorage.getItem(storageKeys.skin);
    const storedTransparency = localStorage.getItem(storageKeys.transparency);
    const transparency = storedTransparency === null ? NaN : Number(storedTransparency);
    return {
      skin: choices.includes(skin) ? skin : defaults.skin,
      transparency: Number.isInteger(transparency) && transparency >= 0 && transparency <= maximumTransparency
        ? transparency
        : defaults.transparency,
      optimize: localStorage.getItem(storageKeys.optimize) !== 'false',
    };
  } catch {
    return defaults;
  }
}

function apply(ctx) {
  const root = document.documentElement;
  if (root.dataset.platform !== 'darwin' || !window.dshDesktop) return;

  let preferences = readPreferences();
  const setHudEnabled = window.dshDesktop.glass?.setHudEnabled;
  const reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)');
  let requestedHud;
  const listeners = new Set();
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  function reflectNativeMaterial() {
    if (typeof setHudEnabled !== 'function') return;
    const enabled = preferences.skin !== 'native'
      && !document.body.hasAttribute('data-ds-dark-theme')
      && !reducedTransparency.matches;
    if (requestedHud === enabled) return;
    requestedHud = enabled;
    void setHudEnabled(enabled).catch(() => {
      if (requestedHud === enabled) requestedHud = undefined;
    });
  }

  function reflect() {
    if (preferences.skin === 'native') {
      root.removeAttribute(skinAttribute);
      root.style.removeProperty(transparencyProperty);
    } else {
      root.setAttribute(skinAttribute, preferences.skin);
      root.style.setProperty(transparencyProperty, String(preferences.transparency / 100));
    }
    reflectNativeMaterial();
  }

  function update(next) {
    if (preferences.skin === next.skin && preferences.transparency === next.transparency
      && preferences.optimize === next.optimize) return;
    preferences = next;
    reflect();
    for (const listener of listeners) listener();
  }

  function save(field, value) {
    try {
      localStorage.setItem(storageKeys[field], String(value));
    } catch {
      return false;
    }
    update({ ...preferences, [field]: value });
    return true;
  }

  ctx.effect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-dsh-glass-styles', '');
    style.textContent = styles;
    document.head.appendChild(style);
    reflect();

    const monitorAppearance = typeof setHudEnabled === 'function'
      ? new MutationObserver(reflectNativeMaterial)
      : null;
    monitorAppearance?.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme'],
    });
    if (monitorAppearance) reducedTransparency.addEventListener('change', reflectNativeMaterial);

    const onStorage = (event) => {
      if (event.key === null || Object.values(storageKeys).includes(event.key)) {
        update(readPreferences());
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
      if (monitorAppearance) {
        monitorAppearance.disconnect();
        reducedTransparency.removeEventListener('change', reflectNativeMaterial);
        if (requestedHud !== false) void setHudEnabled(false).catch(() => {});
      }
      root.removeAttribute(skinAttribute);
      root.style.removeProperty(transparencyProperty);
      style.remove();
      listeners.clear();
    };
  }, 'dsh-glass-skins: native glass');

  ctx.effect(() => ctx.locale.register(namespace, { en, zh }), 'dsh-glass-skins: locale');
  const t = ctx.locale.bind(namespace);
  const getPreferences = () => preferences;
  const layoutAvailable = typeof ctx.slots.entriesOfSlot === 'function'
    && installCompactLayout(ctx, { subscribe, getPreferences, t });

  function SkinSettings() {
    const current = useSyncExternalStore(subscribe, getPreferences);
    const [saveError, setSaveError] = useState(false);
    const native = current.skin === 'native';
    const valueText = `${current.transparency}%`;
    const hintId = `${transparencyId}-hint`;

    return h('fieldset', { className: 'dsh-glass-picker' },
      h('legend', null, t('title')),
      h('p', { className: 'dsh-glass-description' }, t('description')),
      h('div', { className: 'dsh-glass-options' }, choices.map((choice) =>
        h('label', { className: 'dsh-glass-option', 'data-swatch': choice, key: choice },
          h('input', {
            type: 'radio',
            name: 'dsh-glass-skin-preference',
            value: choice,
            checked: current.skin === choice,
            onChange: () => setSaveError(!save('skin', choice)),
          }),
          h('span', { className: 'dsh-glass-swatch', 'aria-hidden': 'true' }),
          h('span', null, t(choice)),
        ),
      )),
      h('div', { className: 'dsh-glass-slider' },
        h('div', { className: 'dsh-glass-slider-heading' },
          h('label', { htmlFor: transparencyId }, t('transparency')),
          h('span', { 'aria-hidden': true }, valueText),
        ),
        h('input', {
          id: transparencyId,
          type: 'range',
          min: 0,
          max: maximumTransparency,
          step: 1,
          value: current.transparency,
          disabled: native,
          'aria-valuetext': valueText,
          'aria-describedby': hintId,
          onChange: (event) => setSaveError(!save('transparency', event.currentTarget.valueAsNumber)),
        }),
        h('p', { id: hintId, className: 'dsh-glass-description' }, t(native ? 'nativeHint' : 'transparencyHint')),
      ),
      !native && h('p', {
        className: 'dsh-glass-dark-note dsh-glass-description',
      }, t('dark')),
      !native && h('p', {
        className: 'dsh-glass-reduced-note dsh-glass-description',
      }, t('reducedNote')),
      layoutAvailable && h('div', { className: 'dsh-glass-optimize-row' },
        h('label', { htmlFor: 'dsh-glass-optimize' },
          h('span', null, t('optimize')),
          h('span', { id: 'dsh-glass-optimize-hint', className: 'dsh-glass-description' }, t('optimizeHint')),
        ),
        h('input', {
          id: 'dsh-glass-optimize',
          type: 'checkbox',
          role: 'switch',
          checked: current.optimize,
          'aria-describedby': 'dsh-glass-optimize-hint',
          onChange: (event) => setSaveError(!save('optimize', event.currentTarget.checked)),
        }),
      ),
      saveError && h('p', { role: 'alert' }, t('saveError')),
    );
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: sectionId,
    order: 21,
    label: () => t('title'),
    locale: namespace,
  }, SkinSettings));
}
