(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DRCustomSelect = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function optionModel(options, selectedValue) {
    const value = String(selectedValue ?? '');
    const items = Array.from(options || []).map((option, index) => ({
      value: String(option?.value ?? ''),
      label: String(option?.label ?? option?.textContent ?? option?.value ?? ''),
      disabled: !!option?.disabled,
      index
    }));
    let selectedIndex = items.findIndex(item => item.value === value);
    if (selectedIndex < 0 && items.length) selectedIndex = 0;
    return {
      items,
      selectedIndex,
      selected: selectedIndex >= 0 ? items[selectedIndex] : null
    };
  }

  function findNextEnabledIndex(items, currentIndex, direction) {
    if (!Array.isArray(items) || !items.length) return -1;
    const step = direction < 0 ? -1 : 1;
    let index = Number.isInteger(currentIndex) ? currentIndex : -1;
    for (let count = 0; count < items.length; count += 1) {
      index = (index + step + items.length) % items.length;
      if (!items[index]?.disabled) return index;
    }
    return -1;
  }

  const controllers = new Set();
  let activeController = null;

  function ownerForTarget(target) {
    if (!target || typeof target.closest !== 'function') return null;
    const menu = target.closest('.custom-select-menu');
    if (menu?._customSelectController) return menu._customSelectController;
    const wrapper = target.closest('.custom-select');
    return wrapper?._customSelectController || null;
  }

  function viewportSize(doc) {
    const view = doc?.defaultView;
    return {
      width: doc?.documentElement?.clientWidth || view?.innerWidth || 0,
      height: doc?.documentElement?.clientHeight || view?.innerHeight || 0
    };
  }

  function installDocumentHandlers(doc) {
    if (!doc || doc._drCustomSelectHandlersInstalled) return;
    doc._drCustomSelectHandlersInstalled = true;
    doc.addEventListener('pointerdown', event => {
      if (!activeController) return;
      const owner = ownerForTarget(event.target);
      if (owner !== activeController) activeController.close();
    });
    const view = doc.defaultView;
    if (view) {
      const reposition = () => activeController?.position();
      view.addEventListener('resize', reposition);
      view.addEventListener('scroll', reposition, true);
    }
  }

  function install(select) {
    if (!select || select.tagName !== 'SELECT') return null;
    if (select._customSelectController) return select._customSelectController;

    const doc = select.ownerDocument || document;
    installDocumentHandlers(doc);

    const wrapper = doc.createElement('div');
    wrapper.className = 'custom-select';
    for (const className of select.classList || []) wrapper.classList.add(className);
    wrapper.dataset.customSelect = 'true';

    const trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.title || '选择');
    trigger.title = select.title || '';

    const label = doc.createElement('span');
    label.className = 'custom-select-label';
    const chevron = doc.createElement('span');
    chevron.className = 'custom-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(label, chevron);

    const menu = doc.createElement('div');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    if (select.id) menu.id = `${select.id}-custom-menu`;

    const controller = {
      select,
      wrapper,
      trigger,
      label,
      menu,
      model: optionModel(select.options, select.value),
      isOpen: false,
      activeIndex: -1,
      close,
      position,
      sync
    };
    wrapper._customSelectController = controller;
    menu._customSelectController = controller;
    trigger.setAttribute('aria-controls', menu.id || '');

    function setActive(index, shouldFocus = false) {
      if (!controller.model.items.length) return;
      const item = controller.model.items[index];
      if (!item || item.disabled) return;
      controller.activeIndex = index;
      for (const optionButton of menu.querySelectorAll('.custom-select-option')) {
        const active = Number(optionButton.dataset.index) === index;
        optionButton.classList.toggle('active', active);
        if (active && shouldFocus) optionButton.focus();
      }
    }

    function focusNext(direction) {
      const index = findNextEnabledIndex(controller.model.items, controller.activeIndex, direction);
      if (index >= 0) setActive(index, true);
    }

    function choose(index) {
      const item = controller.model.items[index];
      if (!item || item.disabled || controller.select.disabled) return;
      const changed = controller.select.value !== item.value;
      controller.select.value = item.value;
      close();
      if (changed) controller.select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    }

    function renderOptions() {
      menu.innerHTML = '';
      controller.model = optionModel(select.options, select.value);
      const selectedIndex = controller.model.selectedIndex;
      controller.activeIndex = selectedIndex;
      controller.model.items.forEach(item => {
        const optionButton = doc.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'custom-select-option';
        optionButton.dataset.index = String(item.index);
        optionButton.dataset.value = item.value;
        optionButton.textContent = item.label;
        optionButton.disabled = item.disabled;
        optionButton.setAttribute('role', 'option');
        optionButton.setAttribute('aria-selected', String(item.index === selectedIndex));
        if (item.index === selectedIndex) optionButton.classList.add('selected');
        optionButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          choose(item.index);
        });
        menu.appendChild(optionButton);
      });
      if (controller.isOpen) setActive(controller.activeIndex);
    }

    function sync() {
      renderOptions();
      const selected = controller.model.selected;
      label.textContent = selected?.label || '请选择';
      trigger.disabled = !!select.disabled || !controller.model.items.length;
      wrapper.classList.toggle('is-disabled', trigger.disabled);
      wrapper.classList.toggle('is-open', controller.isOpen);
      trigger.setAttribute('aria-expanded', String(controller.isOpen));
      trigger.setAttribute('aria-disabled', String(trigger.disabled));
      if (select.disabled && controller.isOpen) close();
    }

    function position() {
      if (!controller.isOpen || menu.parentNode !== doc.body) return;
      const rect = trigger.getBoundingClientRect();
      const viewport = viewportSize(doc);
      const edge = 8;
      const availableWidth = Math.max(0, viewport.width - edge * 2);
      // 先按内容测量，长选项可适度撑宽；超过视口时由选项自己的省略规则兜底。
      const contentMaxWidth = Math.min(availableWidth, Math.max(rect.width, 420));
      menu.style.width = 'max-content';
      menu.style.maxWidth = `${contentMaxWidth}px`;
      menu.style.left = '0px';
      menu.style.top = '0px';
      const contentWidth = menu.getBoundingClientRect().width;
      const width = Math.min(Math.max(rect.width, 148, contentWidth), availableWidth);
      menu.style.width = `${width}px`;
      const menuRect = menu.getBoundingClientRect();
      const below = rect.bottom + edge;
      const above = rect.top - edge - menuRect.height;
      const top = below + menuRect.height <= viewport.height - edge || above < edge
        ? below
        : above;
      const left = Math.min(Math.max(edge, rect.left), Math.max(edge, viewport.width - width - edge));
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(Math.max(edge, top))}px`;
    }

    function open() {
      if (trigger.disabled) return;
      if (activeController && activeController !== controller) activeController.close();
      activeController = controller;
      controller.isOpen = true;
      wrapper.classList.add('is-open');
      menu.hidden = false;
      doc.body.appendChild(menu);
      trigger.setAttribute('aria-expanded', 'true');
      position();
      setActive(controller.model.selectedIndex);
    }

    function close() {
      controller.isOpen = false;
      wrapper.classList.remove('is-open');
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (menu.parentNode === doc.body) wrapper.appendChild(menu);
      menu.style.width = '';
      menu.style.maxWidth = '';
      menu.style.left = '';
      menu.style.top = '';
      if (activeController === controller) activeController = null;
    }

    trigger.addEventListener('click', event => {
      event.stopPropagation();
      if (controller.isOpen) close();
      else open();
    });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (controller.isOpen) {
          event.preventDefault();
          close();
        }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (controller.isOpen) close();
        else open();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        if (!controller.isOpen) open();
        focusNext(direction);
      }
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        trigger.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusNext(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const direction = event.key === 'Home' ? 1 : -1;
        const start = event.key === 'Home' ? -1 : 0;
        const index = findNextEnabledIndex(controller.model.items, start, direction);
        if (index >= 0) setActive(index, true);
      } else if (event.key === 'Tab') {
        close();
      }
    });

    const parent = select.parentNode;
    if (!parent) return null;
    parent.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.append(trigger, menu);
    select.classList.add('custom-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select._customSelectController = controller;
    select._customSelectSync = sync;
    if (typeof MutationObserver !== 'undefined') {
      controller.observer = new MutationObserver(sync);
      controller.observer.observe(select, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'label', 'value']
      });
    }
    controllers.add(controller);
    sync();
    return controller;
  }

  function enhanceAll(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return [];
    return [...doc.querySelectorAll('select')].map(install).filter(Boolean);
  }

  function syncSelect(select) {
    select?._customSelectSync?.();
  }

  return {
    optionModel,
    findNextEnabledIndex,
    install,
    enhanceAll,
    sync: syncSelect,
    ownerForTarget,
    controllers
  };
});
