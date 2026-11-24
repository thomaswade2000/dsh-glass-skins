const { createElement: h, useState, useSyncExternalStore } = require('react');

const sectionId = 'dsh-glass-skins';
const namespace = 'settings.dsh-glass-skins';
const storageKeys = {
  skin: 'dsh-glass-skins.preference',
  transparency: 'dsh-glass-skins.transparency',
  matchAccent: 'dsh-glass-skins.match-accent',
  optimize: 'dsh-glass-skins.optimize-main-ui',
};
const skinAttribute = 'data-dsh-glass-skin';
const accentAttribute = 'data-dsh-glass-match-accent';
const transparencyProperty = '--dsh-glass-transparency';
const transparencyId = 'dsh-glass-transparency';
const maximumTransparency = 85;
const defaults = { skin: 'sky', transparency: 60, matchAccent: true, optimize: true };
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
  matchAccent: 'Match accent colors to the skin',
  matchAccentHint: 'Applies to glass skins in light appearance.',
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
  matchAccent: '强调色跟随皮肤',
  matchAccentHint: '在浅色外观下使用磨砂皮肤时生效。',
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
      matchAccent: localStorage.getItem(storageKeys.matchAccent) !== 'false',
      optimize: localStorage.getItem(storageKeys.optimize) !== 'false',
    };
  } catch {
    return defaults;
  }
}

function SkinSwitch({ id, label, hint, checked, onChange }) {
  const hintId = `${id}-hint`;
  return h('div', { className: 'dsh-glass-switch-row' },
    h('div', null,
      h('label', { htmlFor: id }, label),
      h('span', { id: hintId, className: 'dsh-glass-description' }, hint),
    ),
    h('input', {
      id,
      type: 'checkbox',
      role: 'switch',
      checked,
      'aria-describedby': hintId,
      onChange: (event) => onChange(event.currentTarget.checked),
    }),
  );
}

function observeComposerClip(app) {
  const readyAttribute = 'data-dsh-glass-composer-clip';
  const insetProperty = '--dsh-glass-composer-inset';
  let binding;
  let frame = 0;
  let inset;

  function paintClip() {
    if (!binding) return;
    const { scrollport, flow, card } = binding;
    const cardBox = card.getBoundingClientRect();
    const flowBox = flow.getBoundingClientRect();
    if (cardBox.height === 0 || flowBox.width === 0) {
      scrollport.removeAttribute(readyAttribute);
      return;
    }
    // Both edges are in viewport coordinates even while the input is sticky
    // and the messages are moving through the scrollport.
    const nextInset = `${flowBox.bottom - (cardBox.top + cardBox.height / 2)}px`;
    if (inset !== nextInset) {
      inset = nextInset;
      flow.style.setProperty(insetProperty, inset);
    }
    scrollport.toggleAttribute(readyAttribute, true);
  }

  function scheduleClip() {
    if (frame === 0) frame = requestAnimationFrame(() => {
      frame = 0;
      paintClip();
    });
  }

  const resize = new ResizeObserver(paintClip);

  function unbind() {
    if (!binding) return;
    const { scrollport, flow } = binding;
    scrollport.removeEventListener('scroll', scheduleClip);
    scrollport.removeAttribute(readyAttribute);
    flow.style.removeProperty(insetProperty);
    resize.disconnect();
    if (frame !== 0) cancelAnimationFrame(frame);
    binding = undefined;
    inset = undefined;
    frame = 0;
  }

  function bind() {
    const scrollport = app.querySelector(
      '[data-slot="main.conversation"] [data-content-phase="active"] [data-conversation-scroll]',
    );
    const flow = scrollport?.querySelector('[data-chat-flow]');
    const seat = scrollport?.querySelector(':scope > [data-composer-seat]');
    const card = seat?.querySelector('[data-composer-card]');
    if (binding?.scrollport === scrollport && binding?.flow === flow && binding?.card === card) return;
    unbind();
    if (!card || !flow || flow.closest('[data-conversation-scroll]') !== scrollport) return;
    binding = { scrollport, flow, card };
    scrollport.addEventListener('scroll', scheduleClip, { passive: true });
    for (const target of [scrollport, flow, seat, card]) resize.observe(target);
    paintClip();
  }

  const replacements = new MutationObserver((changes) => {
    if (!binding?.flow.isConnected || !binding.card.isConnected
      || changes.some(change => change.type === 'attributes')) bind();
  });
  replacements.observe(app, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['data-content-phase'],
  });
  bind();
  return () => {
    replacements.disconnect();
    unbind();
  };
}

function apply(ctx) {
  const root = document.documentElement;
  if (root.dataset.platform !== 'darwin' || !window.dshDesktop) return;

  let preferences = readPreferences();
  const setHudEnabled = window.dshDesktop.glass?.setHudEnabled;
  const reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)');
  const app = typeof ResizeObserver === 'function' && CSS.supports('clip-path', 'inset(0)')
    ? document.getElementById('root')
    : null;
  let requestedHud;
  let stopComposerClip;
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

  function reflectAppearance() {
    reflectNativeMaterial();
    if (!app) return;
    const glass = preferences.skin !== 'native' && !document.body.hasAttribute('data-ds-dark-theme');
    if (glass) {
      stopComposerClip ??= observeComposerClip(app);
    } else {
      stopComposerClip?.();
      stopComposerClip = undefined;
    }
  }

  function reflect() {
    root.toggleAttribute(accentAttribute, preferences.skin !== 'native' && preferences.matchAccent);
    if (preferences.skin === 'native') {
      root.removeAttribute(skinAttribute);
      root.style.removeProperty(transparencyProperty);
    } else {
      root.setAttribute(skinAttribute, preferences.skin);
      root.style.setProperty(transparencyProperty, String(preferences.transparency / 100));
    }
    reflectAppearance();
  }

  function update(next) {
    if (preferences.skin === next.skin && preferences.transparency === next.transparency
      && preferences.matchAccent === next.matchAccent && preferences.optimize === next.optimize) return;
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

    const monitorAppearance = typeof setHudEnabled === 'function' || app
      ? new MutationObserver(reflectAppearance)
      : null;
    monitorAppearance?.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme'],
    });
    if (typeof setHudEnabled === 'function') reducedTransparency.addEventListener('change', reflectNativeMaterial);

    const onStorage = (event) => {
      if (event.key === null || Object.values(storageKeys).includes(event.key)) {
        update(readPreferences());
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
      monitorAppearance?.disconnect();
      stopComposerClip?.();
      if (typeof setHudEnabled === 'function') {
        reducedTransparency.removeEventListener('change', reflectNativeMaterial);
        if (requestedHud !== false) void setHudEnabled(false).catch(() => {});
      }
      root.removeAttribute(skinAttribute);
      root.removeAttribute(accentAttribute);
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
      h(SkinSwitch, {
        id: 'dsh-glass-match-accent',
        label: t('matchAccent'),
        hint: t('matchAccentHint'),
        checked: current.matchAccent,
        onChange: (checked) => setSaveError(!save('matchAccent', checked)),
      }),
      layoutAvailable && h(SkinSwitch, {
        id: 'dsh-glass-optimize',
        label: t('optimize'),
        hint: t('optimizeHint'),
        checked: current.optimize,
        onChange: (checked) => setSaveError(!save('optimize', checked)),
      }),
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
