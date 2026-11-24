function installCompactLayout(ctx, { subscribe, getPreferences, t }) {
  let ui;
  let createPortal;
  try {
    ui = require('@deepseek-ai/dsh-client-ui-primitives');
    ({ createPortal } = require('react-dom'));
  } catch {
    return false;
  }
  const { useLayoutEffect, useRef } = require('react');
  const { Button, IconAppsAddOutlineRegular, IconSettingsOutlineMedium, IconUserOutlineMedium,
    IconPaperPlaneOutlineMedium, Menu, Modal } = ui;
  if (typeof createPortal !== 'function' || !Menu || !Modal || !Button
    || !IconAppsAddOutlineRegular || !IconSettingsOutlineMedium || !IconUserOutlineMedium
    || !IconPaperPlaneOutlineMedium) return false;

  const accountSectionId = 'dsh-glass-account-feedback';
  const nativeAccountSectionId = 'account';
  const accountLocale = ctx.locale.bind('settings.account');
  const nativeSettingsLabel = ctx.locale.bind('settings');
  const useEnabled = () => useSyncExternalStore(subscribe, () => getPreferences().optimize);
  const panelsSlot = 'sidebar.panellist';
  const launcherSlot = 'settings.launcher';
  const settingsSlot = 'sidebar.settings';
  const sectionSlot = 'settings.section';
  const entries = (slot) => ctx.slots.entriesOfSlot(slot);
  const labelOf = ({ options }) => typeof options.label === 'function' ? options.label() : options.label;

  function trackSlots(slots, listener) {
    const disposers = slots.map((slot) => ctx.slots.subscribe(slot, listener));
    disposers.push(ctx.locale.subscribe(listener));
    return () => disposers.forEach((dispose) => dispose());
  }

  function useSlotChanges(...slots) {
    useSyncExternalStore((listener) => trackSlots(slots, listener), () => [
      ctx.locale.getSnapshot().revision,
      ...slots.map((slot) => ctx.slots.getVersion(slot)),
    ].join(':'));
  }

  function accountOperations() {
    const launcher = entries(launcherSlot)[0];
    if (launcher?.locale !== 'settings.account') return undefined;
    const account = launcher.inject?.();
    if (typeof account?.start === 'function' && typeof account?.contactUs === 'function'
      && account.hooks?.account) return account;
  }

  function QuickActions({ nav, wide, renderFactorySlot, selectPanel, panels }) {
    const [open, setOpen] = useState(false);
    const trigger = useRef(null);
    const label = t('quickActions');
    const nativeButton = nav.querySelector('button[aria-haspopup="menu"]') ?? nav.querySelector('button');
    const nativeSpans = nativeButton?.querySelectorAll(':scope > span');

    function select(id) {
      setOpen(false);
      trigger.current?.focus();
      selectPanel(id);
    }

    return h('div', { 'data-dsh-quick-actions': '' }, h(Menu, {
      open, portal: true, autoFocus: true,
      onClose: () => setOpen(false),
      onSelect: select,
      className: 'dsh-glass-quick-anchor',
      listClassName: 'dsh-glass-quick-menu',
      anchor: h('button', {
        ref: trigger,
        type: 'button',
        className: nativeButton?.className,
        'aria-label': label,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => setOpen(!open),
        onKeyDown: (event) => {
          if (event.key !== 'ArrowDown' || open) return;
          event.preventDefault();
          setOpen(true);
        },
      },
      h('span', { className: nativeSpans?.[0]?.className, 'aria-hidden': true },
        h(IconAppsAddOutlineRegular, { size: wide ? 16 : 18 })),
      wide && h('span', { className: nativeSpans?.[1]?.className }, label)),
      items: panels.map(({ id, label, active }) => ({
        id, label, icon: renderFactorySlot('sidebar.panel.icon', { id, size: 16, active }),
      })),
    }));
  }

  function SidebarControls({ wide, renderFactorySlot, usePanelInfo }) {
    const enabled = useEnabled();
    const marker = useRef(null);
    const [nav, setNav] = useState(null);
    const [settingsRow, setSettingsRow] = useState(null);
    const activePanelId = usePanelInfo((info) => info.activePanelId);
    useSlotChanges(panelsSlot, 'main', settingsSlot, launcherSlot);

    useLayoutEffect(() => {
      if (!enabled) return;
      const sidebar = marker.current?.closest('[data-slot="sidebar"]');
      if (!sidebar) return;
      const sync = () => {
        setNav(sidebar.querySelector('[data-sidebar-scrollport] > nav'));
        const settings = sidebar.querySelector('[data-slot="sidebar.settings"]');
        setSettingsRow(settings?.querySelector(
          ':scope > :has(> [data-slot="settings.launcher"], button[aria-haspopup="dialog"])',
        ) ?? null);
      };
      sync();
      const observer = new MutationObserver(sync);
      observer.observe(sidebar, { childList: true, subtree: true });
      return () => observer.disconnect();
    }, [enabled, wide]);

    if (!enabled) return null;
    const hostSidebar = entries('sidebar')[0]?.inject?.();
    const mainIds = new Set(ctx.slots.entries('main').map(({ options }) => options.key));
    const panels = entries(panelsSlot)
      .filter(({ options }) => mainIds.has(options.id))
      .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
      .map((entry) => ({
        id: entry.options.id,
        label: labelOf(entry) ?? entry.options.id,
        active: entry.options.id === activePanelId,
      }));
    const nativeSettings = entries(settingsSlot)[0]?.store?.create?.();
    const launcher = entries(launcherSlot)[0];
    const showSettings = settingsRow?.isConnected && typeof nativeSettings?.actions?.open === 'function'
      && (launcher === undefined || accountOperations() !== undefined);

    return h('span', { ref: marker, className: 'dsh-glass-layout-marker' },
      nav?.isConnected && panels.length > 0 && typeof hostSidebar?.selectPanel === 'function'
        && createPortal(h(QuickActions, {
          nav, wide, renderFactorySlot, selectPanel: hostSidebar.selectPanel, panels,
        }), nav),
      showSettings && createPortal(
        h('button', {
          type: 'button',
          'data-dsh-compact-settings': '',
          'aria-label': nativeSettingsLabel('trigger'),
          'aria-haspopup': 'dialog',
          onClick: () => nativeSettings.actions.open(),
        }, h(IconSettingsOutlineMedium, { size: 16 }), wide && nativeSettingsLabel('trigger')),
        settingsRow,
      ),
    );
  }

  function FeedbackRow({ contactUs }) {
    return h('section', { className: 'dsh-glass-account-row' },
      h('h3', null, t('feedback')),
      h(Button, { variant: 'outline', onClick: contactUs }, accountLocale('contactUs')));
  }

  function SignedOutPage({ close }) {
    useSlotChanges(launcherSlot);
    const operations = accountOperations();
    if (!operations) return null;
    return h(SignedOutAccount, { operations, close });
  }

  function SignedOutAccount({ operations, close }) {
    const { subscribe, getSnapshot } = operations.hooks.account;
    const account = useSyncExternalStore(subscribe, getSnapshot);
    const loading = account.view === undefined && !account.failed;
    return h('div', { className: 'dsh-glass-account-page' },
      h('h2', null, t('accountFeedback')),
      h('section', { className: 'dsh-glass-account-row' },
        h('div', null,
          h('h3', null, t('account')),
          h('p', null, loading ? t('accountLoading') : accountLocale('signedOut'))),
        h(Button, {
          variant: 'outline',
          onClick: () => {
            close();
            void operations.start().catch(() => {});
          },
        }, accountLocale('signIn'))),
      h(FeedbackRow, { contactUs: operations.contactUs }),
    );
  }

  function SignedInExtras({ operations }) {
    const [impact, setImpact] = useState(undefined);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    async function requestSignOut() {
      setBusy(true);
      setFailed(false);
      try { setImpact(await operations.hasRunningAccountTasks()); }
      catch { setImpact('unknown'); }
      finally { setBusy(false); }
    }

    async function signOut() {
      setBusy(true);
      setFailed(false);
      try { await operations.signOut(); setImpact(undefined); }
      catch { setFailed(true); }
      finally { setBusy(false); }
    }

    const dismiss = () => { if (!busy) setImpact(undefined); };
    const signOutLabel = accountLocale('signOut');
    const impactLabel = impact === 'unknown' ? 'signOutUnknownDescription'
      : impact ? 'signOutRunningDescription' : 'signOutDescription';
    return h('div', { className: 'dsh-glass-account-page' },
      h('section', { className: 'dsh-glass-account-row' },
        h('h3', null, t('account')),
        h(Button, { variant: 'outline', disabled: busy, onClick: requestSignOut }, signOutLabel)),
      h(FeedbackRow, { contactUs: operations.contactUs }),
      impact !== undefined && h(Modal, { open: true, title: signOutLabel, onClose: dismiss },
        h('p', null, accountLocale(impactLabel)),
        failed && h('p', { role: 'alert' }, accountLocale('failed')),
        h('div', { className: 'dsh-glass-signout-actions' },
          h(Button, { variant: 'outline', disabled: busy, onClick: dismiss }, accountLocale('cancel')),
          h(Button, { variant: 'primary', disabled: busy, onClick: signOut }, signOutLabel))),
    );
  }

  function SignedInSettings() {
    const enabled = useEnabled();
    const marker = useRef(null);
    const [target, setTarget] = useState(null);
    useSlotChanges(sectionSlot, launcherSlot);
    const operations = accountOperations();
    const nativeSection = entries(sectionSlot).find(({ options }) => options.id === nativeAccountSectionId);
    const nativeLabel = nativeSection && labelOf(nativeSection);
    const combinedLabel = t('accountFeedback');

    useLayoutEffect(() => {
      if (!enabled || !operations || !nativeLabel) return;
      const dialog = marker.current?.closest('[data-shortcut-modal="settings"]');
      if (!dialog) return;
      let decorated;
      function restore() {
        decorated?.removeAttribute('data-dsh-account-title');
        decorated?.removeAttribute('aria-label');
      }
      function sync() {
        const button = Array.from(dialog.querySelectorAll(':scope > nav button')).find(
          (candidate) => candidate.lastElementChild?.textContent === nativeLabel,
        );
        if (button !== decorated) {
          restore();
          decorated = button;
          decorated?.setAttribute('data-dsh-account-title', combinedLabel);
          decorated?.setAttribute('aria-label', combinedLabel);
        }
        setTarget(button?.getAttribute('aria-current') === 'true'
          ? dialog.querySelector(':scope > div > [data-slot="settings.section"]')?.parentElement ?? null
          : null);
      }
      sync();
      const observer = new MutationObserver(sync);
      observer.observe(dialog, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['aria-current'],
      });
      return () => { observer.disconnect(); restore(); };
    }, [enabled, operations, nativeLabel, combinedLabel]);

    if (!enabled) return null;
    return h('span', { ref: marker, className: 'dsh-glass-layout-marker' },
      operations && nativeLabel && target?.isConnected
        && createPortal(h(SignedInExtras, { operations }), target));
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: sectionId, locale: namespace,
  }, SidebarControls));
  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action', id: accountSectionId, locale: namespace,
  }, SignedInSettings));
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', id: accountSectionId,
  }, ({ size }) => h(IconUserOutlineMedium, { size })));
  ctx.slots.inject(sectionSlot, () => {
    let remove;
    const sync = () => {
      const nativeAccount = entries(sectionSlot).some(({ options }) => options.id === nativeAccountSectionId);
      if (getPreferences().optimize && !nativeAccount && accountOperations()) {
        remove ??= ctx.slots.register({
          name: sectionSlot, id: accountSectionId, order: 22, locale: namespace,
          label: () => t('accountFeedback'),
        }, SignedOutPage);
      } else if (remove) {
        const dispose = remove;
        remove = undefined;
        dispose();
      }
    };
    const offPreferences = subscribe(sync);
    const offSlots = trackSlots([sectionSlot, launcherSlot], sync);
    sync();
    return () => { offPreferences(); offSlots(); remove?.(); };
  });
  return true;
}
