/*
    engine.js
    Written by: Johnathon Largent
    Version 1.3

    Revision: five fixes from user testing of 1.2. (2) Found and fixed
    the actual root cause of Interact mode: selectControl() was called
    on every canvas mousedown before checking the interact flag, and it
    triggers a full render() that rebuilds the whole canvas DOM -
    destroying the exact checkbox/dropdown/input the user had just
    clicked, before the browser could finish handling that click.
    Interact-mode clicks now skip that destructive re-render entirely.
    Also discovered TextBox, RichTextBox, NumericUpDown, and
    DateTimePicker were static preview divs with no real form element to
    interact with regardless of the click-handling bug; all four are now
    genuine <input>/<textarea> elements (disabled unless interacting)
    that write back into props on change. DateTimePicker additionally
    gets a Format-aware static preview (Long/Short/Time/Custom) when not
    interacting, and a real <input type=date|time> when interacting.
    (4) Anchor now actually repositions/stretches top-level controls in
    the design canvas when the form is resized (not just in generated
    code): Left+Right or Top+Bottom stretches the control with the
    parent, a single Right/Bottom anchor repositions to hold that edge's
    distance constant, None leaves the control untouched. (5) Reworked
    the Layout section per feedback: removed the redundant directional
    row (duplicated the Nudge d-pad). X/Y now show 0/Center/Max quick-
    pin buttons; Width/Height show shrink(-)/grow(<->or<^>)/Max buttons
    driven by the shared Nudge step (no duplicate step-size numbers).
    (6) MenuStrip preset items now ship real default code instead of
    empty stubs: File>Open/Save use OpenFileDialog/SaveFileDialog,
    File>Exit closes the form, View>Zoom tracks a $script:ZoomLevel
    script variable, and Help>About auto-generates its message box from
    the Comment-Based Help synopsis/description (editable per item via a
    new code textarea in the menu editor; typing custom code overrides
    the auto-About behavior). Wired into both WinForms (Add_Click) and
    HTML (onclick + generated function) output.
*/

const ENGINE_VERSION = '1.3';

/* =========================================================================
   Control catalog
   ========================================================================= */

// Property field shorthand: [key, label, type, default, extra]
// type: text | number | px | checkbox | color | select | textarea
const COMMON_APPEARANCE_PROPS = [
  ['backColor', 'Back Color', 'color', '#F0F0F0'],
  ['foreColor', 'Fore Color', 'color', '#000000'],
  ['fontFamily', 'Font Family', 'select', 'Segoe UI', { options: ['Segoe UI', 'Arial', 'Tahoma', 'Consolas', 'Verdana', 'Times New Roman'] }],
  ['fontSize', 'Font Size', 'px', 9],
  ['fontBold', 'Bold', 'checkbox', false],
  ['fontItalic', 'Italic', 'checkbox', false],
  ['borderStyle', 'Border Style', 'select', 'FixedSingle', { options: ['None', 'FixedSingle', 'Fixed3D'] }],
];

const COMMON_BEHAVIOR_PROPS = [
  ['visible', 'Visible', 'checkbox', true],
  ['enabled', 'Enabled', 'checkbox', true],
  ['tabIndex', 'Tab Index', 'number', 0],
  ['toolTip', 'Tool Tip', 'text', ''],
  ['dock', 'Dock', 'select', 'None', { options: ['None', 'Top', 'Bottom', 'Left', 'Right', 'Fill'] }],
  ['anchor', 'Anchor', 'select', 'Top, Left', { options: ['Top, Left', 'Top, Left, Right', 'Top, Bottom, Left', 'Top, Bottom, Left, Right', 'None'] }],
  ['cursor', 'Cursor', 'select', 'Default', { options: ['Default', 'Hand', 'IBeam', 'Wait', 'Cross', 'SizeAll'] }],
];

// System-color-ish defaults per control type, applied on top of the common
// grey (#F0F0F0) default so text-entry surfaces read as white like a real
// Windows install rather than every control sharing one flat grey.
const TYPE_BACKCOLOR_OVERRIDES = {
  TextBox: '#FFFFFF', ComboBox: '#FFFFFF', ListBox: '#FFFFFF',
  RichTextBox: '#FFFFFF', NumericUpDown: '#FFFFFF', DateTimePicker: '#FFFFFF',
};

// Default MenuStrip content: preset top-level menus (checkbox-enabled), each
// with its own preset sub-items (also checkbox-enabled) plus room for the
// user to add fully custom top-level menus and custom sub-items. Every
// non-separator item ships with real default code (editable per-item),
// not just a label - so File > Exit, Help > About, etc. actually do
// something out of the box instead of being empty stubs.
const PRESET_MENU_DEFAULT = [
  {
    id: 'file', label: 'File', enabled: true, preset: true,
    items: [
      { id: 'file_new', label: 'New', enabled: true, preset: true, code: '# TODO: reset the form/document to a blank state' },
      { id: 'file_open', label: 'Open...', enabled: true, preset: true, code: '$dlg = New-Object System.Windows.Forms.OpenFileDialog\nif ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {\n    # TODO: load $($dlg.FileName)\n}' },
      { id: 'file_save', label: 'Save', enabled: true, preset: true, code: '$dlg = New-Object System.Windows.Forms.SaveFileDialog\nif ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {\n    # TODO: save to $($dlg.FileName)\n}' },
      { id: 'file_sep1', label: '-', enabled: true, preset: true, code: '' },
      { id: 'file_exit', label: 'Exit', enabled: true, preset: true, code: '$Form.Close()' },
    ],
  },
  {
    id: 'view', label: 'View', enabled: true, preset: true,
    items: [
      { id: 'view_zoomin', label: 'Zoom In', enabled: true, preset: true, code: '$script:ZoomLevel = [Math]::Min(200, $script:ZoomLevel + 10)\n[System.Windows.Forms.MessageBox]::Show("Zoom: $script:ZoomLevel%")' },
      { id: 'view_zoomout', label: 'Zoom Out', enabled: true, preset: true, code: '$script:ZoomLevel = [Math]::Max(50, $script:ZoomLevel - 10)\n[System.Windows.Forms.MessageBox]::Show("Zoom: $script:ZoomLevel%")' },
      { id: 'view_reset', label: 'Reset Zoom', enabled: true, preset: true, code: '$script:ZoomLevel = 100\n[System.Windows.Forms.MessageBox]::Show("Zoom: $script:ZoomLevel%")' },
    ],
  },
  {
    id: 'help', label: 'Help', enabled: true, preset: true,
    items: [
      { id: 'help_docs', label: 'Documentation', enabled: true, preset: true, code: 'Start-Process "https://example.com/docs"' },
      { id: 'help_about', label: 'About', enabled: true, preset: true, code: '', autoAbout: true },
    ],
  },
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
  MenuStrip: {
    label: 'MenuStrip', glyph: 'Mn', defaultW: 400, defaultH: 26,
    props: [
      ['menuItems', 'Menu Items', 'menuEditor', PRESET_MENU_DEFAULT],
    ],
    events: [],
    isMenuStrip: true,
  },
};

const TOOLBOX_GROUPS = [
  { heading: 'Common', types: ['Button', 'Label', 'TextBox', 'CheckBox', 'RadioButton', 'LinkLabel'] },
  { heading: 'Lists & Selection', types: ['ComboBox', 'ListBox', 'NumericUpDown', 'DateTimePicker', 'TrackBar'] },
  { heading: 'Containers', types: ['Panel', 'GroupBox'] },
  { heading: 'Display', types: ['PictureBox', 'ProgressBar', 'RichTextBox'] },
  { heading: 'Menus', types: ['MenuStrip'] },
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
  currentFormat: 'winforms',
  sectionOpen: {},       // title -> bool, persists collapse state across re-renders
  form: {
    text: 'MyForm',
    width: 640,
    height: 420,
    backColor: '#F0F0F0',
    minimizeBox: true,
    maximizeBox: true,
    closeBox: true,
    resizable: true,          // FormBorderStyle: Sizable vs FixedSingle
    startPosition: 'CenterScreen',
    topMost: false,
    events: { Load: { fn: 'Form_Load', code: '', ps1: '' } },
    help: {
      synopsis: { enabled: true, text: '' },
      description: { enabled: false, text: '' },
      parameters: [],
      examples: [{ enabled: false, text: '' }],
      notes: { enabled: false, author: '', filename: '', notes: '' },
    },
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
  const cloneDefault = (v) => (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  def.props.forEach(([key, , , def0]) => { props[key] = cloneDefault(def0); });
  COMMON_APPEARANCE_PROPS.forEach(([key, , , def0]) => { props[key] = cloneDefault(def0); });
  COMMON_BEHAVIOR_PROPS.forEach(([key, , , def0]) => { props[key] = cloneDefault(def0); });
  if (TYPE_BACKCOLOR_OVERRIDES[type]) props.backColor = TYPE_BACKCOLOR_OVERRIDES[type];
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
  const formEl = document.getElementById('designForm');
  const isHtml = state.currentFormat === 'html';
  formEl.style.width = state.form.width + 'px';
  formEl.style.height = (state.form.height + (isHtml ? 0 : 26)) + 'px';
  formEl.className = 'design-form skin-' + state.currentFormat + (isHtml ? ' no-titlebar' : '');
  document.getElementById('designSurface').style.height = state.form.height + 'px';
  document.getElementById('designSurface').style.background = state.form.backColor;
  document.getElementById('formTitleText').textContent = isHtml ? state.form.text + ' \u2014 index.html' : state.form.text;

  const btnWrap = document.getElementById('formTitleButtons');
  btnWrap.innerHTML = '';
  if (!isHtml) {
    if (state.form.minimizeBox) btnWrap.appendChild(titleGlyphBtn('\u2013'));
    if (state.form.maximizeBox) btnWrap.appendChild(titleGlyphBtn('\u25a1'));
    if (state.form.closeBox) btnWrap.appendChild(titleGlyphBtn('\u00d7', true));
  }

  ensureFormResizeHandles(formEl);
}

function titleGlyphBtn(glyph, isClose) {
  const b = document.createElement('span');
  b.className = 'title-glyph-btn' + (isClose ? ' close' : '');
  b.textContent = glyph;
  return b;
}

function ensureFormResizeHandles(formEl) {
  if (formEl.querySelector('.form-resize-handle')) return;
  ['e', 's', 'se'].forEach(pos => {
    const h = document.createElement('div');
    h.className = 'form-resize-handle frh-' + pos;
    h.dataset.handle = pos;
    h.addEventListener('mousedown', startFormResize);
    formEl.appendChild(h);
  });
}

function applyAnchorFromOrigin(ctrl, orig, prevW, prevH, newW, newH) {
  const anchorStr = ctrl.props.anchor || 'Top, Left';
  if (anchorStr === 'None') return; // stays exactly where it was, unresized

  const anchor = anchorStr.split(',').map(s => s.trim());
  const hasLeft = anchor.includes('Left');
  const hasRight = anchor.includes('Right');
  const hasTop = anchor.includes('Top');
  const hasBottom = anchor.includes('Bottom');

  // Distances from the control's original far edges to the parent's far
  // edges, captured at drag start - these are what stay constant for an
  // anchored edge as the parent resizes.
  const distRight = prevW - (orig.x + orig.w);
  const distBottom = prevH - (orig.y + orig.h);

  if (hasLeft && hasRight) {
    ctrl.x = orig.x;
    ctrl.w = Math.max(12, newW - orig.x - distRight);
  } else if (hasRight) {
    ctrl.w = orig.w;
    ctrl.x = newW - distRight - orig.w;
  } else {
    ctrl.x = orig.x;
    ctrl.w = orig.w;
  }

  if (hasTop && hasBottom) {
    ctrl.y = orig.y;
    ctrl.h = Math.max(12, newH - orig.y - distBottom);
  } else if (hasBottom) {
    ctrl.h = orig.h;
    ctrl.y = newH - distBottom - orig.h;
  } else {
    ctrl.y = orig.y;
    ctrl.h = orig.h;
  }
}

function startFormResize(e) {
  e.stopPropagation();
  e.preventDefault();
  const handle = e.currentTarget.dataset.handle;
  const startX = e.clientX, startY = e.clientY;
  const orig = { w: state.form.width, h: state.form.height };
  // Snapshot top-level controls' bounds so anchors can be recomputed
  // fresh from this origin on every tick (avoids cumulative drift).
  const origCtrls = state.controls.filter(c => !c.parentId).map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));

  function onMove(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (handle.includes('e')) state.form.width = Math.max(200, snap(orig.w + dx));
    if (handle.includes('s')) state.form.height = Math.max(150, snap(orig.h + dy));

    origCtrls.forEach(o => {
      const ctrl = getControl(o.id);
      if (!ctrl) return;
      applyAnchorFromOrigin(ctrl, o, orig.w, orig.h, state.form.width, state.form.height);
    });

    render();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    render();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
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
      if (p.multiline) {
        wrap.innerHTML = `<textarea class="rc-textbox rc-textbox-multiline" style="${fontStyleFor(p)}background:${p.backColor};color:${p.foreColor};" maxlength="${p.maxLength || ''}" ${p.readOnly ? 'readonly' : ''} ${c.interact ? '' : 'disabled'}>${escapeHtml(p.text)}</textarea>`;
      } else {
        wrap.innerHTML = `<input type="${p.passwordChar ? 'password' : 'text'}" class="rc-textbox" style="${fontStyleFor(p)}background:${p.backColor};color:${p.foreColor};" value="${escapeHtml(p.text)}" maxlength="${p.maxLength || ''}" ${p.readOnly ? 'readonly' : ''} ${c.interact ? '' : 'disabled'}>`;
      }
      if (c.interact) wrap.querySelector('input,textarea').addEventListener('input', (e) => { p.text = e.target.value; });
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
      wrap.innerHTML = `<select class="rc-combo" style="${fontStyleFor(p)}" ${c.interact ? '' : 'disabled'}>${items.map((it, i) => `<option ${i === p.selectedIndex ? 'selected' : ''}>${escapeHtml(it)}</option>`).join('')}</select>`;
      if (c.interact) wrap.querySelector('select').addEventListener('change', (e) => { p.selectedIndex = e.target.selectedIndex; });
      break;
    }
    case 'ListBox': {
      const items = (p.items || '').split('\n').filter(Boolean);
      wrap.innerHTML = `<select class="rc-listbox" style="${fontStyleFor(p)}" multiple ${c.interact ? '' : 'disabled'}>${items.map(it => `<option>${escapeHtml(it)}</option>`).join('')}</select>`;
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
      wrap.innerHTML = `<div class="rc-track"><input type="range" min="${p.min}" max="${p.max}" value="${p.value}" ${c.interact ? '' : 'disabled'}></div>`;
      if (c.interact) wrap.querySelector('input').addEventListener('input', (e) => { p.value = Number(e.target.value); });
      break;
    }
    case 'MenuStrip': {
      wrap.appendChild(renderMenuStripPreview(p));
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

function formatDateTimePreview(p) {
  let d = p.value ? new Date(p.value) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  switch (p.format) {
    case 'Long': return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    case 'Short': return d.toLocaleDateString();
    case 'Time': return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'Custom': return p.value || d.toLocaleDateString();
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

  if (ctrl.interact) {
    // Deliberately do NOT call selectControl()/render() here. render()
    // rebuilds the whole canvas DOM, which would destroy the very
    // checkbox/select/input/date-picker the user is mid-click on, before
    // the browser finishes toggling/opening/focusing it. Only update
    // selection state (lightweight, no canvas rebuild) if it actually
    // changed, so the real control is free to receive the interaction.
    if (state.selectedId !== id) {
      document.querySelectorAll('.ctrl.selected').forEach(elx => elx.classList.remove('selected'));
      e.currentTarget.classList.add('selected');
      state.selectedId = id;
      renderProps();
      renderStatus();
    }
    return;
  }

  selectControl(id);

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

const TOOLTIPS = {
  name: 'Variable/element name used to reference this control in generated code.',
  x: 'Horizontal position (pixels) from the left edge of its parent.',
  y: 'Vertical position (pixels) from the top edge of its parent.',
  w: 'Width in pixels.',
  h: 'Height in pixels.',
  z: 'Z-Index: stacking order. Higher values render on top of lower ones when controls overlap.',
  visible: 'Whether the control is shown at runtime. Hidden controls still exist and can be shown later from code.',
  enabled: 'Whether the control accepts input at runtime. Disabled controls are usually greyed out.',
  tabIndex: 'Keyboard tab order. Lower numbers are reached first when pressing Tab.',
  toolTip: 'Text shown in a small popup when the mouse hovers over this control at runtime.',
  dock: 'Dock: stretches the control to fill an edge (or all) of its parent, and keeps it there as the parent resizes.',
  anchor: 'Anchor: pins the control a fixed distance from the chosen parent edges, so it moves/stretches with those edges when the parent resizes. Anchor is ignored while Dock is set to anything other than None.',
  cursor: 'Mouse pointer shown when hovering over this control at runtime.',
  backColor: 'Background/fill color of the control.',
  foreColor: 'Text/foreground color of the control.',
  fontFamily: 'Font used for this control\'s text (this control only, not a shared/global font).',
  fontSize: 'Font size in points for this control\'s text.',
  fontBold: 'Renders this control\'s text in bold.',
  fontItalic: 'Renders this control\'s text in italics.',
  borderStyle: 'Border drawn around the control: None, a flat single line, or a 3D sunken/raised edge.',
  text: 'The main text/caption/content shown on this control.',
  textAlign: 'Horizontal alignment of the text within the control.',
  multiline: 'Allows the text box to wrap and hold multiple lines instead of a single line.',
  readOnly: 'Prevents the user from editing the text at runtime (still selectable/copyable).',
  passwordChar: 'Character shown in place of typed text (e.g. *) to mask input like a password field.',
  maxLength: 'Maximum number of characters the user can type. 0 = unlimited.',
  checked: 'Whether this box/radio starts checked/selected.',
  groupName: 'Radio buttons sharing the same Group Name are mutually exclusive (only one can be checked at a time).',
  items: 'The list of selectable entries, one per line.',
  selectedIndex: 'Index (0-based) of the item selected by default. -1 means nothing selected.',
  dropDownStyle: 'Whether the user can type a custom value, must pick from the list, or sees the list inline.',
  selectionMode: 'How many items the user can select at once: none, exactly one, or multiple.',
  imageSource: 'File path or URL of the image to display.',
  sizeMode: 'How the image is scaled/positioned to fit the control\'s bounds.',
  min: 'Minimum value allowed.',
  max: 'Maximum value allowed.',
  value: 'Current/starting value.',
  tickFrequency: 'How often (in value units) a tick mark is drawn along the slider.',
  increment: 'Amount the value changes per step (e.g. each click of the up/down arrows).',
  decimalPlaces: 'Number of digits shown after the decimal point.',
  format: 'How the date/time value is displayed.',
  url: 'The web address this link opens when clicked.',
  menuItems: 'Configure this menu bar: check a top-level menu to include it, check individual entries to include them, edit labels, or add your own custom menus and items.',
};

function tt(key) { return TOOLTIPS[key] || ''; }

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

  // Interact is never collapsible and never buried in an accordion — it's a
  // fixed control right under the header so it's always reachable in one
  // click, since it's the one you need in a hurry to test a dropdown/checkbox.
  pane.appendChild(buildInteractFixedBlock(ctrl));

  pane.appendChild(section('Layout', buildLayoutRows(ctrl), true));
  pane.appendChild(section('Nudge', buildNudgeSection(ctrl), true));
  pane.appendChild(section('Behavior', buildPropRows(ctrl, COMMON_BEHAVIOR_PROPS), false));
  pane.appendChild(section('Appearance', buildPropRows(ctrl, COMMON_APPEARANCE_PROPS), false));

  const def = CONTROL_DEFS[ctrl.type];
  if (def.props.length) {
    pane.appendChild(section(ctrl.type + '-specific', buildPropRows(ctrl, def.props), false));
  }

  if (def.events.length) {
    pane.appendChild(section('Events', buildEventsSection(ctrl), false));
  }
}

function section(title, bodyEl, startOpen) {
  // Sections with only a single row of content aren't worth collapsing —
  // there's nothing to hide, so render them flat with a static (non-
  // clickable) label instead of a toggle header.
  const rowCount = bodyEl.children.length;
  const singleRow = rowCount <= 1;

  const wrap = document.createElement('div');
  const head = document.createElement('div');

  if (singleRow) {
    wrap.className = 'prop-section single-row';
    head.className = 'prop-section-title static';
    head.innerHTML = `<span>${title}</span>`;
  } else {
    if (!(title in state.sectionOpen)) state.sectionOpen[title] = !!startOpen;
    const isOpen = state.sectionOpen[title];
    wrap.className = 'prop-section' + (isOpen ? '' : ' collapsed');
    head.className = 'prop-section-title';
    head.innerHTML = `<span>${title}</span><span>${isOpen ? '\u2212' : '+'}</span>`;
    head.addEventListener('click', () => {
      wrap.classList.toggle('collapsed');
      const nowOpen = !wrap.classList.contains('collapsed');
      state.sectionOpen[title] = nowOpen;
      head.querySelector('span:last-child').textContent = nowOpen ? '\u2212' : '+';
    });
  }

  const body = document.createElement('div');
  body.className = 'prop-section-body';
  body.appendChild(bodyEl);
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

function pixelStepperRow(label, value, onChange, opts) {
  opts = opts || {};
  const min = opts.min != null ? opts.min : 0;
  const row = document.createElement('div');
  row.className = 'prop-row px-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  if (opts.tooltip) labelEl.title = opts.tooltip;
  const controls = document.createElement('div');
  controls.className = 'px-controls';

  const input = document.createElement('input');
  input.type = 'number';
  input.value = value;
  input.className = 'px-input';

  const steps = document.createElement('div');
  steps.className = 'px-steps';

  function commit(v) {
    v = Math.max(min, v);
    input.value = v;
    onChange(v);
  }

  [-10, -5, -1, 1, 5, 10].forEach(delta => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'px-step-btn';
    b.textContent = (delta > 0 ? '+' : '') + delta;
    b.addEventListener('click', () => commit((Number(input.value) || 0) + delta));
    steps.appendChild(b);
  });

  input.addEventListener('change', () => commit(Number(input.value) || 0));

  controls.appendChild(input);
  controls.appendChild(steps);
  row.appendChild(labelEl);
  row.appendChild(controls);
  return row;
}

function parentBounds(ctrl) {
  const parent = ctrl.parentId ? getControl(ctrl.parentId) : null;
  return parent ? { w: parent.w, h: parent.h } : { w: state.form.width, h: state.form.height };
}

function centerControl(ctrl, axis) {
  const b = parentBounds(ctrl);
  if (axis === 'x' || axis === 'both') ctrl.x = snap((b.w - ctrl.w) / 2);
  if (axis === 'y' || axis === 'both') ctrl.y = snap((b.h - ctrl.h) / 2);
  render();
}

function xyQuickRow(ctrl, axis, label) {
  const row = document.createElement('div');
  row.className = 'prop-row xy-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.title = tt(axis);

  const wrap = document.createElement('div');
  wrap.className = 'xy-controls';

  const input = document.createElement('input');
  input.type = 'number';
  input.value = ctrl[axis];
  input.className = 'px-input';
  input.addEventListener('change', () => { ctrl[axis] = snap(Number(input.value) || 0); render(); });

  const btnRow = document.createElement('div');
  btnRow.className = 'xy-quick-btns';
  const mk = (text, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'xy-quick-btn';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  btnRow.appendChild(mk('0', axis === 'x' ? 'Pin to far left' : 'Pin to far top', () => { ctrl[axis] = 0; render(); }));
  btnRow.appendChild(mk('Center', 'Center within parent', () => centerControl(ctrl, axis)));
  btnRow.appendChild(mk('Max', axis === 'x' ? 'Pin to far right (edge of parent)' : 'Pin to far bottom (edge of parent)', () => {
    const b = parentBounds(ctrl);
    ctrl[axis] = axis === 'x' ? b.w - ctrl.w : b.h - ctrl.h;
    render();
  }));

  wrap.appendChild(input);
  wrap.appendChild(btnRow);
  row.appendChild(labelEl);
  row.appendChild(wrap);
  return row;
}

function whQuickRow(ctrl, dim, label, growSymbol) {
  const row = document.createElement('div');
  row.className = 'prop-row xy-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.title = tt(dim);

  const wrap = document.createElement('div');
  wrap.className = 'xy-controls';

  const input = document.createElement('input');
  input.type = 'number';
  input.value = ctrl[dim];
  input.className = 'px-input';
  input.addEventListener('change', () => { ctrl[dim] = Math.max(12, snap(Number(input.value) || 12)); render(); });

  const btnRow = document.createElement('div');
  btnRow.className = 'xy-quick-btns';
  const mk = (text, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'xy-quick-btn';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  const step = state.nudgeStep;
  btnRow.appendChild(mk('\u2212', `Shrink ${step}px (uses the Nudge section's step size)`, () => { ctrl[dim] = Math.max(12, snap(ctrl[dim] - step)); render(); }));
  btnRow.appendChild(mk(growSymbol, `Grow ${step}px (uses the Nudge section's step size)`, () => { ctrl[dim] = snap(ctrl[dim] + step); render(); }));
  btnRow.appendChild(mk('Max', dim === 'w' ? "Fit parent's width" : "Fit parent's height", () => {
    const b = parentBounds(ctrl);
    ctrl[dim] = dim === 'w' ? b.w : b.h;
    render();
  }));

  wrap.appendChild(input);
  wrap.appendChild(btnRow);
  row.appendChild(labelEl);
  row.appendChild(wrap);
  return row;
}

function buildLayoutRows(ctrl) {
  const frag = document.createElement('div');
  const nameRow = document.createElement('div');
  nameRow.className = 'prop-row';
  nameRow.innerHTML = `<label title="${escapeHtml(tt('name'))}">Name</label><input type="text" value="${escapeHtml(ctrl.name)}">`;
  nameRow.querySelector('input').addEventListener('change', (e) => {
    ctrl.name = e.target.value.trim() || ctrl.name;
    render();
  });
  frag.appendChild(nameRow);

  frag.appendChild(xyQuickRow(ctrl, 'x', 'X'));
  frag.appendChild(xyQuickRow(ctrl, 'y', 'Y'));
  frag.appendChild(whQuickRow(ctrl, 'w', 'Width', '\u2194'));
  frag.appendChild(whQuickRow(ctrl, 'h', 'Height', '\u2195'));

  const zRow = document.createElement('div');
  zRow.className = 'prop-row';
  zRow.innerHTML = `<label title="${escapeHtml(tt('z'))}">Z-Index</label><input type="number" value="${ctrl.z}">`;
  zRow.querySelector('input').addEventListener('change', (e) => { ctrl.z = Number(e.target.value) || 0; render(); });
  frag.appendChild(zRow);

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
    <button class="d-center" title="Center within parent (both axes)">\u2316</button>
    <button class="d-right" title="Right">\u2192</button>
    <button class="d-down" title="Down">\u2193</button>`;
  dpad.querySelector('.d-up').addEventListener('click', () => nudge('up'));
  dpad.querySelector('.d-down').addEventListener('click', () => nudge('down'));
  dpad.querySelector('.d-left').addEventListener('click', () => nudge('left'));
  dpad.querySelector('.d-right').addEventListener('click', () => nudge('right'));
  dpad.querySelector('.d-center').addEventListener('click', () => centerControl(ctrl, 'both'));

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
    const tipAttr = escapeHtml(tt(key));

    if (type === 'menuEditor') {
      frag.appendChild(buildMenuEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'px') {
      frag.appendChild(pixelStepperRow(label, ctrl.props[key], (v) => { ctrl.props[key] = v; render(); }, { min: 1, tooltip: tt(key) }));
      return;
    }
    const row = document.createElement('div');
    row.className = 'prop-row' + (extra && extra.itemsEditor ? ' items-editor' : '');
    const val = ctrl.props[key];

    if (type === 'textarea') {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><textarea>${escapeHtml(val)}</textarea>`;
      const ta = row.querySelector('textarea');
      ta.addEventListener('change', () => { ctrl.props[key] = ta.value; render(); });
      if (extra && extra.itemsEditor) {
        const hint = document.createElement('div');
        hint.className = 'items-hint';
        hint.textContent = 'One item per line';
        row.appendChild(hint);
      }
    } else if (type === 'checkbox') {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><input type="checkbox" ${val ? 'checked' : ''}>`;
      row.querySelector('input').addEventListener('change', (e) => { ctrl.props[key] = e.target.checked; render(); });
    } else if (type === 'color') {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><input type="color" value="${val}">`;
      row.querySelector('input').addEventListener('input', (e) => { ctrl.props[key] = e.target.value; render(); });
    } else if (type === 'select') {
      const opts = extra.options.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('');
      row.innerHTML = `<label title="${tipAttr}">${label}</label><select>${opts}</select>`;
      row.querySelector('select').addEventListener('change', (e) => { ctrl.props[key] = e.target.value; render(); });
    } else if (type === 'number') {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><input type="number" value="${val}">`;
      row.querySelector('input').addEventListener('change', (e) => { ctrl.props[key] = Number(e.target.value) || 0; render(); });
    } else {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><input type="text" value="${escapeHtml(val)}">`;
      row.querySelector('input').addEventListener('change', (e) => { ctrl.props[key] = e.target.value; render(); });
    }
    frag.appendChild(row);
  });
  return frag;
}

/* =========================================================================
   MenuStrip editor: checkbox-enabled preset menus + custom menu/item support
   ========================================================================= */

function buildMenuEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-editor';

  const heading = document.createElement('div');
  heading.className = 'menu-editor-heading';
  heading.title = tt(key);
  heading.textContent = label;
  wrap.appendChild(heading);

  const menus = ctrl.props[key];

  menus.forEach((menu, mi) => {
    wrap.appendChild(buildMenuTopItem(ctrl, key, menus, menu, mi));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost menu-add-btn';
  addBtn.textContent = '+ Add custom menu';
  addBtn.title = 'Add a new top-level menu (fully custom, not a preset).';
  addBtn.addEventListener('click', () => {
    menus.push({ id: 'menu' + Math.random().toString(36).slice(2, 8), label: 'NewMenu', enabled: true, preset: false, items: [] });
    render();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function buildMenuTopItem(ctrl, key, menus, menu, mi) {
  const box = document.createElement('div');
  box.className = 'menu-editor-item';

  const head = document.createElement('div');
  head.className = 'menu-editor-item-head';

  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = !!menu.enabled;
  chk.title = 'Include this menu in the generated code.';
  chk.addEventListener('change', (e) => { menu.enabled = e.target.checked; render(); });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'menu-editor-label-input';
  nameInput.value = menu.label;
  nameInput.addEventListener('change', (e) => { menu.label = e.target.value.trim() || menu.label; render(); });

  const tag = document.createElement('span');
  tag.className = 'menu-editor-tag';
  tag.textContent = menu.preset ? 'preset' : 'custom';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this menu entirely.';
  delBtn.addEventListener('click', () => { menus.splice(mi, 1); render(); });

  head.appendChild(chk);
  head.appendChild(nameInput);
  head.appendChild(tag);
  head.appendChild(delBtn);
  box.appendChild(head);

  const itemsWrap = document.createElement('div');
  itemsWrap.className = 'menu-editor-subitems';
  menu.items.forEach((it, ii) => {
    itemsWrap.appendChild(buildMenuSubItem(menu, it, ii));
  });

  const addItemBtn = document.createElement('button');
  addItemBtn.type = 'button';
  addItemBtn.className = 'btn btn-ghost menu-add-item-btn';
  addItemBtn.textContent = '+ Add item';
  addItemBtn.title = 'Add a custom entry under this menu.';
  addItemBtn.addEventListener('click', () => {
    menu.items.push({ id: 'item' + Math.random().toString(36).slice(2, 8), label: 'New Item', enabled: true, preset: false, code: '' });
    render();
  });
  itemsWrap.appendChild(addItemBtn);

  box.appendChild(itemsWrap);
  return box;
}

function buildMenuSubItem(menu, it, ii) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-editor-subitem-wrap';

  const row = document.createElement('div');
  row.className = 'menu-editor-subitem-row';

  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = !!it.enabled;
  chk.title = 'Include this entry in the generated menu.';
  chk.addEventListener('change', (e) => { it.enabled = e.target.checked; render(); });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'menu-editor-label-input';
  nameInput.value = it.label;
  nameInput.title = it.label === '-' ? 'A single dash renders as a separator line.' : '';
  nameInput.addEventListener('change', (e) => { it.label = e.target.value.trim() || it.label; render(); });

  const tag = document.createElement('span');
  tag.className = 'menu-editor-tag';
  tag.textContent = it.preset ? 'preset' : 'custom';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this entry.';
  delBtn.addEventListener('click', () => { menu.items.splice(ii, 1); render(); });

  row.appendChild(chk);
  row.appendChild(nameInput);
  row.appendChild(tag);
  row.appendChild(delBtn);
  wrap.appendChild(row);

  const isSeparator = it.label === '-';
  if (!isSeparator) {
    const codeRow = document.createElement('div');
    codeRow.className = 'menu-editor-code-row';
    const codeLabel = document.createElement('label');
    codeLabel.textContent = it.autoAbout ? 'Code (auto-generated from Comment-Based Help)' : 'Code (PowerShell / JS, runs on click)';
    codeLabel.title = it.autoAbout
      ? 'This item shows your .SYNOPSIS/.DESCRIPTION text in a message box automatically. Start typing below to override it with custom code.'
      : 'Handler that runs when this menu item is clicked.';
    const codeTa = document.createElement('textarea');
    codeTa.className = 'menu-editor-code';
    codeTa.value = it.autoAbout ? '' : (it.code || '');
    codeTa.placeholder = it.autoAbout ? '(auto) shows .SYNOPSIS / .DESCRIPTION in a message box' : '';
    codeTa.addEventListener('change', () => {
      it.code = codeTa.value;
      if (codeTa.value.trim()) it.autoAbout = false;
      render();
    });
    codeRow.appendChild(codeLabel);
    codeRow.appendChild(codeTa);
    wrap.appendChild(codeRow);
  }

  return wrap;
}

function buildInteractFixedBlock(ctrl) {
  const wrap = document.createElement('div');
  wrap.className = 'interact-fixed';
  const row = document.createElement('div');
  row.className = 'toggle-row';
  row.title = 'When on, clicks/keys go to the real control (e.g. open a dropdown or check a box) instead of selecting/dragging it in the designer.';
  row.innerHTML = `
    <span class="toggle-label">Pause editing &amp; interact with control</span>
    <label class="switch"><input type="checkbox" ${ctrl.interact ? 'checked' : ''}><span class="track"></span></label>`;
  row.querySelector('input').addEventListener('change', (e) => { ctrl.interact = e.target.checked; render(); });
  wrap.appendChild(row);
  return wrap;
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
    fnRow.innerHTML = `<label title="Name of the function/handler that runs when ${evtName} fires.">Function</label><input type="text" value="${escapeHtml(data.fn)}">`;
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
    codeRow.innerHTML = `<label title="Handler body executed inline when ${evtName} fires. Leave blank if using a .ps1 file instead.">Code</label><textarea placeholder="PowerShell / JS handler body">${escapeHtml(data.code)}</textarea>`;
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
    ps1Row.innerHTML = `<label title="Path to an external .ps1 script to dot-source and call instead of inline code.">Or .ps1 file</label><input type="text" placeholder="handlers\\${ctrl.name}_${evtName}.ps1" value="${escapeHtml(data.ps1)}">`;
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

  const titleRow = document.createElement('div');
  titleRow.className = 'prop-row';
  titleRow.innerHTML = `<label title="Text shown in the window's title bar.">Title</label><input type="text" value="${escapeHtml(state.form.text)}">`;
  titleRow.querySelector('input').addEventListener('change', (e) => { state.form.text = e.target.value; render(); });
  frag.appendChild(titleRow);

  frag.appendChild(pixelStepperRow('Width', state.form.width, (v) => { state.form.width = v; render(); }, { min: 200 }));
  frag.appendChild(pixelStepperRow('Height', state.form.height, (v) => { state.form.height = v; render(); }, { min: 150 }));

  const colorRow = document.createElement('div');
  colorRow.className = 'prop-row';
  colorRow.innerHTML = `<label title="Background fill color of the form's client area.">Back Color</label><input type="color" value="${state.form.backColor}">`;
  colorRow.querySelector('input').addEventListener('input', (e) => { state.form.backColor = e.target.value; render(); });
  frag.appendChild(colorRow);

  frag.appendChild(section('Title Bar', buildFormChromeRows(), true));

  const hint = document.createElement('div');
  hint.className = 'items-hint';
  hint.style.marginTop = '8px';
  hint.textContent = 'Select a control on the canvas to edit its properties. Nothing selected \u2192 editing the form itself.';
  frag.appendChild(hint);

  frag.appendChild(section('Comment-Based Help', buildHelpBlockEditor(), false));

  return frag;
}

function buildFormChromeRows() {
  const frag = document.createElement('div');

  const chromeTips = {
    minimizeBox: 'Shows the minimize (_) button in the title bar.',
    maximizeBox: 'Shows the maximize (\u25a1) button in the title bar.',
    closeBox: 'Shows the close (\u00d7) button in the title bar.',
    resizable: 'Allows the user to resize the window by dragging its edges.',
    topMost: 'Keeps the window above all other windows.',
  };
  [['minimizeBox', 'Minimize Button'], ['maximizeBox', 'Maximize Button'], ['closeBox', 'Close Button'], ['resizable', 'Resizable'], ['topMost', 'Always On Top']].forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'toggle-row';
    row.title = chromeTips[key];
    row.innerHTML = `<span class="toggle-label">${label}</span><label class="switch"><input type="checkbox" ${state.form[key] ? 'checked' : ''}><span class="track"></span></label>`;
    row.querySelector('input').addEventListener('change', (e) => { state.form[key] = e.target.checked; render(); });
    frag.appendChild(row);
  });

  const startRow = document.createElement('div');
  startRow.className = 'prop-row';
  const opts = ['CenterScreen', 'Manual', 'CenterParent', 'WindowsDefaultLocation', 'WindowsDefaultBounds'];
  startRow.innerHTML = `<label title="Where the window appears on screen the first time it opens.">Start Position</label><select>${opts.map(o => `<option ${o === state.form.startPosition ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  startRow.querySelector('select').addEventListener('change', (e) => { state.form.startPosition = e.target.value; });
  frag.appendChild(startRow);

  return frag;
}

/* ---- Comment-based help builder (PowerShell-style .SYNOPSIS/.DESCRIPTION/etc.) ---- */

const HELP_PLACEHOLDERS = {
  synopsis: 'This script/function does - What?',
  description: 'A more detailed description of why and how the function works.',
  paramName: 'ParamName',
  paramText: 'The parameter is used to define the value of blah and also blah.',
  example: 'The example below does blah\nPS C:\\> Example',
  author: 'Name',
  get filename() { return (state.form.text.replace(/[^a-zA-Z0-9]/g, '') || 'Form') + '.ps1'; },
  notes: 'Additional notes about this script.',
};

function helpCheckboxTextRow(label, item, key, placeholder, multiline) {
  const row = document.createElement('div');
  row.className = 'prop-row help-row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = item.enabled;
  const field = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) field.type = 'text';
  field.placeholder = placeholder;
  field.value = item[key] || '';
  field.addEventListener('change', () => { item[key] = field.value; });
  cb.addEventListener('change', () => { item.enabled = cb.checked; });

  const labelWrap = document.createElement('label');
  labelWrap.className = 'help-item-label';
  labelWrap.appendChild(cb);
  const span = document.createElement('span');
  span.textContent = label;
  labelWrap.appendChild(span);

  row.appendChild(labelWrap);
  row.appendChild(field);
  return row;
}

function buildHelpBlockEditor() {
  const h = state.form.help;
  const frag = document.createElement('div');

  frag.appendChild(helpCheckboxTextRow('.SYNOPSIS', h.synopsis, 'text', HELP_PLACEHOLDERS.synopsis, true));
  frag.appendChild(helpCheckboxTextRow('.DESCRIPTION', h.description, 'text', HELP_PLACEHOLDERS.description, true));

  const paramWrap = document.createElement('div');
  paramWrap.className = 'help-list';
  const paramTitle = document.createElement('div');
  paramTitle.className = 'items-hint';
  paramTitle.textContent = '.PARAMETER entries';
  paramWrap.appendChild(paramTitle);
  h.parameters.forEach((p, idx) => paramWrap.appendChild(buildParamRow(p, idx)));
  const addParamBtn = document.createElement('button');
  addParamBtn.className = 'btn btn-ghost';
  addParamBtn.textContent = '+ Add parameter';
  addParamBtn.addEventListener('click', () => { h.parameters.push({ enabled: true, name: '', text: '' }); renderProps(); });
  paramWrap.appendChild(addParamBtn);
  frag.appendChild(paramWrap);

  const exWrap = document.createElement('div');
  exWrap.className = 'help-list';
  const exTitle = document.createElement('div');
  exTitle.className = 'items-hint';
  exTitle.textContent = '.EXAMPLE entries';
  exWrap.appendChild(exTitle);
  h.examples.forEach((ex, idx) => exWrap.appendChild(helpCheckboxTextRow('Example ' + (idx + 1), ex, 'text', HELP_PLACEHOLDERS.example, true)));
  const addExBtn = document.createElement('button');
  addExBtn.className = 'btn btn-ghost';
  addExBtn.textContent = '+ Add example';
  addExBtn.addEventListener('click', () => { h.examples.push({ enabled: true, text: '' }); renderProps(); });
  exWrap.appendChild(addExBtn);
  frag.appendChild(exWrap);

  const notesWrap = document.createElement('div');
  notesWrap.className = 'help-list';
  const notesHead = document.createElement('label');
  notesHead.className = 'help-item-label';
  const notesCb = document.createElement('input');
  notesCb.type = 'checkbox';
  notesCb.checked = h.notes.enabled;
  notesCb.addEventListener('change', () => { h.notes.enabled = notesCb.checked; });
  notesHead.appendChild(notesCb);
  const notesSpan = document.createElement('span');
  notesSpan.textContent = '.NOTES';
  notesHead.appendChild(notesSpan);
  notesWrap.appendChild(notesHead);

  const authorRow = document.createElement('div');
  authorRow.className = 'prop-row';
  authorRow.innerHTML = `<label>Author</label><input type="text" placeholder="${HELP_PLACEHOLDERS.author}" value="${escapeHtml(h.notes.author)}">`;
  authorRow.querySelector('input').addEventListener('change', (e) => { h.notes.author = e.target.value; });
  notesWrap.appendChild(authorRow);

  const fileRow = document.createElement('div');
  fileRow.className = 'prop-row';
  fileRow.innerHTML = `<label>Filename</label><input type="text" placeholder="${HELP_PLACEHOLDERS.filename}" value="${escapeHtml(h.notes.filename)}">`;
  fileRow.querySelector('input').addEventListener('change', (e) => { h.notes.filename = e.target.value; });
  notesWrap.appendChild(fileRow);

  const notesRow = document.createElement('div');
  notesRow.className = 'prop-row';
  notesRow.innerHTML = `<label>Notes</label><textarea placeholder="${HELP_PLACEHOLDERS.notes}">${escapeHtml(h.notes.notes)}</textarea>`;
  notesRow.querySelector('textarea').addEventListener('change', (e) => { h.notes.notes = e.target.value; });
  notesWrap.appendChild(notesRow);

  frag.appendChild(notesWrap);

  return frag;
}

function buildParamRow(p, idx) {
  const wrap = document.createElement('div');
  wrap.className = 'param-row';
  const head = document.createElement('label');
  head.className = 'help-item-label';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = p.enabled;
  cb.addEventListener('change', () => { p.enabled = cb.checked; });
  head.appendChild(cb);
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = HELP_PLACEHOLDERS.paramName;
  nameInput.value = p.name;
  nameInput.className = 'param-name-input';
  nameInput.addEventListener('change', () => { p.name = nameInput.value; });
  head.appendChild(nameInput);
  const rmBtn = document.createElement('button');
  rmBtn.className = 'btn btn-ghost btn-danger';
  rmBtn.textContent = '\u00d7';
  rmBtn.title = 'Remove parameter';
  rmBtn.addEventListener('click', () => { state.form.help.parameters.splice(idx, 1); renderProps(); });
  head.appendChild(rmBtn);
  wrap.appendChild(head);

  const desc = document.createElement('textarea');
  desc.placeholder = HELP_PLACEHOLDERS.paramText;
  desc.value = p.text;
  desc.addEventListener('change', () => { p.text = desc.value; });
  wrap.appendChild(desc);

  return wrap;
}

function generateHelpBlockLines() {
  const h = state.form.help;
  const lines = [];
  if (h.synopsis.enabled) {
    lines.push('.SYNOPSIS');
    lines.push('    ' + (h.synopsis.text || HELP_PLACEHOLDERS.synopsis));
  }
  if (h.description.enabled) {
    lines.push('.DESCRIPTION');
    lines.push('    ' + (h.description.text || HELP_PLACEHOLDERS.description));
  }
  h.parameters.filter(p => p.enabled).forEach(p => {
    lines.push('.PARAMETER ' + (p.name || HELP_PLACEHOLDERS.paramName));
    lines.push('    ' + (p.text || HELP_PLACEHOLDERS.paramText));
  });
  h.examples.filter(ex => ex.enabled).forEach(ex => {
    lines.push('.EXAMPLE');
    (ex.text || HELP_PLACEHOLDERS.example).split('\n').forEach(l => lines.push('    ' + l));
  });
  if (h.notes.enabled) {
    lines.push('.NOTES');
    lines.push('    Author: ' + (h.notes.author || HELP_PLACEHOLDERS.author));
    lines.push('    Filename: ' + (h.notes.filename || HELP_PLACEHOLDERS.filename));
    if (h.notes.notes) h.notes.notes.split('\n').forEach(l => lines.push('    ' + l));
  }
  return lines;
}

function helpBlockAsPs1Comment() {
  const lines = generateHelpBlockLines();
  if (!lines.length) return '';
  return '<#\n' + lines.join('\n') + '\n#>\n\n';
}

function helpBlockAsHtmlComment() {
  const lines = generateHelpBlockLines();
  if (!lines.length) return '';
  return '<!--\n' + lines.join('\n') + '\n-->\n';
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

function menuAboutMessage() {
  const h = state.form.help;
  const parts = [];
  if (h.synopsis && h.synopsis.enabled && h.synopsis.text) parts.push(h.synopsis.text);
  if (h.description && h.description.enabled && h.description.text) parts.push(h.description.text);
  return parts.join('\n\n') || (state.form.text + ' - no description provided.');
}

// Returns the code that should run when a menu item is clicked, in the
// requested target language. autoAbout items ignore their stored `code`
// and are generated fresh each time from the Comment-Based Help block,
// unless the user has typed their own code (which clears autoAbout).
function menuItemCodeFor(it, format) {
  if (it.autoAbout) {
    const msg = menuAboutMessage();
    if (format === 'html') return `alert(${JSON.stringify(msg)});`;
    return `[System.Windows.Forms.MessageBox]::Show("${msg.replace(/"/g, '""').replace(/\r?\n/g, '\`n')}", "About ${state.form.text.replace(/"/g, '""')}")`;
  }
  return it.code || '';
}

function menuStripHtml(c, styleBase, functionsOut) {
  const menus = (c.props.menuItems || []).filter(m => m.enabled);
  const li = (m) => {
    const items = (m.items || []).filter(it => it.enabled);
    const subUl = items.length
      ? `<ul>${items.map(it => {
        if (it.label === '-') return `<li class="menu-sep"></li>`;
        const code = menuItemCodeFor(it, 'html');
        if (code && code.trim()) {
          const fnName = `${c.name}_${m.id}_${it.id}`;
          functionsOut.push(`function ${fnName}(event) {\n  ${code.split('\n').join('\n  ')}\n}`);
          return `<li onclick="${fnName}(event)">${escapeHtml(it.label)}</li>`;
        }
        return `<li>${escapeHtml(it.label)}</li>`;
      }).join('')}</ul>`
      : '';
    return `<li>${escapeHtml(m.label)}${subUl}</li>`;
  };
  return `<nav id="${c.name}" class="menu-strip" style="${styleBase}"><ul>${menus.map(li).join('')}</ul></nav>`;
}

function generateHTML() {
  const f = state.form;
  const ctrls = orderedControls();
  const functions = [];

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
      case 'MenuStrip':
        return menuStripHtml(c, styleBase, functions);
      default:
        return '';
    }
  };

  const childrenHtml = (parent) => ctrls.filter(c => c.parentId === parent.id).map(domFor).join('\n');
  const topLevelHtml = ctrls.filter(c => !c.parentId).map(domFor).join('\n  ');

  ctrls.forEach(c => Object.entries(c.events).forEach(([evtName, data]) => {
    if (data && data.code) functions.push(`function ${data.fn}(event) {\n  ${data.code.split('\n').join('\n  ')}\n}`);
  }));

  return `${helpBlockAsHtmlComment()}<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(f.text)}</title>
<style>
  body { margin: 0; font-family: Segoe UI, sans-serif; }
  #${'form_root'} { position: relative; width: ${f.width}px; height: ${f.height}px; background: ${f.backColor}; overflow: hidden; }
  .menu-strip { background: #F0F0F0; border-bottom: 1px solid #ACA899; }
  .menu-strip > ul { list-style: none; margin: 0; padding: 0; display: flex; height: 100%; }
  .menu-strip > ul > li { position: relative; padding: 0 10px; display: flex; align-items: center; font-size: 12px; cursor: default; }
  .menu-strip > ul > li:hover { background: #C1D2EE; }
  .menu-strip li > ul { display: none; position: absolute; top: 100%; left: 0; list-style: none; margin: 0; padding: 4px 0; background: #FFFFFF; border: 1px solid #ACA899; min-width: 140px; z-index: 50; }
  .menu-strip li:hover > ul { display: block; }
  .menu-strip li > ul li { padding: 4px 18px; font-size: 12px; white-space: nowrap; }
  .menu-strip li > ul li:hover { background: #C1D2EE; }
  .menu-strip li > ul li.menu-sep { height: 1px; margin: 4px 0; padding: 0; background: #ddd; }
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

  const usesZoomLevel = state.controls.some(c => c.type === 'MenuStrip' &&
    (c.props.menuItems || []).some(m => (m.items || []).some(it => (menuItemCodeFor(it, 'winforms') || '').includes('$script:ZoomLevel'))));

  lines.push(`Add-Type -AssemblyName System.Windows.Forms`);
  lines.push(`Add-Type -AssemblyName System.Drawing`);
  lines.push('');
  if (usesZoomLevel) {
    lines.push(`$script:ZoomLevel = 100`);
    lines.push('');
  }
  lines.push(`$Form = New-Object System.Windows.Forms.Form`);
  lines.push(`$Form.Text = "${f.text}"`);
  lines.push(`$Form.Size = New-Object System.Drawing.Size(${f.width}, ${f.height})`);
  lines.push(`$Form.BackColor = ${psColor(f.backColor)}`);
  lines.push(`$Form.StartPosition = "${f.startPosition}"`);
  lines.push(`$Form.MinimizeBox = $${f.minimizeBox}`);
  lines.push(`$Form.MaximizeBox = $${f.maximizeBox}`);
  lines.push(`$Form.ControlBox = $${f.closeBox}`);
  lines.push(`$Form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::${f.resizable ? 'Sizable' : 'FixedSingle'}`);
  lines.push(`$Form.TopMost = $${f.topMost}`);
  lines.push('');

  ctrls.forEach(c => {
    const p = c.props;
    const wfType = {
      Button: 'Button', Label: 'Label', TextBox: 'TextBox', CheckBox: 'CheckBox',
      RadioButton: 'RadioButton', ComboBox: 'ComboBox', ListBox: 'ListBox', Panel: 'Panel',
      GroupBox: 'GroupBox', PictureBox: 'PictureBox', ProgressBar: 'ProgressBar',
      TrackBar: 'TrackBar', NumericUpDown: 'NumericUpDown', DateTimePicker: 'DateTimePicker',
      RichTextBox: 'RichTextBox', LinkLabel: 'LinkLabel', MenuStrip: 'MenuStrip',
    }[c.type];

    lines.push(`# ${c.name} (${c.type})`);
    lines.push(`$${c.name} = New-Object System.Windows.Forms.${wfType}`);
    lines.push(`$${c.name}.Location = New-Object System.Drawing.Point(${c.x}, ${c.y})`);
    lines.push(`$${c.name}.Size = New-Object System.Drawing.Size(${c.w}, ${c.h})`);
    lines.push(`$${c.name}.Visible = $${p.visible}`);
    lines.push(`$${c.name}.Enabled = $${p.enabled}`);
    lines.push(`$${c.name}.TabIndex = ${p.tabIndex}`);
    if (p.dock !== 'None') lines.push(`$${c.name}.Dock = [System.Windows.Forms.DockStyle]::${p.dock}`);
    if (p.anchor !== 'None') {
      const flags = p.anchor.split(',').map(s => s.trim()).map(f => `[System.Windows.Forms.AnchorStyles]::${f}`).join(' -bor ');
      lines.push(`$${c.name}.Anchor = ${flags}`);
    }
    if (p.cursor !== 'Default') lines.push(`$${c.name}.Cursor = [System.Windows.Forms.Cursors]::${p.cursor}`);
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
      case 'MenuStrip': {
        const menus = (p.menuItems || []).filter(m => m.enabled);
        menus.forEach(m => {
          const menuVar = `${c.name}_${m.id}`;
          lines.push(`$${menuVar} = New-Object System.Windows.Forms.ToolStripMenuItem`);
          lines.push(`$${menuVar}.Text = "${(m.label || '').replace(/"/g, '""')}"`);
          (m.items || []).filter(it => it.enabled).forEach(it => {
            if (it.label === '-') {
              lines.push(`$${menuVar}.DropDownItems.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null`);
            } else {
              const itemVar = `${menuVar}_${it.id.replace(new RegExp('^' + m.id + '_'), '')}`;
              lines.push(`$${itemVar} = New-Object System.Windows.Forms.ToolStripMenuItem`);
              lines.push(`$${itemVar}.Text = "${(it.label || '').replace(/"/g, '""')}"`);
              const code = menuItemCodeFor(it, 'winforms');
              if (code && code.trim()) {
                lines.push(`$${itemVar}.Add_Click({\n    ${code.split('\n').join('\n    ')}\n})`);
              }
              lines.push(`$${menuVar}.DropDownItems.Add($${itemVar}) | Out-Null`);
            }
          });
          lines.push(`$${c.name}.Items.Add($${menuVar}) | Out-Null`);
        });
        break;
      }
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
    if (c.type === 'MenuStrip') lines.push(`$Form.MainMenuStrip = $${c.name}`);
    lines.push('');
  });

  lines.push(`[void]$Form.ShowDialog()`);

  return helpBlockAsPs1Comment() + lines.join('\n');
}

function xamlColorAttr(hex) { return hex; }

function wpfMenuXaml(c, common) {
  const menus = (c.props.menuItems || []).filter(m => m.enabled);
  const menuItem = (m) => {
    const items = (m.items || []).filter(it => it.enabled);
    const children = items.length
      ? `\n      ${items.map(it => it.label === '-' ? `<Separator />` : `<MenuItem Header="${escapeHtml(it.label)}" />`).join('\n      ')}\n    `
      : '';
    return `<MenuItem Header="${escapeHtml(m.label)}">${children}</MenuItem>`;
  };
  return `<Menu ${common}>\n    ${menus.map(menuItem).join('\n    ')}\n  </Menu>`;
}

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
      case 'MenuStrip': return wpfMenuXaml(c, common);
      default: return `<${tag} ${common} />`;
    }
  };

  const header = helpBlockAsHtmlComment();

  const xaml = `<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="${escapeHtml(f.text)}" Width="${f.width}" Height="${f.height}" Background="${f.backColor}"
        ResizeMode="${f.resizable ? 'CanResize' : 'NoResize'}" WindowStartupLocation="${f.startPosition === 'CenterScreen' ? 'CenterScreen' : 'Manual'}" Topmost="${f.topMost}">
  <Canvas>
    ${ctrls.map(elFor).join('\n    ')}
  </Canvas>
</Window>`;

  return header + xaml;
}

function winuiMenuXaml(c) {
  const menus = (c.props.menuItems || []).filter(m => m.enabled);
  const menuItem = (m) => {
    const items = (m.items || []).filter(it => it.enabled);
    const children = items.length
      ? `\n      ${items.map(it => it.label === '-' ? `<MenuFlyoutSeparator />` : `<MenuFlyoutItem Text="${escapeHtml(it.label)}" />`).join('\n      ')}\n    `
      : '';
    return `<MenuBarItem Title="${escapeHtml(m.label)}">${children}</MenuBarItem>`;
  };
  return `<MenuBar x:Name="${c.name}">\n    ${menus.map(menuItem).join('\n    ')}\n  </MenuBar>`;
}

function generateWinUI() {
  const f = state.form;
  const header = helpBlockAsHtmlComment() + `<!-- WinUI export is a roadmap item: control -> markup mapping, Fluent
     styling, and event wiring are not implemented yet, except MenuStrip
     which maps to a real MenuBar/MenuBarItem/MenuFlyoutItem tree below.
     Everything else is a page shell with a TODO list for manual porting. -->
`;
  const menuControls = state.controls.filter(c => c.type === 'MenuStrip');
  const otherControls = state.controls.filter(c => c.type !== 'MenuStrip');
  const menuXaml = menuControls.map(winuiMenuXaml).join('\n  ');
  const todoList = otherControls.map(c => `    <!-- TODO: port ${c.name} (${c.type}) at ${c.x},${c.y} ${c.w}x${c.h} -->`).join('\n');
  const xaml = `<Page
    x:Class="App.${(f.text || 'MainPage').replace(/[^a-zA-Z0-9]/g, '')}"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <StackPanel Background="${f.backColor}" Width="${f.width}" Height="${f.height}">
    ${menuXaml}
    <Grid>
${todoList}
    </Grid>
  </StackPanel>
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
      render();
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
