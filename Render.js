/*
    Render.js
    Written by: Johnathon Largent
    Version 1.3

    Revision:

    1. The Wizard's canvas preview now dims the Back button with a
    "Hidden on first page" hint (.wizard-footer-hidden-here) when the
    canvas is currently showing the first page, matching the new
    Show-<Name>Page runtime behavior (Wizard-Builder.js) without actually
    removing it from the canvas - it stays selectable/movable regardless
    of which page happens to be active while designing.
*/

const RENDER_VERSION = '1.3';

function renderControl(c) {
  const def = CONTROL_DEFS[c.type];
  const el = document.createElement('div');
  el.className = 'ctrl' + (c.id === state.selectedId ? ' selected' : '') + (c.interact ? ' interact-mode' : '');
  el.style.left = c.x + 'px';
  el.style.top = c.y + 'px';
  el.style.width = c.w + 'px';
  el.style.height = c.h + 'px';
  el.style.zIndex = c.z;
  el.dataset.id = c.id;

  const badge = document.createElement('div');
  badge.className = 'ctrl-badge';
  badge.textContent = c.name + '  ' + c.x + ',' + c.y + '  ' + c.w + '\u00d7' + c.h;
  el.appendChild(badge);

  if (def.isTabControl) {
    // Tab switching is a structural design action, not a runtime preview
    // interaction, so the header must stay clickable even when Interact
    // is off - it lives outside .ctrl-inner (which is pointer-events:none
    // unless interacting) rather than going through renderInner().
    el.appendChild(buildTabHeaderStrip(c));

    const body = document.createElement('div');
    body.className = 'rc-tabcontrol-body';
    el.appendChild(body);

    const content = document.createElement('div');
    content.className = 'tabcontrol-content';
    state.controls
      .filter(ch => ch.parentId === c.id && ch.tabPage === c.activeTabId)
      .forEach(ch => content.appendChild(renderControl(ch)));
    el.appendChild(content);
  } else if (def.isWizard) {
    // No clickable tab strip here (unless Contents is Horizontal/Vertical,
    // which IS clickable, same click pattern as TabControl's header) - a
    // plain wizard doesn't show page tabs to the end user, so the design
    // surface doesn't imply one either. Footer children (Back/Next/Cancel,
    // etc.) render in their own full-bounds layer on top, since a real
    // installer's button bar spans under the Contents nav strip too -
    // page content instead renders in a layer offset/shrunk to make room
    // for that strip.
    const body = document.createElement('div');
    body.className = 'wizard-body';
    el.appendChild(body);
    el.appendChild(buildWizardContentsNav(c));
    el.appendChild(buildWizardPageIndicator(c));

    const pageContent = document.createElement('div');
    pageContent.className = 'wizard-content wizard-content-' + (c.props.contentsStyle || 'None').toLowerCase();
    state.controls
      .filter(ch => ch.parentId === c.id && !ch.wizardFooter && ch.tabPage === c.activeTabId)
      .forEach(ch => pageContent.appendChild(renderControl(ch)));
    el.appendChild(pageContent);

    const footerContent = document.createElement('div');
    footerContent.className = 'wizard-footer-content';
    const onFirstPage = (c.props.pages || [])[0] && (c.props.pages || [])[0].id === c.activeTabId;
    state.controls
      .filter(ch => ch.parentId === c.id && ch.wizardFooter)
      .forEach(ch => {
        const childEl = renderControl(ch);
        // Back is hidden (not just disabled) on the first page at runtime -
        // dim it here rather than actually removing it, so it stays visible
        // and selectable/movable while designing regardless of which page
        // happens to be showing.
        if (ch.wizardRole === 'back' && onFirstPage) childEl.classList.add('wizard-footer-hidden-here');
        footerContent.appendChild(childEl);
      });
    el.appendChild(footerContent);
  } else {
    const inner = document.createElement('div');
    inner.className = 'ctrl-inner';
    inner.style.cssText += borderStyleFor(c.props, c.type);
    inner.style.boxSizing = 'border-box';
    inner.appendChild(renderInner(c));
    el.appendChild(inner);

    if (def.isContainer) {
      state.controls.filter(ch => ch.parentId === c.id).forEach(ch => el.appendChild(renderControl(ch)));
    }
  }

  if (c.id === state.selectedId) {
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(pos => {
      const h = document.createElement('div');
      h.className = 'resize-handle rh-' + pos;
      h.dataset.handle = pos;
      el.appendChild(h);
    });
  }

  el.addEventListener('mousedown', onControlMouseDown);
  return el;
}

function buildTabHeaderStrip(c) {
  const header = document.createElement('div');
  header.className = 'rc-tabcontrol-header';
  (c.props.tabs || []).forEach(tab => {
    const btn = document.createElement('div');
    btn.className = 'rc-tabcontrol-tab' + (tab.id === c.activeTabId ? ' active' : '');
    btn.textContent = tab.label;
    btn.title = 'Click to switch to this tab page while designing.';
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      c.activeTabId = tab.id;
      selectControl(c.id);
    });
    header.appendChild(btn);
  });
  return header;
}

function fontStyleFor(p) {
  return `font-family:${p.fontFamily};font-size:${p.fontSize}px;font-weight:${p.fontBold ? '700' : '400'};font-style:${p.fontItalic ? 'italic' : 'normal'};`;
}

const BORDER_STYLE_VISIBLE_TYPES = new Set([
  'TextBox', 'ComboBox', 'ListBox', 'NumericUpDown', 'DateTimePicker',
  'RichTextBox', 'PictureBox', 'Panel', 'GroupBox',
]);

function borderStyleFor(p, type) {
  if (!p || !('borderStyle' in p) || !BORDER_STYLE_VISIBLE_TYPES.has(type)) return '';
  switch (p.borderStyle) {
    case 'None': return 'border:none;';
    case 'Fixed3D': return 'border:2px inset #dcdcdc;';
    case 'FixedSingle': default: return 'border:1px solid #7d8390;';
  }
}

function renderInner(c) {
  const p = c.props;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:100%;height:100%;' + (p.visible === false ? 'opacity:0.35;' : '');

  switch (c.type) {
    case 'Button': {
      wrap.innerHTML = `<div class="rc-button" style="${fontStyleFor(p)}background:${p.backColor};color:${p.foreColor};">${escapeHtml(p.text)}</div>`;
      break;
    }
    case 'Label': {
      wrap.innerHTML = `<div class="rc-label" style="${fontStyleFor(p)}color:${p.foreColor};text-align:${p.textAlign.toLowerCase()};">${escapeHtml(p.text)}</div>`;
      break;
    }
    case 'TextBox': {
      if (p.multiline) {
        wrap.innerHTML = `<textarea class="rc-textbox rc-textbox-multiline" style="${fontStyleFor(p)}background:${p.backColor};color:${p.foreColor};" maxlength="${p.maxLength || ''}" ${p.readOnly ? 'readonly' : ''} ${c.interact ? '' : 'disabled'}>${escapeHtml(p.text)}</textarea>`;
      } else {
        wrap.innerHTML = `<input type="${p.passwordChar ? 'password' : 'text'}" class="rc-textbox" style="${fontStyleFor(p)}background:${p.backColor};color:${p.foreColor};" value="${escapeHtml(p.text)}" maxlength="${p.maxLength || ''}" ${p.readOnly ? 'readonly' : ''} ${c.interact ? '' : 'disabled'}>`;
      }
      if (c.interact) wrap.querySelector('input,textarea').addEventListener('input', (e) => { p.text = e.target.value; });
      break;
    }
    case 'MaskedTextBox': {
      wrap.innerHTML = `<input type="text" class="rc-textbox" style="${fontStyleFor(p)}" placeholder="${escapeHtml(p.mask)}" value="${escapeHtml(p.text)}" ${c.interact ? '' : 'disabled'}>`;
      if (c.interact) wrap.querySelector('input').addEventListener('input', (e) => { p.text = e.target.value; });
      break;
    }
    case 'CheckBox': {
      wrap.innerHTML = `<label class="rc-check" style="${fontStyleFor(p)}color:${p.foreColor};"><input type="checkbox" ${p.checked ? 'checked' : ''} ${c.interact ? '' : 'disabled'}>${escapeHtml(p.text)}</label>`;
      if (c.interact) wrap.querySelector('input').addEventListener('change', (e) => { p.checked = e.target.checked; });
      break;
    }
    case 'RadioButton': {
      wrap.innerHTML = `<label class="rc-radio" style="${fontStyleFor(p)}color:${p.foreColor};"><input type="radio" ${p.checked ? 'checked' : ''} ${c.interact ? '' : 'disabled'}>${escapeHtml(p.text)}</label>`;
      if (c.interact) wrap.querySelector('input').addEventListener('change', (e) => { p.checked = e.target.checked; });
      break;
    }
    case 'ComboBox': {
      const items = (p.items || '').split('\n').filter(Boolean);
      if (p.dropDownStyle === 'DropDownList') {
        // Pick-only: a native select is the correct fit here.
        wrap.innerHTML = `<select class="rc-combo" style="${fontStyleFor(p)}" ${c.interact ? '' : 'disabled'}>${items.map((it, i) => `<option ${i === p.selectedIndex ? 'selected' : ''}>${escapeHtml(it)}</option>`).join('')}</select>`;
        if (c.interact) wrap.querySelector('select').addEventListener('change', (e) => {
          p.selectedIndex = e.target.selectedIndex;
          p.text = items[e.target.selectedIndex] || '';
        });
      } else {
        // DropDown / Simple: the user can type a custom value, not just
        // pick from the list - a native <select> can never do that, so
        // this needs a real editable field. A datalist keeps the existing
        // items available as suggestions without blocking free typing.
        const listId = 'dl_' + c.id;
        const currentText = p.text != null && p.text !== '' ? p.text : (items[p.selectedIndex] || '');
        wrap.innerHTML = `<input type="text" class="rc-combo rc-combo-editable" list="${listId}" style="${fontStyleFor(p)}" placeholder="Type or pick an item..." value="${escapeHtml(currentText)}" ${c.interact ? '' : 'disabled'}>
          <datalist id="${listId}">${items.map(it => `<option value="${escapeHtml(it)}"></option>`).join('')}</datalist>`;
        if (c.interact) wrap.querySelector('input').addEventListener('input', (e) => {
          p.text = e.target.value;
          p.selectedIndex = items.indexOf(e.target.value);
        });
      }
      break;
    }
    case 'ListBox': {
      const items = (p.items || '').split('\n').filter(Boolean);
      const list = document.createElement('div');
      list.className = 'rc-listbox-custom';
      list.style.cssText = fontStyleFor(p);
      if (!p.selectedIndices) p.selectedIndices = [];

      items.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'rc-listbox-item' + (p.selectedIndices.includes(i) ? ' selected' : '');
        row.textContent = it;
        if (c.interact && p.selectionMode !== 'None') {
          row.addEventListener('click', (e) => {
            const mode = p.selectionMode;
            if (mode === 'One') {
              p.selectedIndices = [i];
            } else if (mode === 'MultiSimple') {
              // Real WinForms MultiSimple: plain click-click-click toggles
              // an item in/out of the selection, no modifier key needed.
              const idx = p.selectedIndices.indexOf(i);
              if (idx >= 0) p.selectedIndices.splice(idx, 1);
              else p.selectedIndices.push(i);
            } else if (mode === 'MultiExtended') {
              if (e.shiftKey && p.selectedIndices.length) {
                const anchor = p.selectedIndices[p.selectedIndices.length - 1];
                const [lo, hi] = anchor < i ? [anchor, i] : [i, anchor];
                const range = [];
                for (let k = lo; k <= hi; k++) range.push(k);
                p.selectedIndices = range;
              } else if (e.ctrlKey || e.metaKey) {
                const idx = p.selectedIndices.indexOf(i);
                if (idx >= 0) p.selectedIndices.splice(idx, 1);
                else p.selectedIndices.push(i);
              } else {
                p.selectedIndices = [i];
              }
            }
            render();
          });
        }
        list.appendChild(row);
      });
      wrap.appendChild(list);
      break;
    }
    case 'CheckedListBox': {
      const items = (p.items || '').split('\n').filter(Boolean);
      const list = document.createElement('div');
      list.className = 'rc-listbox-custom rc-checkedlistbox';
      list.style.cssText = fontStyleFor(p);
      if (!p.checkedIndices) p.checkedIndices = [];

      items.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'rc-listbox-item rc-checkedlistbox-item';
        const isChecked = p.checkedIndices.includes(i);
        const box = document.createElement('span');
        box.className = 'rc-checkedlistbox-box' + (isChecked ? ' checked' : '');
        box.textContent = isChecked ? '\u2611' : '\u2610';
        const label = document.createElement('span');
        label.textContent = it;
        row.appendChild(box);
        row.appendChild(label);
        if (c.interact) {
          row.addEventListener('click', () => {
            const idx = p.checkedIndices.indexOf(i);
            if (idx >= 0) p.checkedIndices.splice(idx, 1);
            else p.checkedIndices.push(i);
            render();
          });
        }
        list.appendChild(row);
      });
      wrap.appendChild(list);
      break;
    }
    case 'Panel': {
      wrap.innerHTML = `<div class="rc-panel" style="background:${p.backColor};"></div>`;
      break;
    }
    case 'FlowLayoutPanel': {
      wrap.innerHTML = `<div class="rc-flowpanel" style="background:${p.backColor};" title="Flow: ${p.flowDirection}"></div>`;
      break;
    }
    case 'TableLayoutPanel': {
      const cols = Math.max(1, p.columnCount || 1);
      const rows = Math.max(1, p.rowCount || 1);
      const vLines = Array.from({ length: cols - 1 }, (_, i) => `<div class="rc-table-vline" style="left:${(100 / cols) * (i + 1)}%;"></div>`).join('');
      const hLines = Array.from({ length: rows - 1 }, (_, i) => `<div class="rc-table-hline" style="top:${(100 / rows) * (i + 1)}%;"></div>`).join('');
      wrap.innerHTML = `<div class="rc-tablepanel" style="background:${p.backColor};">${vLines}${hLines}</div>`;
      break;
    }
    case 'GroupBox': {
      wrap.innerHTML = `<div class="rc-groupbox" style="background:${p.backColor};"><span class="gb-title">${escapeHtml(p.text)}</span></div>`;
      break;
    }
    case 'PictureBox': {
      wrap.innerHTML = `<div class="rc-picture">${p.imageSource ? escapeHtml(p.imageSource) : 'PictureBox'}</div>`;
      break;
    }
    case 'ProgressBar': {
      const pct = Math.max(0, Math.min(100, ((p.value - p.min) / (p.max - p.min || 1)) * 100));
      wrap.innerHTML = `<div class="rc-progress"><div class="rc-progress-fill" style="width:${pct}%;"></div></div>`;
      break;
    }
    case 'TrackBar': {
      wrap.innerHTML = `<div class="rc-track"><input type="range" min="${p.min}" max="${p.max}" value="${p.value}" ${c.interact ? '' : 'disabled'}></div>`;
      if (c.interact) wrap.querySelector('input').addEventListener('input', (e) => { p.value = Number(e.target.value); });
      break;
    }
    case 'MenuStrip': {
      wrap.appendChild(renderMenuStripPreview(p));
      break;
    }
    case 'StatusStrip': {
      wrap.innerHTML = `<div class="rc-statusstrip">${escapeHtml(p.text)}</div>`;
      break;
    }
    case 'ToolStrip': {
      const items = p.items || [];
      wrap.innerHTML = `<div class="rc-toolstrip">${items.map(it => `<div class="rc-toolstrip-btn"><span class="rc-toolstrip-icon">${toolStripIconSvg(it.icon)}</span><span class="rc-toolstrip-label">${escapeHtml(it.label)}</span></div>`).join('')}</div>`;
      break;
    }
    case 'NumericUpDown': {
      wrap.innerHTML = `<input type="number" class="rc-numeric" style="${fontStyleFor(p)}" min="${p.min}" max="${p.max}" step="${p.increment}" value="${p.value}" ${c.interact ? '' : 'disabled'}>`;
      if (c.interact) wrap.querySelector('input').addEventListener('change', (e) => { p.value = Number(e.target.value) || 0; });
      break;
    }
    case 'DateTimePicker': {
      if (c.interact) {
        const inputType = p.format === 'Time' ? 'time' : 'date';
        wrap.innerHTML = `<input type="${inputType}" class="rc-datetime-input" style="${fontStyleFor(p)}">`;
        const inp = wrap.querySelector('input');
        if (p.value) inp.value = p.value;
        inp.addEventListener('change', (e) => { p.value = e.target.value; });
      } else {
        wrap.innerHTML = `<div class="rc-datetime" style="${fontStyleFor(p)}">${escapeHtml(formatDateTimePreview(p))}</div>`;
      }
      break;
    }
    case 'RichTextBox': {
      wrap.innerHTML = `<textarea class="rc-richtext" style="${fontStyleFor(p)}background:${p.backColor || '#FFFFFF'};color:${p.foreColor};" ${c.interact ? '' : 'disabled'}>${escapeHtml(p.text)}</textarea>`;
      if (c.interact) wrap.querySelector('textarea').addEventListener('input', (e) => { p.text = e.target.value; });
      break;
    }
    case 'LinkLabel': {
      wrap.innerHTML = `<div class="rc-link" style="${fontStyleFor(p)}">${escapeHtml(p.text)}</div>`;
      break;
    }
  }
  return wrap;
}

// Renders a Date using .NET-style custom format tokens (the same tokens
// WinForms' DateTimePicker.CustomFormat uses), so the designer preview
// and the real generated behavior agree. Supports the common tokens:
// dd/d, MMM/MMMM/MM/M, yyyy/yy, HH/hh/H/h, mm, ss, tt.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatDateCustom(d, fmt) {
  const pad = (n, len) => String(n).padStart(len, '0');
  const h24 = d.getHours();
  const h12 = ((h24 + 11) % 12) + 1;
  return fmt.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|ss|tt/g, (token) => {
    switch (token) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy': return pad(d.getFullYear() % 100, 2);
      case 'MMMM': return MONTH_FULL[d.getMonth()];
      case 'MMM': return MONTH_ABBR[d.getMonth()];
      case 'MM': return pad(d.getMonth() + 1, 2);
      case 'M': return String(d.getMonth() + 1);
      case 'dddd': return d.toLocaleDateString(undefined, { weekday: 'long' });
      case 'ddd': return d.toLocaleDateString(undefined, { weekday: 'short' });
      case 'dd': return pad(d.getDate(), 2);
      case 'd': return String(d.getDate());
      case 'HH': return pad(h24, 2);
      case 'H': return String(h24);
      case 'hh': return pad(h12, 2);
      case 'h': return String(h12);
      case 'mm': return pad(d.getMinutes(), 2);
      case 'ss': return pad(d.getSeconds(), 2);
      case 'tt': return h24 < 12 ? 'AM' : 'PM';
      default: return token;
    }
  });
}

function formatDateTimePreview(p) {
  let d = p.value ? new Date(p.value) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  switch (p.format) {
    case 'Long': return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    case 'Short': return d.toLocaleDateString();
    case 'Time': return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'Custom': return formatDateCustom(d, p.customFormat || 'dd MMM yyyy');
    default: return d.toLocaleDateString();
  }
}

function renderMenuStripPreview(p) {
  const bar = document.createElement('div');
  bar.className = 'rc-menustrip';
  (p.menuItems || []).filter(m => m.enabled).forEach(m => {
    const top = document.createElement('div');
    top.className = 'rc-menustrip-item';
    top.textContent = m.label;
    const sub = document.createElement('div');
    sub.className = 'rc-menustrip-sub';
    (m.items || []).filter(it => it.enabled).forEach(it => {
      const row = document.createElement('div');
      if (it.label === '-') { row.className = 'rc-menustrip-sep'; }
      else { row.className = 'rc-menustrip-subitem'; row.textContent = it.label; }
      sub.appendChild(row);
    });
    if (sub.children.length) top.appendChild(sub);
    bar.appendChild(top);
  });
  return bar;
}
