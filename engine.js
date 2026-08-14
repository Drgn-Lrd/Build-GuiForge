/*
    engine.js
    Written by: Johnathon Largent
    Version 1.0

    Initial engine for the GUI Designer. Implements the control catalog
    (16 control types with common + type-specific + event schemas), the
    in-memory design model, canvas rendering, drag-to-place / drag-to-move
    / 8-handle resize interactions with grid snapping, the dynamic
    properties pane (layout, appearance, control-specific, events with a
    snippet-insert helper, arrow-key nudge d-pad, per-control interact
    toggle), the format switcher, and code generators for HTML, WinForms
    (PowerShell), WPF (XAML + PowerShell loader), and a WinUI 3 scaffold.
*/

const ENGINE_VERSION = '1.0';

/* =========================================================================
   Control catalog
   ========================================================================= */

// Property field shorthand: [key, label, type, default, extra]
// type: text | number | checkbox | color | select | textarea
const COMMON_APPEARANCE_PROPS = [
  ['backColor', 'Back Color', 'color', '#ece9d8'],
  ['foreColor', 'Fore Color', 'color', '#1a1a1a'],
  ['fontFamily', 'Font Family', 'select', 'Segoe UI', { options: ['Segoe UI', 'Arial', 'Tahoma', 'Consolas', 'Verdana', 'Times New Roman'] }],
  ['fontSize', 'Font Size', 'number', 9],
  ['fontBold', 'Bold', 'checkbox', false],
  ['fontItalic', 'Italic', 'checkbox', false],
  ['borderStyle', 'Border Style', 'select', 'FixedSingle', { options: ['None', 'FixedSingle', 'Fixed3D'] }],
];

const COMMON_BEHAVIOR_PROPS = [
  ['visible', 'Visible', 'checkbox', true],
  ['enabled', 'Enabled', 'checkbox', true],
  ['tabIndex', 'Tab Index', 'number', 0],
  ['toolTip', 'Tool Tip', 'text', ''],
];

const CONTROL_DEFS = {
  Button: {
    label: 'Button', glyph: 'Bt', defaultW: 90, defaultH: 26,
    props: [['text', 'Text', 'text', 'Button']],
    events: ['Click'],
  },
  Label: {
    label: 'Label', glyph: 'Ab', defaultW: 90, defaultH: 20,
    props: [
      ['text', 'Text', 'text', 'Label'],
      ['textAlign', 'Text Align', 'select', 'Left', { options: ['Left', 'Center', 'Right'] }],
    ],
    events: ['Click'],
  },
  TextBox: {
    label: 'TextBox', glyph: 'Tb', defaultW: 120, defaultH: 22,
    props: [
      ['text', 'Text', 'text', ''],
      ['multiline', 'Multiline', 'checkbox', false],
      ['readOnly', 'Read Only', 'checkbox', false],
      ['passwordChar', 'Password Char', 'text', ''],
      ['maxLength', 'Max Length', 'number', 0],
    ],
    events: ['TextChanged', 'Enter', 'Leave', 'KeyDown'],
  },
  CheckBox: {
    label: 'CheckBox', glyph: 'Ck', defaultW: 110, defaultH: 22,
    props: [
      ['text', 'Text', 'text', 'CheckBox'],
      ['checked', 'Checked', 'checkbox', false],
    ],
    events: ['CheckedChanged', 'Click'],
  },
  RadioButton: {
    label: 'Radio Button', glyph: 'Rb', defaultW: 110, defaultH: 22,
    props: [
      ['text', 'Text', 'text', 'RadioButton'],
      ['checked', 'Checked', 'checkbox', false],
      ['groupName', 'Group Name', 'text', 'group1'],
    ],
    events: ['CheckedChanged', 'Click'],
  },
  ComboBox: {
    label: 'ComboBox', glyph: 'Cb', defaultW: 130, defaultH: 22,
    props: [
      ['items', 'Items', 'textarea', 'Item 1\nItem 2\nItem 3', { itemsEditor: true }],
      ['selectedIndex', 'Selected Index', 'number', -1],
      ['dropDownStyle', 'DropDown Style', 'select', 'DropDown', { options: ['DropDown', 'DropDownList', 'Simple'] }],
    ],
    events: ['SelectedIndexChanged', 'TextChanged'],
  },
  ListBox: {
    label: 'ListBox', glyph: 'Lb', defaultW: 130, defaultH: 90,
    props: [
      ['items', 'Items', 'textarea', 'Item 1\nItem 2\nItem 3', { itemsEditor: true }],
      ['selectionMode', 'Selection Mode', 'select', 'One', { options: ['None', 'One', 'MultiSimple', 'MultiExtended'] }],
    ],
    events: ['SelectedIndexChanged'],
  },
  Panel: {
    label: 'Panel', glyph: 'Pn', defaultW: 200, defaultH: 140,
    props: [], events: ['Click'], isContainer: true,
  },
  GroupBox: {
    label: 'GroupBox', glyph: 'Gb', defaultW: 200, defaultH: 140,
    props: [['text', 'Text', 'text', 'GroupBox']],
    events: [], isContainer: true,
  },
  PictureBox: {
    label: 'PictureBox', glyph: 'Px', defaultW: 100, defaultH: 100,
    props: [
      ['imageSource', 'Image Source', 'text', ''],
      ['sizeMode', 'Size Mode', 'select', 'Zoom', { options: ['Normal', 'StretchImage', 'AutoSize', 'CenterImage', 'Zoom'] }],
    ],
    events: ['Click'],
  },
  ProgressBar: {
    label: 'ProgressBar', glyph: '%%', defaultW: 150, defaultH: 20,
    props: [
      ['min', 'Min', 'number', 0],
      ['max', 'Max', 'number', 100],
      ['value', 'Value', 'number', 40],
    ],
    events: [],
  },
  TrackBar: {
    label: 'TrackBar', glyph: '/\\', defaultW: 150, defaultH: 30,
    props: [
      ['min', 'Min', 'number', 0],
      ['max', 'Max', 'number', 10],
      ['value', 'Value', 'number', 5],
      ['tickFrequency', 'Tick Frequency', 'number', 1],
    ],
    events: ['ValueChanged', 'Scroll'],
  },
  NumericUpDown: {
    label: 'NumericUpDown', glyph: '#u', defaultW: 80, defaultH: 22,
    props: [
      ['min', 'Min', 'number', 0],
      ['max', 'Max', 'number', 100],
      ['value', 'Value', 'number', 0],
      ['increment', 'Increment', 'number', 1],
      ['decimalPlaces', 'Decimal Places', 'number', 0],
    ],
    events: ['ValueChanged'],
  },
  DateTimePicker: {
    label: 'DateTimePicker', glyph: 'Dt', defaultW: 130, defaultH: 22,
    props: [
      ['format', 'Format', 'select', 'Long', { options: ['Long', 'Short', 'Time', 'Custom'] }],
      ['value', 'Value', 'text', ''],
    ],
    events: ['ValueChanged'],
  },
  RichTextBox: {
    label: 'RichTextBox', glyph: 'Rt', defaultW: 180, defaultH: 100,
    props: [['text', 'Text', 'textarea', '']],
    events: ['TextChanged'],
  },
  LinkLabel: {
    label: 'LinkLabel', glyph: 'Ln', defaultW: 100, defaultH: 20,
    props: [
      ['text', 'Text', 'text', 'link'],
      ['url', 'URL', 'text', 'https://'],
    ],
    events: ['LinkClicked'],
  },
};

const TOOLBOX_GROUPS = [
  { heading: 'Common', types: ['Button', 'Label', 'TextBox', 'CheckBox', 'RadioButton', 'LinkLabel'] },
  { heading: 'Lists & Selection', types: ['ComboBox', 'ListBox', 'NumericUpDown', 'DateTimePicker', 'TrackBar'] },
  { heading: 'Containers', types: ['Panel', 'GroupBox'] },
  { heading: 'Display', types: ['PictureBox', 'ProgressBar', 'RichTextBox'] },
];

/* =========================================================================
   State
   ========================================================================= */

const state = {
  controls: [],          // flat list, parentId links containment
  selectedId: null,
  counters: {},
  gridSize: 5,
  snapEnabled: true,
  nudgeStep: 5,
  currentFormat: 'html',
  form: {
    text: 'MyForm',
    width: 640,
    height: 420,
    backColor: '#10243c',
    events: { Load: { fn: 'Form_Load', code: '', ps1: '' } },
  },
};

function nextName(type) {
  state.counters[type] = (state.counters[type] || 0) + 1;
  return type + state.counters[type];
}

function getControl(id) { return state.controls.find(c => c.id === id); }

function createControl(type, x, y, parentId) {
  const def = CONTROL_DEFS[type];
  const name = nextName(type);
  const props = {};
  def.props.forEach(([key, , , def0]) => { props[key] = def0; });
  COMMON_APPEARANCE_PROPS.forEach(([key, , , def0]) => { props[key] = def0; });
  COMMON_BEHAVIOR_PROPS.forEach(([key, , , def0]) => { props[key] = def0; });
  const events = {};
  def.events.forEach(evt => { events[evt] = null; }); // null = not wired up yet

  const ctrl = {
    id: 'c' + Math.random().toString(36).slice(2, 10),
    type, name,
    parentId: parentId || null,
    x: snap(x), y: snap(y),
    w: def.defaultW, h: def.defaultH,
    z: state.controls.length + 1,
    interact: false,
    props, events,
  };
  state.controls.push(ctrl);
  return ctrl;
}

function snap(v) {
  if (!state.snapEnabled) return Math.round(v);
  return Math.round(v / state.gridSize) * state.gridSize;
}

/* =========================================================================
   Rendering
   ========================================================================= */

const surfaceEl = () => document.getElementById('designSurface');

function render() {
  const surface = surfaceEl();
  surface.innerHTML = '';
  state.controls
    .filter(c => !c.parentId)
    .forEach(c => surface.appendChild(renderControl(c)));
  renderFormChrome();
  renderProps();
  renderStatus();
}

function renderFormChrome() {
  document.getElementById('designForm').style.width = state.form.width + 'px';
  document.getElementById('designForm').style.height = (state.form.height + 26) + 'px';
  document.getElementById('designSurface').style.height = state.form.height + 'px';
  document.getElementById('designSurface').style.background = state.form.backColor;
  document.getElementById('formTitleText').textContent = state.form.text;
}

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

  const inner = document.createElement('div');
  inner.className = 'ctrl-inner';
  inner.appendChild(renderInner(c));
  el.appendChild(inner);

  if (def.isContainer) {
    state.controls.filter(ch => ch.parentId === c.id).forEach(ch => el.appendChild(renderControl(ch)));
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

function fontStyleFor(p) {
  return `font-family:${p.fontFamily};font-size:${p.fontSize}px;font-weight:${p.fontBold ? '700' : '400'};font-style:${p.fontItalic ? 'italic' : 'normal'};`;
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
      wrap.innerHTML = `<div class="rc-textbox" style="${fontStyleFor(p)}background:${p.backColor};color:${p.foreColor};">${escapeHtml(p.passwordChar ? p.passwordChar.repeat(p.text.length) : p.text)}</div>`;
      break;
    }
    case 'CheckBox': {
      wrap.innerHTML = `<label class="rc-check" style="${fontStyleFor(p)}color:${p.foreColor};"><input type="checkbox" ${p.checked ? 'checked' : ''} disabled>${escapeHtml(p.text)}</label>`;
      break;
    }
    case 'RadioButton': {
      wrap.innerHTML = `<label class="rc-radio" style="${fontStyleFor(p)}color:${p.foreColor};"><input type="radio" ${p.checked ? 'checked' : ''} disabled>${escapeHtml(p.text)}</label>`;
      break;
    }
    case 'ComboBox': {
      const items = (p.items || '').split('\n').filter(Boolean);
      wrap.innerHTML = `<select class="rc-combo" style="${fontStyleFor(p)}" disabled>${items.map((it, i) => `<option ${i === p.selectedIndex ? 'selected' : ''}>${escapeHtml(it)}</option>`).join('')}</select>`;
      break;
    }
    case 'ListBox': {
      const items = (p.items || '').split('\n').filter(Boolean);
      wrap.innerHTML = `<select class="rc-listbox" style="${fontStyleFor(p)}" multiple disabled>${items.map(it => `<option>${escapeHtml(it)}</option>`).join('')}</select>`;
      break;
    }
    case 'Panel': {
      wrap.innerHTML = `<div class="rc-panel" style="background:${p.backColor};"></div>`;
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
      wrap.innerHTML = `<div class="rc-track"><input type="range" min="${p.min}" max="${p.max}" value="${p.value}" disabled></div>`;
      break;
    }
    case 'NumericUpDown': {
      wrap.innerHTML = `<div class="rc-numeric" style="${fontStyleFor(p)}">${p.value}</div>`;
      break;
    }
    case 'DateTimePicker': {
      wrap.innerHTML = `<div class="rc-datetime" style="${fontStyleFor(p)}">${escapeHtml(p.value || new Date().toLocaleDateString())}</div>`;
      break;
    }
    case 'RichTextBox': {
      wrap.innerHTML = `<div class="rc-richtext" style="${fontStyleFor(p)}">${escapeHtml(p.text)}</div>`;
      break;
    }
    case 'LinkLabel': {
      wrap.innerHTML = `<div class="rc-link" style="${fontStyleFor(p)}">${escapeHtml(p.text)}</div>`;
      break;
    }
  }
  return wrap;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function renderStatus() {
  const sel = getControl(state.selectedId);
  document.getElementById('statusSelection').textContent = sel
    ? `${sel.name} (${sel.type})  x:${sel.x} y:${sel.y} w:${sel.w} h:${sel.h}`
    : 'No selection';
  document.getElementById('statusCount').textContent = `${state.controls.length} control(s)`;
  document.getElementById('statusGrid').textContent = `grid ${state.gridSize}px \u00b7 ${state.snapEnabled ? 'snap on' : 'snap off'}`;
}

/* =========================================================================
   Interaction: select / drag / resize
   ========================================================================= */

let dragCtx = null;

function onControlMouseDown(e) {
  const id = e.currentTarget.dataset.id;
  const ctrl = getControl(id);
  if (!ctrl) return;

  if (e.target.dataset.handle) {
    e.stopPropagation();
    startResize(e, ctrl, e.target.dataset.handle);
    return;
  }

  selectControl(id);

  if (ctrl.interact) return; // let the real control receive the interaction

  e.stopPropagation();
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  const origX = ctrl.x, origY = ctrl.y;
  dragCtx = { type: 'move', ctrl, startX, startY, origX, origY };

  function onMove(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    ctrl.x = snap(origX + dx);
    ctrl.y = snap(origY + dy);
    render();
    reselectAfterRender(id);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    dragCtx = null;
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startResize(e, ctrl, handle) {
  const startX = e.clientX, startY = e.clientY;
  const orig = { x: ctrl.x, y: ctrl.y, w: ctrl.w, h: ctrl.h };

  function onMove(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    let { x, y, w, h } = orig;
    if (handle.includes('e')) w = Math.max(12, orig.w + dx);
    if (handle.includes('s')) h = Math.max(12, orig.h + dy);
    if (handle.includes('w')) { w = Math.max(12, orig.w - dx); x = orig.x + dx; }
    if (handle.includes('n')) { h = Math.max(12, orig.h - dy); y = orig.y + dy; }
    ctrl.x = snap(x); ctrl.y = snap(y); ctrl.w = snap(w); ctrl.h = snap(h);
    render();
    reselectAfterRender(ctrl.id);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function reselectAfterRender(id) {
  // render() rebuilds the DOM; nothing further needed since selection state is data-driven
}

function selectControl(id) {
  state.selectedId = id;
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('designSurface').addEventListener('mousedown', (e) => {
    if (e.target.id === 'designSurface') {
      state.selectedId = null;
      render();
    }
  });
});

// Arrow-key nudge (works when a control is selected and focus isn't in a text field)
document.addEventListener('keydown', (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  if (!state.selectedId) return;
  const ctrl = getControl(state.selectedId);
  if (!ctrl) return;
  const step = state.nudgeStep;
  let moved = true;
  if (e.key === 'ArrowUp') ctrl.y = snap(ctrl.y - step);
  else if (e.key === 'ArrowDown') ctrl.y = snap(ctrl.y + step);
  else if (e.key === 'ArrowLeft') ctrl.x = snap(ctrl.x - step);
  else if (e.key === 'ArrowRight') ctrl.x = snap(ctrl.x + step);
  else if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  else moved = false;
  if (moved) { e.preventDefault(); render(); }
});

function nudge(dir) {
  const ctrl = getControl(state.selectedId);
  if (!ctrl) return;
  const step = state.nudgeStep;
  if (dir === 'up') ctrl.y = snap(ctrl.y - step);
  if (dir === 'down') ctrl.y = snap(ctrl.y + step);
  if (dir === 'left') ctrl.x = snap(ctrl.x - step);
  if (dir === 'right') ctrl.x = snap(ctrl.x + step);
  render();
}

function deleteSelected() {
  if (!state.selectedId) return;
  const id = state.selectedId;
  // remove control and any descendants
  const toRemove = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    state.controls.forEach(c => {
      if (c.parentId && toRemove.has(c.parentId) && !toRemove.has(c.id)) { toRemove.add(c.id); grew = true; }
    });
  }
  state.controls = state.controls.filter(c => !toRemove.has(c.id));
  state.selectedId = null;
  render();
}

/* =========================================================================
   Toolbox: drag-and-drop placement
   ========================================================================= */

function initToolbox() {
  const box = document.getElementById('toolboxList');
  box.innerHTML = '';
  TOOLBOX_GROUPS.forEach(group => {
    const h = document.createElement('div');
    h.className = 'toolbox-heading';
    h.textContent = group.heading;
    box.appendChild(h);
    group.types.forEach(type => {
      const def = CONTROL_DEFS[type];
      const item = document.createElement('div');
      item.className = 'tool-item';
      item.draggable = true;
      item.dataset.type = type;
      item.innerHTML = `<span class="tool-glyph">${def.glyph}</span><span class="tool-label">${def.label}</span>`;
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', type);
      });
      item.addEventListener('dblclick', () => {
        const c = createControl(type, 20, 20, null);
        selectControl(c.id);
      });
      box.appendChild(item);
    });
  });
}

function initCanvasDrop() {
  const surface = surfaceEl();
  surface.addEventListener('dragover', (e) => e.preventDefault());
  surface.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    if (!CONTROL_DEFS[type]) return;
    const rect = surface.getBoundingClientRect();
    let x = e.clientX - rect.left, y = e.clientY - rect.top;

    // If dropped inside a container control, parent to it (coords relative to container)
    let parentId = null;
    const containerEl = document.elementFromPoint(e.clientX, e.clientY);
    const hostEl = containerEl && containerEl.closest && containerEl.closest('.ctrl');
    if (hostEl) {
      const hostCtrl = getControl(hostEl.dataset.id);
      if (hostCtrl && CONTROL_DEFS[hostCtrl.type].isContainer) {
        parentId = hostCtrl.id;
        const hostRect = hostEl.getBoundingClientRect();
        x = e.clientX - hostRect.left;
        y = e.clientY - hostRect.top;
      }
    }
    const c = createControl(type, x, y, parentId);
    selectControl(c.id);
  });
}

/* =========================================================================
   Properties pane
   ========================================================================= */

const EVENT_SNIPPETS = [
  { label: '-- Insert snippet --', code: '' },
  { label: 'Show message box', code: `[System.Windows.Forms.MessageBox]::Show("Message text", "Title")` },
  { label: 'Set another control\'s text', code: `$OtherControlName.Text = "New value"` },
  { label: 'Read this control\'s value', code: `$value = $ThisControl.Text` },
  { label: 'Close the form', code: `$Form.Close()` },
  { label: 'Enable/disable another control', code: `$OtherControlName.Enabled = $true` },
];

function renderProps() {
  const pane = document.getElementById('propsBody');
  const header = document.getElementById('propsHeader');
  pane.innerHTML = '';

  const ctrl = getControl(state.selectedId);
  if (!ctrl) {
    header.innerHTML = `<div><div class="sel-type">Form</div><div class="sel-name">${escapeHtml(state.form.text)}</div></div>`;
    pane.appendChild(buildFormProps());
    return;
  }

  header.innerHTML = `<div><div class="sel-type">${ctrl.type}</div><div class="sel-name">${escapeHtml(ctrl.name)}</div></div>`;

  pane.appendChild(section('Layout', buildLayoutRows(ctrl), true));
  pane.appendChild(section('Nudge', buildNudgeSection(ctrl), true));
  pane.appendChild(section('Behavior', buildPropRows(ctrl, COMMON_BEHAVIOR_PROPS), false));
  pane.appendChild(section('Appearance', buildPropRows(ctrl, COMMON_APPEARANCE_PROPS), false));

  const def = CONTROL_DEFS[ctrl.type];
  if (def.props.length) {
    pane.appendChild(section(ctrl.type + '-specific', buildPropRows(ctrl, def.props), false));
  }

  pane.appendChild(section('Interact', buildInteractSection(ctrl), false));

  if (def.events.length) {
    pane.appendChild(section('Events', buildEventsSection(ctrl), false));
  }
}

function section(title, bodyEl, startOpen) {
  const wrap = document.createElement('div');
  wrap.className = 'prop-section' + (startOpen ? '' : ' collapsed');
  const head = document.createElement('div');
  head.className = 'prop-section-title';
  head.innerHTML = `<span>${title}</span><span>${startOpen ? '\u2212' : '+'}</span>`;
  head.addEventListener('click', () => {
    wrap.classList.toggle('collapsed');
    head.querySelector('span:last-child').textContent = wrap.classList.contains('collapsed') ? '+' : '\u2212';
  });
  const body = document.createElement('div');
  body.className = 'prop-section-body';
  body.appendChild(bodyEl);
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

function buildLayoutRows(ctrl) {
  const frag = document.createElement('div');
  [['x', 'X'], ['y', 'Y'], ['w', 'Width'], ['h', 'Height'], ['z', 'Z-Index']].forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'prop-row';
    row.innerHTML = `<label>${label}</label><input type="number" value="${ctrl[key]}">`;
    row.querySelector('input').addEventListener('change', (e) => {
      ctrl[key] = Number(e.target.value) || 0;
      render();
    });
    frag.appendChild(row);
  });
  const nameRow = document.createElement('div');
  nameRow.className = 'prop-row';
  nameRow.innerHTML = `<label>Name</label><input type="text" value="${escapeHtml(ctrl.name)}">`;
  nameRow.querySelector('input').addEventListener('change', (e) => {
    ctrl.name = e.target.value.trim() || ctrl.name;
    render();
  });
  frag.prepend(nameRow);
  return frag;
}

function buildNudgeSection(ctrl) {
  const frag = document.createElement('div');
  const wrap = document.createElement('div');
  wrap.className = 'nudge-wrap';

  const dpad = document.createElement('div');
  dpad.className = 'dpad';
  dpad.innerHTML = `
    <button class="d-up" title="Up">\u2191</button>
    <button class="d-left" title="Left">\u2190</button>
    <button class="d-center"></button>
    <button class="d-right" title="Right">\u2192</button>
    <button class="d-down" title="Down">\u2193</button>`;
  dpad.querySelector('.d-up').addEventListener('click', () => nudge('up'));
  dpad.querySelector('.d-down').addEventListener('click', () => nudge('down'));
  dpad.querySelector('.d-left').addEventListener('click', () => nudge('left'));
  dpad.querySelector('.d-right').addEventListener('click', () => nudge('right'));

  const steps = document.createElement('div');
  steps.className = 'step-options';
  [1, 5, 10].forEach(step => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="nudgeStep" value="${step}" ${state.nudgeStep === step ? 'checked' : ''}> ${step}px`;
    label.querySelector('input').addEventListener('change', () => { state.nudgeStep = step; });
    steps.appendChild(label);
  });

  wrap.appendChild(dpad);
  wrap.appendChild(steps);
  frag.appendChild(wrap);

  const snapRow = document.createElement('div');
  snapRow.className = 'snap-row';
  snapRow.innerHTML = `<input type="checkbox" id="snapToggle" ${state.snapEnabled ? 'checked' : ''}><label for="snapToggle">Snap to grid (${state.gridSize}px)</label>`;
  snapRow.querySelector('input').addEventListener('change', (e) => { state.snapEnabled = e.target.checked; renderStatus(); });
  frag.appendChild(snapRow);

  return frag;
}

function buildPropRows(ctrl, propDefs) {
  const frag = document.createElement('div');
  propDefs.forEach(([key, label, type, , extra]) => {
    const row = document.createElement('div');
    row.className = 'prop-row' + (extra && extra.itemsEditor ? ' items-editor' : '');
    const val = ctrl.props[key];

    if (type === 'textarea') {
      row.innerHTML = `<label>${label}</label><textarea>${escapeHtml(val)}</textarea>`;
      const ta = row.querySelector('textarea');
      ta.addEventListener('change', () => { ctrl.props[key] = ta.value; render(); });
      if (extra && extra.itemsEditor) {
        const hint = document.createElement('div');
        hint.className = 'items-hint';
        hint.textContent = 'One item per line';
        row.appendChild(hint);
      }
    } else if (type === 'checkbox') {
      row.innerHTML = `<label>${label}</label><input type="checkbox" ${val ? 'checked' : ''}>`;
      row.querySelector('input').addEventListener('change', (e) => { ctrl.props[key] = e.target.checked; render(); });
    } else if (type === 'color') {
      row.innerHTML = `<label>${label}</label><input type="color" value="${val}">`;
      row.querySelector('input').addEventListener('input', (e) => { ctrl.props[key] = e.target.value; render(); });
    } else if (type === 'select') {
      const opts = extra.options.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('');
      row.innerHTML = `<label>${label}</label><select>${opts}</select>`;
      row.querySelector('select').addEventListener('change', (e) => { ctrl.props[key] = e.target.value; render(); });
    } else if (type === 'number') {
      row.innerHTML = `<label>${label}</label><input type="number" value="${val}">`;
      row.querySelector('input').addEventListener('change', (e) => { ctrl.props[key] = Number(e.target.value) || 0; render(); });
    } else {
      row.innerHTML = `<label>${label}</label><input type="text" value="${escapeHtml(val)}">`;
      row.querySelector('input').addEventListener('change', (e) => { ctrl.props[key] = e.target.value; render(); });
    }
    frag.appendChild(row);
  });
  return frag;
}

function buildInteractSection(ctrl) {
  const frag = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'toggle-row';
  row.innerHTML = `
    <span class="toggle-label">Pause editing &amp; interact with control</span>
    <label class="switch"><input type="checkbox" ${ctrl.interact ? 'checked' : ''}><span class="track"></span></label>`;
  row.querySelector('input').addEventListener('change', (e) => { ctrl.interact = e.target.checked; render(); });
  frag.appendChild(row);
  return frag;
}

function buildEventsSection(ctrl) {
  const def = CONTROL_DEFS[ctrl.type];
  const frag = document.createElement('div');

  def.events.forEach(evtName => {
    const existing = ctrl.events[evtName];
    const block = document.createElement('div');
    block.className = 'event-block' + (existing ? ' open' : '');
    const head = document.createElement('div');
    head.className = 'event-block-head';
    head.innerHTML = `<span>${evtName}</span><span>${existing ? '\u2212 remove (dbl-click)' : '+ add handler'}</span>`;

    const body = document.createElement('div');
    body.className = 'event-block-body';

    const data = existing || { fn: `${ctrl.name}_${evtName}`, code: '', ps1: '' };

    const fnRow = document.createElement('div');
    fnRow.className = 'prop-row';
    fnRow.innerHTML = `<label>Function</label><input type="text" value="${escapeHtml(data.fn)}">`;
    fnRow.querySelector('input').addEventListener('change', (e) => { data.fn = e.target.value; ctrl.events[evtName] = data; });

    const snippetRow = document.createElement('div');
    snippetRow.className = 'snippet-row';
    const sel = document.createElement('select');
    EVENT_SNIPPETS.forEach(s => {
      const o = document.createElement('option');
      o.textContent = s.label;
      o.dataset.code = s.code;
      sel.appendChild(o);
    });
    const insertBtn = document.createElement('button');
    insertBtn.className = 'btn btn-ghost';
    insertBtn.textContent = 'Insert';
    snippetRow.appendChild(sel);
    snippetRow.appendChild(insertBtn);

    const codeRow = document.createElement('div');
    codeRow.className = 'prop-row';
    codeRow.innerHTML = `<label>Code</label><textarea placeholder="PowerShell / JS handler body">${escapeHtml(data.code)}</textarea>`;
    const codeTa = codeRow.querySelector('textarea');
    codeTa.addEventListener('change', () => { data.code = codeTa.value; ctrl.events[evtName] = data; });

    insertBtn.addEventListener('click', () => {
      const code = sel.selectedOptions[0].dataset.code;
      if (!code) return;
      codeTa.value = (codeTa.value ? codeTa.value + '\n' : '') + code;
      data.code = codeTa.value;
      ctrl.events[evtName] = data;
    });

    const ps1Row = document.createElement('div');
    ps1Row.className = 'prop-row';
    ps1Row.innerHTML = `<label>Or .ps1 file</label><input type="text" placeholder="handlers\\${ctrl.name}_${evtName}.ps1" value="${escapeHtml(data.ps1)}">`;
    ps1Row.querySelector('input').addEventListener('change', (e) => { data.ps1 = e.target.value; ctrl.events[evtName] = data; });

    body.appendChild(fnRow);
    body.appendChild(snippetRow);
    body.appendChild(codeRow);
    body.appendChild(ps1Row);

    head.addEventListener('click', () => {
      if (!ctrl.events[evtName]) {
        ctrl.events[evtName] = data;
        block.classList.add('open');
        head.querySelector('span:last-child').textContent = '\u2212 remove (dbl-click)';
      } else {
        block.classList.toggle('open');
      }
    });

    // separate explicit remove affordance via double-click on header label
    head.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      ctrl.events[evtName] = null;
      renderProps();
    });

    block.appendChild(head);
    block.appendChild(body);
    frag.appendChild(block);
  });

  const hint = document.createElement('div');
  hint.className = 'items-hint';
  hint.textContent = 'Click an event to add/expand a handler. Double-click header to remove.';
  frag.appendChild(hint);

  return frag;
}

function buildFormProps() {
  const frag = document.createElement('div');
  const rows = [
    ['text', 'Title', 'text'],
    ['width', 'Width', 'number'],
    ['height', 'Height', 'number'],
    ['backColor', 'Back Color', 'color'],
  ];
  rows.forEach(([key, label, type]) => {
    const row = document.createElement('div');
    row.className = 'prop-row';
    if (type === 'color') {
      row.innerHTML = `<label>${label}</label><input type="color" value="${state.form[key]}">`;
      row.querySelector('input').addEventListener('input', (e) => { state.form[key] = e.target.value; render(); });
    } else {
      row.innerHTML = `<label>${label}</label><input type="${type}" value="${escapeHtml(state.form[key])}">`;
      row.querySelector('input').addEventListener('change', (e) => {
        state.form[key] = type === 'number' ? (Number(e.target.value) || 0) : e.target.value;
        render();
      });
    }
    frag.appendChild(row);
  });

  const hint = document.createElement('div');
  hint.className = 'items-hint';
  hint.style.marginTop = '8px';
  hint.textContent = 'Select a control on the canvas to edit its properties. Nothing selected \u2192 editing the form itself.';
  frag.appendChild(hint);
  return frag;
}

/* =========================================================================
   Code generation
   ========================================================================= */

function orderedControls() {
  // parents before children, stable by z
  const byParent = {};
  state.controls.forEach(c => { (byParent[c.parentId || ''] = byParent[c.parentId || ''] || []).push(c); });
  const out = [];
  (function walk(parentId) {
    (byParent[parentId || ''] || []).sort((a, b) => a.z - b.z).forEach(c => { out.push(c); walk(c.id); });
  })(null);
  return out;
}

function cssColor(hex) { return hex; }

function generateHTML() {
  const f = state.form;
  const ctrls = orderedControls();

  const domFor = (c) => {
    const p = c.props;
    const styleBase = `position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;z-index:${c.z};` +
      (p.visible === false ? 'display:none;' : '') +
      `font-family:${p.fontFamily};font-size:${p.fontSize}px;font-weight:${p.fontBold ? '700' : '400'};font-style:${p.fontItalic ? 'italic' : 'normal'};`;
    const evtAttr = (evtName, domEvt) => {
      const e = c.events[evtName];
      return e ? ` on${domEvt}="${e.fn}(event)"` : '';
    };

    switch (c.type) {
      case 'Button':
        return `<button id="${c.name}" style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('Click', 'click')} ${!p.enabled ? 'disabled' : ''}>${escapeHtml(p.text)}</button>`;
      case 'Label':
        return `<label id="${c.name}" style="${styleBase}color:${p.foreColor};text-align:${p.textAlign.toLowerCase()};"${evtAttr('Click', 'click')}>${escapeHtml(p.text)}</label>`;
      case 'TextBox':
        return `<input id="${c.name}" type="${p.passwordChar ? 'password' : 'text'}" value="${escapeHtml(p.text)}" maxlength="${p.maxLength || ''}" ${p.readOnly ? 'readonly' : ''} style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('TextChanged', 'input')}${evtAttr('Enter', 'focus')}${evtAttr('Leave', 'blur')}${evtAttr('KeyDown', 'keydown')}>`;
      case 'CheckBox':
        return `<label style="${styleBase}color:${p.foreColor};"><input id="${c.name}" type="checkbox" ${p.checked ? 'checked' : ''}${evtAttr('CheckedChanged', 'change')}${evtAttr('Click', 'click')}> ${escapeHtml(p.text)}</label>`;
      case 'RadioButton':
        return `<label style="${styleBase}color:${p.foreColor};"><input id="${c.name}" type="radio" name="${p.groupName}" ${p.checked ? 'checked' : ''}${evtAttr('CheckedChanged', 'change')}${evtAttr('Click', 'click')}> ${escapeHtml(p.text)}</label>`;
      case 'ComboBox': {
        const items = (p.items || '').split('\n').filter(Boolean);
        return `<select id="${c.name}" style="${styleBase}"${evtAttr('SelectedIndexChanged', 'change')}>${items.map((it, i) => `<option ${i === p.selectedIndex ? 'selected' : ''}>${escapeHtml(it)}</option>`).join('')}</select>`;
      }
      case 'ListBox': {
        const items = (p.items || '').split('\n').filter(Boolean);
        return `<select id="${c.name}" style="${styleBase}" ${p.selectionMode.startsWith('Multi') ? 'multiple' : ''}${evtAttr('SelectedIndexChanged', 'change')}>${items.map(it => `<option>${escapeHtml(it)}</option>`).join('')}</select>`;
      }
      case 'Panel':
        return `<div id="${c.name}" style="${styleBase}background:${p.backColor};border:1px solid #33475e;"${evtAttr('Click', 'click')}>\n${childrenHtml(c)}</div>`;
      case 'GroupBox':
        return `<fieldset id="${c.name}" style="${styleBase}background:${p.backColor};"><legend>${escapeHtml(p.text)}</legend>\n${childrenHtml(c)}</fieldset>`;
      case 'PictureBox':
        return `<img id="${c.name}" src="${escapeHtml(p.imageSource)}" style="${styleBase}object-fit:${p.sizeMode === 'StretchImage' ? 'fill' : 'contain'};"${evtAttr('Click', 'click')}>`;
      case 'ProgressBar':
        return `<progress id="${c.name}" min="${p.min}" max="${p.max}" value="${p.value}" style="${styleBase}"></progress>`;
      case 'TrackBar':
        return `<input id="${c.name}" type="range" min="${p.min}" max="${p.max}" value="${p.value}" style="${styleBase}"${evtAttr('ValueChanged', 'change')}>`;
      case 'NumericUpDown':
        return `<input id="${c.name}" type="number" min="${p.min}" max="${p.max}" step="${p.increment}" value="${p.value}" style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('ValueChanged', 'change')}>`;
      case 'DateTimePicker':
        return `<input id="${c.name}" type="date" value="${escapeHtml(p.value)}" style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('ValueChanged', 'change')}>`;
      case 'RichTextBox':
        return `<textarea id="${c.name}" style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('TextChanged', 'input')}>${escapeHtml(p.text)}</textarea>`;
      case 'LinkLabel':
        return `<a id="${c.name}" href="${escapeHtml(p.url)}" style="${styleBase}color:${p.foreColor};"${evtAttr('LinkClicked', 'click')}>${escapeHtml(p.text)}</a>`;
      default:
        return '';
    }
  };

  const childrenHtml = (parent) => ctrls.filter(c => c.parentId === parent.id).map(domFor).join('\n');
  const topLevelHtml = ctrls.filter(c => !c.parentId).map(domFor).join('\n  ');

  const functions = [];
  ctrls.forEach(c => Object.entries(c.events).forEach(([evtName, data]) => {
    if (data && data.code) functions.push(`function ${data.fn}(event) {\n  ${data.code.split('\n').join('\n  ')}\n}`);
  }));

  return `<!--
    ${state.form.text.replace(/[^a-zA-Z0-9]/g, '') || 'Form'}.html
    Written by: Johnathon Largent
    Version 1.0

    Generated by GUI Designer (engine v${ENGINE_VERSION}). Static markup for
    the "${f.text}" form: ${ctrls.length} control(s) laid out with the
    designer's canvas coordinates, plus inline event handler stubs wired to
    each control's configured event.

-->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(f.text)}</title>
<style>
  body { margin: 0; font-family: Segoe UI, sans-serif; }
  #${'form_root'} { position: relative; width: ${f.width}px; height: ${f.height}px; background: ${f.backColor}; overflow: hidden; }
</style>
</head>
<body>
<div id="form_root">
  ${topLevelHtml}
</div>
<script>
${functions.join('\n\n')}
${state.form.events.Load && state.form.events.Load.code ? `window.addEventListener('DOMContentLoaded', function(){ ${state.form.events.Load.code} });` : ''}
</script>
</body>
</html>`;
}

function psColor(hex) {
  if (!hex) return "[System.Drawing.Color]::White";
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `[System.Drawing.Color]::FromArgb(${r},${g},${b})`;
}

function generateWinForms() {
  const f = state.form;
  const ctrls = orderedControls();
  const lines = [];

  lines.push(`Add-Type -AssemblyName System.Windows.Forms`);
  lines.push(`Add-Type -AssemblyName System.Drawing`);
  lines.push('');
  lines.push(`$Form = New-Object System.Windows.Forms.Form`);
  lines.push(`$Form.Text = "${f.text}"`);
  lines.push(`$Form.Size = New-Object System.Drawing.Size(${f.width}, ${f.height})`);
  lines.push(`$Form.BackColor = ${psColor(f.backColor)}`);
  lines.push(`$Form.StartPosition = "CenterScreen"`);
  lines.push('');

  ctrls.forEach(c => {
    const p = c.props;
    const wfType = {
      Button: 'Button', Label: 'Label', TextBox: 'TextBox', CheckBox: 'CheckBox',
      RadioButton: 'RadioButton', ComboBox: 'ComboBox', ListBox: 'ListBox', Panel: 'Panel',
      GroupBox: 'GroupBox', PictureBox: 'PictureBox', ProgressBar: 'ProgressBar',
      TrackBar: 'TrackBar', NumericUpDown: 'NumericUpDown', DateTimePicker: 'DateTimePicker',
      RichTextBox: 'RichTextBox', LinkLabel: 'LinkLabel',
    }[c.type];

    lines.push(`# ${c.name} (${c.type})`);
    lines.push(`$${c.name} = New-Object System.Windows.Forms.${wfType}`);
    lines.push(`$${c.name}.Location = New-Object System.Drawing.Point(${c.x}, ${c.y})`);
    lines.push(`$${c.name}.Size = New-Object System.Drawing.Size(${c.w}, ${c.h})`);
    lines.push(`$${c.name}.Visible = $${p.visible}`);
    lines.push(`$${c.name}.Enabled = $${p.enabled}`);
    lines.push(`$${c.name}.TabIndex = ${p.tabIndex}`);
    if (p.toolTip) {
      lines.push(`$tt_${c.name} = New-Object System.Windows.Forms.ToolTip`);
      lines.push(`$tt_${c.name}.SetToolTip($${c.name}, "${p.toolTip}")`);
    }
    lines.push(`$${c.name}.BackColor = ${psColor(p.backColor)}`);
    lines.push(`$${c.name}.ForeColor = ${psColor(p.foreColor)}`);
    lines.push(`$${c.name}.Font = New-Object System.Drawing.Font("${p.fontFamily}", ${p.fontSize}, [System.Drawing.FontStyle]::${p.fontBold && p.fontItalic ? 'Bold, [System.Drawing.FontStyle]::Italic' : p.fontBold ? 'Bold' : p.fontItalic ? 'Italic' : 'Regular'})`);

    // type-specific
    switch (c.type) {
      case 'Button': case 'Label': case 'LinkLabel':
        lines.push(`$${c.name}.Text = "${(p.text || '').replace(/"/g, '""')}"`); break;
      case 'TextBox': case 'RichTextBox':
        lines.push(`$${c.name}.Text = "${(p.text || '').replace(/"/g, '""')}"`);
        if (c.type === 'TextBox') {
          lines.push(`$${c.name}.Multiline = $${p.multiline}`);
          lines.push(`$${c.name}.ReadOnly = $${p.readOnly}`);
          if (p.passwordChar) lines.push(`$${c.name}.PasswordChar = '${p.passwordChar}'`);
          if (p.maxLength) lines.push(`$${c.name}.MaxLength = ${p.maxLength}`);
        }
        break;
      case 'CheckBox': case 'RadioButton':
        lines.push(`$${c.name}.Text = "${(p.text || '').replace(/"/g, '""')}"`);
        lines.push(`$${c.name}.Checked = $${p.checked}`);
        break;
      case 'ComboBox': case 'ListBox': {
        const items = (p.items || '').split('\n').filter(Boolean);
        items.forEach(it => lines.push(`$${c.name}.Items.Add("${it.replace(/"/g, '""')}") | Out-Null`));
        if (c.type === 'ComboBox') {
          lines.push(`$${c.name}.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::${p.dropDownStyle}`);
          if (p.selectedIndex >= 0) lines.push(`$${c.name}.SelectedIndex = ${p.selectedIndex}`);
        }
        break;
      }
      case 'GroupBox':
        lines.push(`$${c.name}.Text = "${(p.text || '').replace(/"/g, '""')}"`); break;
      case 'PictureBox':
        if (p.imageSource) lines.push(`$${c.name}.Image = [System.Drawing.Image]::FromFile("${p.imageSource}")`);
        lines.push(`$${c.name}.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::${p.sizeMode}`);
        break;
      case 'ProgressBar':
        lines.push(`$${c.name}.Minimum = ${p.min}`);
        lines.push(`$${c.name}.Maximum = ${p.max}`);
        lines.push(`$${c.name}.Value = ${p.value}`);
        break;
      case 'TrackBar':
        lines.push(`$${c.name}.Minimum = ${p.min}`);
        lines.push(`$${c.name}.Maximum = ${p.max}`);
        lines.push(`$${c.name}.Value = ${p.value}`);
        lines.push(`$${c.name}.TickFrequency = ${p.tickFrequency}`);
        break;
      case 'NumericUpDown':
        lines.push(`$${c.name}.Minimum = ${p.min}`);
        lines.push(`$${c.name}.Maximum = ${p.max}`);
        lines.push(`$${c.name}.Value = ${p.value}`);
        lines.push(`$${c.name}.Increment = ${p.increment}`);
        lines.push(`$${c.name}.DecimalPlaces = ${p.decimalPlaces}`);
        break;
      case 'DateTimePicker':
        lines.push(`$${c.name}.Format = [System.Windows.Forms.DateTimePickerFormat]::${p.format}`);
        break;
    }

    // events
    Object.entries(c.events).forEach(([evtName, data]) => {
      if (!data) return;
      const body = data.ps1
        ? `. "${data.ps1}"; ${data.fn}`
        : (data.code || '# TODO: handler body').split('\n').join('\n    ');
      lines.push(`$${c.name}.Add_${evtName}({\n    ${body}\n})`);
    });

    lines.push(`$${(c.parentId ? '' + getControl(c.parentId).name : 'Form')}.Controls.Add($${c.name})`);
    lines.push('');
  });

  lines.push(`[void]$Form.ShowDialog()`);

  const header = `<#
    ${(f.text || 'Form').replace(/[^a-zA-Z0-9]/g, '')}.ps1
    Written by: Johnathon Largent
    Version 1.0

    Generated by GUI Designer (engine v${ENGINE_VERSION}). WinForms
    PowerShell script for the "${f.text}" form: builds every control with
    New-Object, sets layout/appearance/type-specific properties, wires
    Add_<Event> handlers (inline code or a dot-sourced .ps1 path), and
    shows the form modally.
#>
`;
  return header + lines.join('\n');
}

function xamlColorAttr(hex) { return hex; }

function generateWPF() {
  const f = state.form;
  const ctrls = orderedControls().filter(c => !c.parentId);

  const wpfTag = {
    Button: 'Button', Label: 'Label', TextBox: 'TextBox', CheckBox: 'CheckBox',
    RadioButton: 'RadioButton', ComboBox: 'ComboBox', ListBox: 'ListBox', Panel: 'Border',
    GroupBox: 'GroupBox', PictureBox: 'Image', ProgressBar: 'ProgressBar',
    TrackBar: 'Slider', NumericUpDown: 'TextBox', DateTimePicker: 'DatePicker',
    RichTextBox: 'TextBox', LinkLabel: 'TextBlock',
  };

  const elFor = (c) => {
    const p = c.props;
    const tag = wpfTag[c.type];
    const common = `x:Name="${c.name}" Canvas.Left="${c.x}" Canvas.Top="${c.y}" Width="${c.w}" Height="${c.h}" Visibility="${p.visible === false ? 'Collapsed' : 'Visible'}" IsEnabled="${!!p.enabled}"`;
    switch (c.type) {
      case 'Button': return `<Button ${common} Content="${escapeHtml(p.text)}" Background="${p.backColor}" Foreground="${p.foreColor}" Click="${c.events.Click ? c.events.Click.fn : ''}" />`;
      case 'Label': return `<Label ${common} Content="${escapeHtml(p.text)}" Foreground="${p.foreColor}" />`;
      case 'TextBox': return `<TextBox ${common} Text="${escapeHtml(p.text)}" IsReadOnly="${!!p.readOnly}" />`;
      case 'CheckBox': return `<CheckBox ${common} Content="${escapeHtml(p.text)}" IsChecked="${!!p.checked}" />`;
      case 'RadioButton': return `<RadioButton ${common} Content="${escapeHtml(p.text)}" GroupName="${p.groupName}" IsChecked="${!!p.checked}" />`;
      case 'ComboBox': return `<ComboBox ${common}>\n${(p.items || '').split('\n').filter(Boolean).map(it => `      <ComboBoxItem>${escapeHtml(it)}</ComboBoxItem>`).join('\n')}\n    </ComboBox>`;
      case 'ListBox': return `<ListBox ${common}>\n${(p.items || '').split('\n').filter(Boolean).map(it => `      <ListBoxItem>${escapeHtml(it)}</ListBoxItem>`).join('\n')}\n    </ListBox>`;
      case 'GroupBox': return `<GroupBox ${common} Header="${escapeHtml(p.text)}" />`;
      case 'ProgressBar': return `<ProgressBar ${common} Minimum="${p.min}" Maximum="${p.max}" Value="${p.value}" />`;
      case 'TrackBar': return `<Slider ${common} Minimum="${p.min}" Maximum="${p.max}" Value="${p.value}" />`;
      case 'PictureBox': return `<Image ${common} Source="${escapeHtml(p.imageSource)}" Stretch="Uniform" />`;
      case 'LinkLabel': return `<TextBlock ${common} Text="${escapeHtml(p.text)}" Foreground="#2dd4bf" TextDecorations="Underline" />`;
      default: return `<${tag} ${common} />`;
    }
  };

  const header = `<!--
    ${(f.text || 'Window').replace(/[^a-zA-Z0-9]/g, '')}.xaml
    Written by: Johnathon Largent
    Version 1.0

    Generated by GUI Designer (engine v${ENGINE_VERSION}). WPF markup for
    the "${f.text}" window. Controls sit on a Canvas using the designer's
    absolute coordinates. Nested containers and full event/data-binding
    wiring are not yet generated here -- this is a first-pass scaffold;
    pair with a PowerShell loader (Show Code > WinForms tab pattern also
    applies: dot-source this XAML with [System.Windows.Markup.XamlReader]).

-->
`;

  const xaml = `<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="${escapeHtml(f.text)}" Width="${f.width}" Height="${f.height}" Background="${f.backColor}">
  <Canvas>
    ${ctrls.map(elFor).join('\n    ')}
  </Canvas>
</Window>`;

  return header + xaml;
}

function generateWinUI() {
  const f = state.form;
  const header = `<!--
    ${(f.text || 'Page').replace(/[^a-zA-Z0-9]/g, '')}.xaml
    Written by: Johnathon Largent
    Version 1.0

    WinUI 3 scaffold generated by GUI Designer (engine v${ENGINE_VERSION}).
    WinUI export is on the roadmap: control -> markup mapping, styling
    (Fluent design tokens), and event wiring are not implemented yet.
    This stub gives you a page shell with the right title/size so a
    project can be started; controls placed in the designer are listed
    below as TODOs for manual porting.

-->
`;
  const todoList = state.controls.map(c => `    <!-- TODO: port ${c.name} (${c.type}) at ${c.x},${c.y} ${c.w}x${c.h} -->`).join('\n');
  const xaml = `<Page
    x:Class="App.${(f.text || 'MainPage').replace(/[^a-zA-Z0-9]/g, '')}"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <Grid Background="${f.backColor}" Width="${f.width}" Height="${f.height}">
${todoList}
  </Grid>
</Page>`;
  return header + xaml;
}

const GENERATORS = { html: generateHTML, winforms: generateWinForms, wpf: generateWPF, winui: generateWinUI };

/* =========================================================================
   Wiring: toolbar, modals
   ========================================================================= */

function initFormatSwitch() {
  document.querySelectorAll('.format-switch button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.format-switch button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFormat = btn.dataset.format;
    });
  });
}

function initShowCodeModal() {
  const overlay = document.getElementById('codeModalOverlay');
  document.getElementById('btnShowCode').addEventListener('click', () => {
    overlay.classList.add('open');
    switchCodeTab(state.currentFormat === 'winforms' ? 'winforms' : state.currentFormat);
  });
  document.getElementById('codeModalClose').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

  document.querySelectorAll('.code-tabs button').forEach(btn => {
    btn.addEventListener('click', () => switchCodeTab(btn.dataset.tab));
  });

  document.getElementById('btnCopyCode').addEventListener('click', async () => {
    const text = document.getElementById('codeOutput').textContent;
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('btnCopyCode');
      const orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    } catch (err) { /* clipboard may be unavailable in this context */ }
  });
}

function switchCodeTab(tab) {
  document.querySelectorAll('.code-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const note = document.getElementById('scaffoldNote');
  const scaffolded = tab === 'wpf' || tab === 'winui';
  note.style.display = scaffolded ? 'block' : 'none';
  note.textContent = tab === 'wpf'
    ? 'WPF export is a first-pass scaffold: top-level layout and common properties generate, but nested containers and full event binding are simplified.'
    : tab === 'winui'
      ? 'WinUI export is a roadmap item: this is a page shell with a TODO list of your controls for manual porting.'
      : '';
  document.getElementById('codeOutput').textContent = GENERATORS[tab]();
}

function initAboutModal() {
  const overlay = document.getElementById('aboutModalOverlay');
  document.getElementById('btnAbout').addEventListener('click', () => {
    document.getElementById('aboutEngineVersion').textContent = ENGINE_VERSION;
    document.getElementById('aboutStyleVersion').textContent = getComputedStyle(document.documentElement).getPropertyValue('--stylesheet-version').trim().replace(/'/g, '');
    document.getElementById('aboutPageVersion').textContent = window.PAGE_VERSION || 'n/a';
    overlay.classList.add('open');
  });
  document.getElementById('aboutModalClose').addEventListener('click', () => overlay.classList.remove('open'));
  document.getElementById('aboutModalClose2').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
}

function initTopToolbar() {
  document.getElementById('btnDelete').addEventListener('click', deleteSelected);
  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (state.controls.length && !confirm('Remove all controls from the form?')) return;
    state.controls = [];
    state.selectedId = null;
    render();
  });
}

/* =========================================================================
   Boot
   ========================================================================= */

function initEngine() {
  initToolbox();
  initCanvasDrop();
  initFormatSwitch();
  initShowCodeModal();
  initAboutModal();
  initTopToolbar();
  render();
}

document.addEventListener('DOMContentLoaded', initEngine);
