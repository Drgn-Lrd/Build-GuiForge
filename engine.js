/*
    engine.js
    Written by: Johnathon Largent
    Version 1.15

    Revision: (1) About modal now shows Control Data and Codegen
    versions (were missing since those two files were split out).
    (2) Added a control-picker: every event action has a "Select
    Control" button (startControlPick/cancelControlPick) - click it,
    then click a control on the canvas to insert its name into the
    action's code, replacing $OtherControlName if present or inserting
    at the cursor otherwise. Escape cancels. The picked control never
    steals the current selection, so the event editor stays open. Since
    a control on an inactive TabControl page isn't in the canvas DOM to
    click, the picking banner also offers "Or pick from list", which
    opens the Objects modal in pick-mode (buildObjectsList now checks
    state.pickingCallback) - that list already includes every control
    regardless of tab visibility, so this fully covers the "hidden
    control" case, not just the common one. (3) Added CONTROL_HELP
    entries for this update's 5 new controls (see control-data.js).
*/

const ENGINE_VERSION = '1.15';

/* =========================================================================
   Control catalog, toolbox icons/descriptions, MenuStrip/TabControl
   defaults - moved to control-data.js (loaded before this file).
   ========================================================================= */

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
  undoStack: [],
  redoStack: [],
  suppressUndoCheckpoint: false, // true during a continuous drag/resize gesture
  dockOrderSeq: 0,
  pickingCallback: null, // set while "Select Control" pick mode is active
  form: {
    text: 'MyForm',
    width: 640,
    height: 420,
    backColor: '#F0F0F0',
    minimizeBox: true,
    maximizeBox: true,
    closeBox: true,
    formBorderStyle: 'Sizable', // real WinForms enum - replaces a plain true/false "resizable" toggle
    startPosition: 'CenterScreen',
    topMost: true,
    events: { Load: { fn: 'Form_Load', code: '', ps1: '' } },
    help: {
      synopsis: { enabled: true, text: 'Creating a test GUI form' },
      description: { enabled: false, text: '' },
      parameters: [],
      examples: [{ enabled: false, text: '' }],
      notes: { enabled: true, author: 'Johnathon Largent', filename: 'TestGUI.ps1', notes: 'Requires PowerShell 5.1+ and the .NET Windows Forms assembly' },
    },
  },
};

function nextName(type) {
  state.counters[type] = (state.counters[type] || 0) + 1;
  return type + state.counters[type];
}

function getControl(id) { return state.controls.find(c => c.id === id); }

function createControl(type, x, y, parentId, tabPage) {
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

  const parentZ = parentId ? ((getControl(parentId) && getControl(parentId).z) || 0) : 0;
  const ctrl = {
    id: 'c' + Math.random().toString(36).slice(2, 10),
    type, name,
    parentId: parentId || null,
    tabPage: tabPage || null, // which tab page of a TabControl parent this belongs to, if any
    x: snap(x), y: snap(y),
    w: def.defaultW, h: def.defaultH,
    z: parentZ + 1, // stays at parent.z + 1 until the user changes it manually
    dockOrder: null, // set when Dock is turned on; docking priority, NOT z, decides stacking order
    interact: false,
    props, events,
  };
  if (def.isTabControl) {
    // Design-time-only state (like `interact`): which tab is currently
    // showing in the designer. Not a "prop" because it's not part of the
    // generated output, just which page you're looking at while building.
    ctrl.activeTabId = (props.tabs[0] && props.tabs[0].id) || null;
  }
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

const TAB_HEADER_HEIGHT = 26; // must match .rc-tabcontrol-header / .tabcontrol-content CSS

// Real compound docking: controls docked to the same parent claim space in
// z-order (lowest z first), each shrinking the remaining "client rect" for
// the next one - exactly like a MenuStrip docked Top followed by a
// TabControl also docked Top: the menu claims the top strip first, and the
// tab control docks into whatever's left below it, rather than both
// independently snapping to y=0 and overlapping. Fill-docked controls
// always resolve last (after every edge-dock), taking whatever remains,
// regardless of dock-order among themselves and the edge-docked controls.
// Sorted by dockOrder (the sequence Dock was actually turned on for each
// control), NOT z - so a control docked first keeps its claim even if a
// later-docked sibling happens to have a lower z-index.
function applyDockStack(rawSiblings, bounds) {
  const siblings = rawSiblings.slice().sort((a, b) => (a.dockOrder ?? Infinity) - (b.dockOrder ?? Infinity));
  let rect = { x: 0, y: 0, w: bounds.w, h: bounds.h };
  const fillCtrls = [];

  siblings.forEach(ctrl => {
    const dockVal = ctrl.props.dock || 'None';
    if (dockVal === 'None') return;
    if (dockVal === 'Fill') { fillCtrls.push(ctrl); return; }
    switch (dockVal) {
      case 'Top':
        ctrl.x = rect.x; ctrl.y = rect.y; ctrl.w = Math.max(1, rect.w);
        rect = { x: rect.x, y: rect.y + ctrl.h, w: rect.w, h: Math.max(0, rect.h - ctrl.h) };
        break;
      case 'Bottom':
        ctrl.x = rect.x; ctrl.y = rect.y + rect.h - ctrl.h; ctrl.w = Math.max(1, rect.w);
        rect = { x: rect.x, y: rect.y, w: rect.w, h: Math.max(0, rect.h - ctrl.h) };
        break;
      case 'Left':
        ctrl.x = rect.x; ctrl.y = rect.y; ctrl.h = Math.max(1, rect.h);
        rect = { x: rect.x + ctrl.w, y: rect.y, w: Math.max(0, rect.w - ctrl.w), h: rect.h };
        break;
      case 'Right':
        ctrl.x = rect.x + rect.w - ctrl.w; ctrl.y = rect.y; ctrl.h = Math.max(1, rect.h);
        rect = { x: rect.x, y: rect.y, w: Math.max(0, rect.w - ctrl.w), h: rect.h };
        break;
      // Corner variants pin flush to a corner of whatever space remains,
      // WITHOUT stretching or claiming exclusive space - so several of
      // these can share the same strip (e.g. two images both pinned to
      // the top, one Top-Left and one Top-Right, with open space between
      // them). There's no automatic collision avoidance between corner
      // docks sharing a strip - if they're wide enough to touch, that's
      // on the layout, same as manually placing them would be.
      case 'TopLeft': ctrl.x = rect.x; ctrl.y = rect.y; break;
      case 'TopRight': ctrl.x = rect.x + rect.w - ctrl.w; ctrl.y = rect.y; break;
      case 'BottomLeft': ctrl.x = rect.x; ctrl.y = rect.y + rect.h - ctrl.h; break;
      case 'BottomRight': ctrl.x = rect.x + rect.w - ctrl.w; ctrl.y = rect.y + rect.h - ctrl.h; break;
    }
  });

  fillCtrls.forEach(ctrl => {
    ctrl.x = rect.x; ctrl.y = rect.y; ctrl.w = Math.max(1, rect.w); ctrl.h = Math.max(1, rect.h);
  });
}

function recomputeAllDocking() {
  applyDockStack(state.controls.filter(c => !c.parentId), { w: state.form.width, h: state.form.height });

  state.controls.forEach(c => {
    const def = CONTROL_DEFS[c.type];
    if (!def || !def.isContainer) return;
    if (def.isTabControl) {
      (c.props.tabs || []).forEach(tab => {
        const kids = state.controls.filter(ch => ch.parentId === c.id && ch.tabPage === tab.id);
        applyDockStack(kids, { w: c.w, h: Math.max(1, c.h - TAB_HEADER_HEIGHT) });
      });
    } else {
      const kids = state.controls.filter(ch => ch.parentId === c.id);
      applyDockStack(kids, { w: c.w, h: c.h });
    }
  });
}

// Undo/redo: rather than instrument every single mutation site, checkpoint
// centrally at the top of render() by comparing against the previous
// render's snapshot - since virtually every mutation in this app already
// ends in a render() call, this catches all of them for free. Continuous
// gestures (drag/resize) set suppressUndoCheckpoint so the whole gesture
// becomes one undo step instead of one per mousemove tick.
let lastSnapshotString = null;

function snapshotState() {
  return JSON.stringify({ controls: state.controls, form: state.form });
}

function maybeCheckpointUndo() {
  if (lastSnapshotString === null) { lastSnapshotString = snapshotState(); return; }
  if (state.suppressUndoCheckpoint) return;
  const newSnap = snapshotState();
  if (newSnap === lastSnapshotString) return;
  state.undoStack.push(lastSnapshotString);
  if (state.undoStack.length > 60) state.undoStack.shift();
  state.redoStack = [];
  lastSnapshotString = newSnap;
}

function restoreSnapshot(snapStr) {
  const data = JSON.parse(snapStr);
  state.controls = data.controls;
  state.form = data.form;
  if (state.selectedId && !getControl(state.selectedId)) state.selectedId = null;
  lastSnapshotString = snapStr; // this restore itself shouldn't create a new undo step
  render();
}

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(snapshotState());
  restoreSnapshot(state.undoStack.pop());
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(snapshotState());
  restoreSnapshot(state.redoStack.pop());
}

// The rect a non-docked child is actually allowed to occupy: the parent's
// full bounds, minus whatever space docked siblings have already claimed
// (e.g. a MenuStrip docked Top becomes the new effective top boundary for
// everything else in that parent). This mirrors applyDockStack's client-
// rect shrinkage but as a read-only query, so drag/resize/nudge/quick-pin
// actions can clamp against it without re-running the dock mutation pass.
function containerClientRect(parentId, tabPage) {
  let bounds;
  if (parentId) {
    const p = getControl(parentId);
    if (!p) return { x: 0, y: 0, w: state.form.width, h: state.form.height };
    let h = p.h;
    if (CONTROL_DEFS[p.type].isTabControl) h = Math.max(1, h - TAB_HEADER_HEIGHT);
    bounds = { w: p.w, h };
  } else {
    bounds = { w: state.form.width, h: state.form.height };
  }

  const dockedSiblings = state.controls
    .filter(c => (c.parentId || null) === (parentId || null) && (c.tabPage || null) === (tabPage || null))
    .filter(c => c.props.dock && c.props.dock !== 'None' && c.props.dock !== 'Fill')
    .sort((a, b) => (a.dockOrder ?? Infinity) - (b.dockOrder ?? Infinity));

  let rect = { x: 0, y: 0, w: bounds.w, h: bounds.h };
  dockedSiblings.forEach(ctrl => {
    switch (ctrl.props.dock) {
      case 'Top': rect = { x: rect.x, y: rect.y + ctrl.h, w: rect.w, h: Math.max(0, rect.h - ctrl.h) }; break;
      case 'Bottom': rect = { x: rect.x, y: rect.y, w: rect.w, h: Math.max(0, rect.h - ctrl.h) }; break;
      case 'Left': rect = { x: rect.x + ctrl.w, y: rect.y, w: Math.max(0, rect.w - ctrl.w), h: rect.h }; break;
      case 'Right': rect = { x: rect.x, y: rect.y, w: Math.max(0, rect.w - ctrl.w), h: rect.h }; break;
    }
  });
  return rect;
}

// Keeps every control within its parent's available space: a child can't
// be dragged/resized/nudged outside its container, a container can't be
// moved/resized outside its own parent, and a docked sibling's claimed
// space (see containerClientRect) is respected as a hard boundary too.
// Docked controls are skipped - their bounds are fully managed by the
// dock engine, not manual placement. Processes parents before children so
// a container's own clamped bounds are already final before its children
// are checked against them.
function clampAllToContainers() {
  const byId = {};
  state.controls.forEach(c => { byId[c.id] = c; });
  const depthOf = (c) => {
    let d = 0, p = c;
    while (p.parentId && byId[p.parentId]) { p = byId[p.parentId]; d++; }
    return d;
  };
  const ordered = state.controls.slice().sort((a, b) => depthOf(a) - depthOf(b));

  ordered.forEach(ctrl => {
    if (ctrl.props.dock && ctrl.props.dock !== 'None') return;
    const rect = containerClientRect(ctrl.parentId, ctrl.tabPage);
    ctrl.w = Math.min(ctrl.w, Math.max(12, rect.w));
    ctrl.h = Math.min(ctrl.h, Math.max(12, rect.h));
    ctrl.x = Math.max(rect.x, Math.min(ctrl.x, rect.x + rect.w - ctrl.w));
    ctrl.y = Math.max(rect.y, Math.min(ctrl.y, rect.y + rect.h - ctrl.h));
  });
}

function render() {
  recomputeAllDocking();
  clampAllToContainers();
  maybeCheckpointUndo();

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
  const fbs = state.form.formBorderStyle || 'Sizable';
  const noTitlebar = isHtml || fbs === 'None';
  const isToolWindow = fbs === 'FixedToolWindow' || fbs === 'SizableToolWindow';
  const isResizable = fbs === 'Sizable' || fbs === 'SizableToolWindow';
  const titlebarHeight = noTitlebar ? 0 : (isToolWindow ? 20 : 26);

  formEl.style.width = state.form.width + 'px';
  formEl.style.height = (state.form.height + (isHtml ? 0 : titlebarHeight)) + 'px';
  formEl.className = 'design-form skin-' + state.currentFormat +
    ' fbs-' + fbs.toLowerCase() +
    (isHtml || noTitlebar ? ' no-titlebar' : '') +
    (isToolWindow ? ' tool-window' : '') +
    (!isResizable ? ' not-resizable' : '');
  document.getElementById('designSurface').style.height = state.form.height + 'px';
  document.getElementById('designSurface').style.background = state.form.backColor;
  document.getElementById('formTitleText').textContent = isHtml ? state.form.text + ' \u2014 index.html' : state.form.text;

  const btnWrap = document.getElementById('formTitleButtons');
  btnWrap.innerHTML = '';
  if (!isHtml && !noTitlebar) {
    // Tool windows and dialog-style borders conventionally only show
    // Close, never Minimize/Maximize, matching real Windows chrome.
    if (state.form.minimizeBox && !isToolWindow && fbs !== 'FixedDialog') btnWrap.appendChild(titleGlyphBtn('\u2013'));
    if (state.form.maximizeBox && !isToolWindow && fbs !== 'FixedDialog') btnWrap.appendChild(titleGlyphBtn('\u25a1'));
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
  ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].forEach(pos => {
    const h = document.createElement('div');
    h.className = 'form-resize-handle frh-' + pos;
    h.dataset.handle = pos;
    h.addEventListener('mousedown', startFormResize);
    formEl.appendChild(h);
  });
}

function applyAnchorFromOrigin(ctrl, orig, prevW, prevH, newW, newH) {
  // Dock takes over entirely when active - Anchor is ignored, same as real
  // WinForms behavior (and what the Anchor tooltip already tells the user).
  if (ctrl.props.dock && ctrl.props.dock !== 'None') return;

  const anchorStr = ctrl.props.anchor || 'Top, Left';
  if (anchorStr === 'None') return;

  const anchor = anchorStr.split(',').map(s => s.trim());
  const hasLeft = anchor.includes('Left');
  const hasRight = anchor.includes('Right');
  const hasTop = anchor.includes('Top');
  const hasBottom = anchor.includes('Bottom');

  // Anchor keeps each checked edge's margin at a constant PERCENTAGE of the
  // parent's size (not a fixed pixel count), computed from the control's
  // bounds at the start of the resize. Checking all four edges means every
  // margin scales proportionally together, so the control grows/shrinks
  // and stays exactly as centered, relative to the parent, as it started.
  if (hasLeft && hasRight) {
    const leftPct = orig.x / prevW;
    const rightPct = (prevW - orig.x - orig.w) / prevW;
    const newLeft = leftPct * newW;
    const newRight = rightPct * newW;
    ctrl.x = Math.round(newLeft);
    ctrl.w = Math.max(12, Math.round(newW - newLeft - newRight));
  } else if (hasLeft) {
    ctrl.x = Math.round((orig.x / prevW) * newW);
  } else if (hasRight) {
    const rightPct = (prevW - orig.x - orig.w) / prevW;
    ctrl.x = Math.round(newW - rightPct * newW - orig.w);
  }

  if (hasTop && hasBottom) {
    const topPct = orig.y / prevH;
    const bottomPct = (prevH - orig.y - orig.h) / prevH;
    const newTop = topPct * newH;
    const newBottom = bottomPct * newH;
    ctrl.y = Math.round(newTop);
    ctrl.h = Math.max(12, Math.round(newH - newTop - newBottom));
  } else if (hasTop) {
    ctrl.y = Math.round((orig.y / prevH) * newH);
  } else if (hasBottom) {
    const bottomPct = (prevH - orig.y - orig.h) / prevH;
    ctrl.y = Math.round(newH - bottomPct * newH - orig.h);
  }
}

function startFormResize(e) {
  e.stopPropagation();
  e.preventDefault();
  const handle = e.currentTarget.dataset.handle;
  const startX = e.clientX, startY = e.clientY;
  const orig = { w: state.form.width, h: state.form.height };
  state.suppressUndoCheckpoint = true;
  // Snapshot top-level controls' bounds so Anchor's percentages are always
  // computed fresh from this origin (avoids compounding rounding drift
  // across many small mousemove ticks).
  const origCtrls = state.controls.filter(c => !c.parentId).map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));

  function onMove(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (handle.includes('e')) state.form.width = Math.max(200, snap(orig.w + dx));
    if (handle.includes('w')) state.form.width = Math.max(200, snap(orig.w - dx));
    if (handle.includes('s')) state.form.height = Math.max(150, snap(orig.h + dy));
    if (handle.includes('n')) state.form.height = Math.max(150, snap(orig.h - dy));

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
    state.suppressUndoCheckpoint = false;
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
      const items = (p.items || '').split('\n').filter(Boolean);
      wrap.innerHTML = `<div class="rc-toolstrip">${items.map(it => `<div class="rc-toolstrip-btn">${escapeHtml(it)}</div>`).join('')}</div>`;
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

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function sameZSiblings(ctrl) {
  return state.controls.filter(s =>
    s.id !== ctrl.id &&
    (s.parentId || null) === (ctrl.parentId || null) &&
    (s.tabPage || null) === (ctrl.tabPage || null) &&
    s.z === ctrl.z &&
    !(s.props.dock && s.props.dock !== 'None')
  );
}

function collidesAt(ctrl, x, y, w, h, siblings) {
  const testRect = { x, y, w, h };
  return siblings.some(s => rectsOverlap(testRect, { x: s.x, y: s.y, w: s.w, h: s.h }));
}

// Controls at the SAME z-index within the same parent can touch edges but
// never overlap (real collision); different z-indexes can still stack
// freely on top of each other, since that's the whole point of z-index.
// Slides along whichever axis isn't blocked rather than freezing outright,
// so dragging diagonally past a neighbor still feels natural.
function resolveDragCollision(ctrl, proposedX, proposedY) {
  const siblings = sameZSiblings(ctrl);
  if (!siblings.length) return { x: proposedX, y: proposedY };
  if (!collidesAt(ctrl, proposedX, proposedY, ctrl.w, ctrl.h, siblings)) return { x: proposedX, y: proposedY };
  if (!collidesAt(ctrl, proposedX, ctrl.y, ctrl.w, ctrl.h, siblings)) return { x: proposedX, y: ctrl.y };
  if (!collidesAt(ctrl, ctrl.x, proposedY, ctrl.w, ctrl.h, siblings)) return { x: ctrl.x, y: proposedY };
  return { x: ctrl.x, y: ctrl.y };
}

function startControlPick(onPick) {
  state.pickingCallback = onPick;
  document.body.classList.add('picking-mode');
  showPickingBanner();
}

function cancelControlPick() {
  state.pickingCallback = null;
  document.body.classList.remove('picking-mode');
  hidePickingBanner();
}

function showPickingBanner() {
  let banner = document.getElementById('pickingBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'pickingBanner';
    banner.className = 'picking-banner';
    banner.innerHTML = `<span>Click a control on the canvas to select it</span><button type="button" class="btn btn-ghost" id="pickingListBtn">Or pick from list</button><button type="button" class="btn btn-ghost" id="pickingCancelBtn">Cancel (Esc)</button>`;
    document.body.appendChild(banner);
    banner.querySelector('#pickingCancelBtn').addEventListener('click', cancelControlPick);
    banner.querySelector('#pickingListBtn').addEventListener('click', () => {
      buildObjectsList();
      document.getElementById('objectsModalOverlay').classList.add('open');
    });
  }
  banner.classList.add('open');
}

function hidePickingBanner() {
  const banner = document.getElementById('pickingBanner');
  if (banner) banner.classList.remove('open');
}

function onControlMouseDown(e) {
  const id = e.currentTarget.dataset.id;
  const ctrl = getControl(id);
  if (!ctrl) return;

  if (state.pickingCallback) {
    e.stopPropagation();
    e.preventDefault();
    const cb = state.pickingCallback;
    cancelControlPick();
    cb(ctrl);
    return;
  }

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
  state.suppressUndoCheckpoint = true;

  function onMove(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    const resolved = resolveDragCollision(ctrl, snap(origX + dx), snap(origY + dy));
    ctrl.x = resolved.x;
    ctrl.y = resolved.y;
    render();
    reselectAfterRender(id);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    dragCtx = null;
    state.suppressUndoCheckpoint = false;
    render();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startResize(e, ctrl, handle) {
  const startX = e.clientX, startY = e.clientY;
  const orig = { x: ctrl.x, y: ctrl.y, w: ctrl.w, h: ctrl.h };
  state.suppressUndoCheckpoint = true;
  // If this is a container, snapshot its children's bounds too so their
  // Anchor percentages compute from a fixed origin (not compounding
  // rounding drift tick-to-tick). Empty for leaf controls - harmless.
  const origChildren = state.controls.filter(c => c.parentId === ctrl.id).map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));

  function onMove(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    let { x, y, w, h } = orig;
    if (handle.includes('e')) w = Math.max(12, orig.w + dx);
    if (handle.includes('s')) h = Math.max(12, orig.h + dy);
    if (handle.includes('w')) { w = Math.max(12, orig.w - dx); x = orig.x + dx; }
    if (handle.includes('n')) { h = Math.max(12, orig.h - dy); y = orig.y + dy; }
    x = snap(x); y = snap(y); w = snap(w); h = snap(h);

    // Same-z siblings can touch but not overlap - if this resize would
    // grow into one, freeze at the control's last valid size/position.
    const siblings = sameZSiblings(ctrl);
    if (siblings.length && collidesAt(ctrl, x, y, w, h, siblings)) {
      x = ctrl.x; y = ctrl.y; w = ctrl.w; h = ctrl.h;
    }
    ctrl.x = x; ctrl.y = y; ctrl.w = w; ctrl.h = h;

    origChildren.forEach(oc => {
      const child = getControl(oc.id);
      if (!child) return;
      applyAnchorFromOrigin(child, oc, orig.w, orig.h, ctrl.w, ctrl.h);
    });

    render();
    reselectAfterRender(ctrl.id);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    state.suppressUndoCheckpoint = false;
    render();
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
      item.title = TOOL_DESCRIPTIONS[type] || def.label;
      item.innerHTML = `<span class="tool-icon">${toolIconSvg(type)}</span><span class="tool-label">${def.label}</span>`;
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
    let tabPage = null;
    const containerEl = document.elementFromPoint(e.clientX, e.clientY);
    const hostEl = containerEl && containerEl.closest && containerEl.closest('.ctrl');
    if (hostEl) {
      const hostCtrl = getControl(hostEl.dataset.id);
      if (hostCtrl && CONTROL_DEFS[hostCtrl.type].isContainer) {
        parentId = hostCtrl.id;
        // For a TabControl, coordinates are relative to the tab content
        // area (below the header strip), not the whole control, and the
        // new child belongs to whichever tab is currently active.
        const contentEl = hostEl.querySelector(':scope > .tabcontrol-content');
        const refEl = contentEl || hostEl;
        const refRect = refEl.getBoundingClientRect();
        x = e.clientX - refRect.left;
        y = e.clientY - refRect.top;
        if (CONTROL_DEFS[hostCtrl.type].isTabControl) tabPage = hostCtrl.activeTabId;
      }
    }
    const c = createControl(type, x, y, parentId, tabPage);
    selectControl(c.id);
  });
}

/* =========================================================================
   Properties pane
   ========================================================================= */

const EVENT_SNIPPETS = [
  { label: '-- Insert snippet --', code: '', help: '' },
  { label: 'Show message box', code: `[System.Windows.Forms.MessageBox]::Show("Message text", "Title")`, help: 'Pops up a small dialog with a message and an OK button. Good for confirmations, errors, or simple status updates. Replace "Message text" and "Title" with your own strings, or reference a variable like $SomeVariable.' },
  { label: 'Set another control\'s text', code: `$OtherControlName.Text = "New value"`, help: 'Changes a Label/TextBox/Button\'s displayed text from code. Replace $OtherControlName with the actual Name of the target control (see its Layout > Name property), and "New value" with the text you want, or a variable.' },
  { label: 'Read this control\'s value', code: `$value = $ThisControl.Text`, help: 'Grabs the current value out of a control (Text for TextBox/ComboBox, Checked for CheckBox, Value for TrackBar/NumericUpDown/DateTimePicker) into a variable you can use in the rest of this action. Replace $ThisControl with the current control\'s own Name.' },
  { label: 'Enable/disable another control', code: `$OtherControlName.Enabled = $true`, help: 'Turns another control on/off (greyed out and unclickable when $false). Common pattern: a checkbox or combo selection that should enable/disable a related field. Replace $OtherControlName with the target\'s Name, and $true/$false as needed.' },
];

// Per-event-NAME guidance - event names are shared across control types
// (every control's Click means roughly the same thing), so one entry
// each covers the whole app rather than needing one per control type.
const EVENT_HELP = {
  Click: 'Fires when the control is clicked (or activated via Enter/Space on a focused button). The most common event - use it for "do something when this is pressed."',
  CheckedChanged: 'Fires the moment a CheckBox/RadioButton\'s checked state changes, whether the user clicked it or code set .Checked directly.',
  SelectedIndexChanged: 'Fires when the selected item in a ComboBox/ListBox changes, whether by user pick or by code setting .SelectedIndex.',
  TextChanged: 'Fires on every edit to a TextBox/ComboBox\'s text - including every keystroke while typing, not just when focus leaves the field.',
  ValueChanged: 'Fires whenever a TrackBar/NumericUpDown/DateTimePicker\'s value changes, whether by user drag/click/typing or by code.',
  ItemCheck: 'Fires when an item\'s checkbox is toggled in a CheckedListBox - fires BEFORE the visual check state updates, so it reflects the state it\'s about to become, not what just happened.',
  LinkClicked: 'Fires when a LinkLabel is clicked.',
  Load: 'Fires once, right when the form first opens - the standard place to initialize starting values, populate lists, or set up anything the form needs before the user sees it.',
  ClickToClose: 'A dedicated, pre-filled "close the window when clicked" handler - only offered on Button, kept separate from the regular Click event on purpose. Closing the form used to be an ordinary snippet you could insert into any event on any control, including ones that fire constantly (like TextChanged on every keystroke) - which could close the window by accident. This is safer: it only exists as its own deliberate toggle on a Button.',
};

// Definitions for individual dropdown VALUES, not just the field itself -
// rendered as a small legend under the dropdown so every option's meaning
// is visible without guessing. Keyed by property key, then option value.
const OPTION_DEFINITIONS = {
  dock: {
    None: 'Not docked - stays exactly where you place it.',
    Top: 'Hugs the top edge and stretches to the full available width.',
    Bottom: 'Hugs the bottom edge and stretches to the full available width.',
    Left: 'Hugs the left edge and stretches to the full available height.',
    Right: 'Hugs the right edge and stretches to the full available height.',
    Fill: 'Takes up whatever space is left after every other docked control has claimed its edge.',
    TopLeft: 'Pins to the top-left corner without stretching - keeps its own width/height, so other controls can share the top edge with it.',
    TopRight: 'Pins to the top-right corner without stretching.',
    BottomLeft: 'Pins to the bottom-left corner without stretching.',
    BottomRight: 'Pins to the bottom-right corner without stretching.',
  },
  borderStyle: {
    None: 'No visible border at all.',
    FixedSingle: 'A thin, flat 1px line border.',
    Fixed3D: 'A sunken, inset-look border (classic Windows "recessed" field appearance).',
  },
  dropDownStyle: {
    DropDown: 'A text box with a dropdown arrow - the user can type a custom value OR pick from the list.',
    DropDownList: 'Dropdown only, no typing - the user must pick one of the listed items.',
    Simple: 'The list is shown inline (not collapsed into a dropdown) alongside an editable text box.',
  },
  selectionMode: {
    None: 'Nothing can be selected.',
    One: 'Exactly one item can be selected at a time.',
    MultiSimple: 'Click any item to toggle it in/out of the selection - no Ctrl key needed, multiple items build up as you click.',
    MultiExtended: 'Click selects one item; Ctrl+click toggles individual items; Shift+click selects a range - same as most Windows file pickers.',
  },
  sizeMode: {
    Normal: 'Image shown at its actual size, anchored to the top-left; gets cropped if the box is smaller.',
    StretchImage: 'Image is stretched to exactly fill the box, ignoring its original aspect ratio.',
    AutoSize: 'The box resizes itself to match the image\'s actual size.',
    CenterImage: 'Image is centered at its actual size; cropped if the box is smaller.',
    Zoom: 'Image is scaled as large as possible while preserving its aspect ratio, and centered.',
  },
  format: {
    Long: 'Full written-out date, e.g. "Saturday, August 15, 2026".',
    Short: 'Compact numeric date, e.g. "8/15/2026".',
    Time: 'Time only, e.g. "3:45 PM" - switches the picker itself to a time input.',
    Custom: 'Displays whatever raw value is stored, unformatted.',
  },
  textAlign: {
    Left: 'Text is left-aligned within the control.',
    Center: 'Text is centered within the control.',
    Right: 'Text is right-aligned within the control.',
  },
  cursor: {
    Default: 'The normal system arrow pointer.',
    Hand: 'A pointing hand - signals the control is clickable, like a link.',
    IBeam: 'A text-insertion cursor - typically used for editable text fields.',
    Wait: 'A busy/loading indicator.',
    Cross: 'A crosshair - often used for precise selection.',
    SizeAll: 'A four-way move cursor - signals the control can be dragged.',
  },
  startPosition: {
    CenterScreen: 'Opens centered on the screen.',
    Manual: 'Opens at whatever Location is set in code - not centered anywhere automatically.',
    CenterParent: 'Opens centered over its parent/owner window.',
    WindowsDefaultLocation: 'Opens wherever Windows decides to cascade it, with the size you set.',
    WindowsDefaultBounds: 'Opens wherever Windows decides, AND lets Windows pick the size too (ignoring your Width/Height).',
  },
  formBorderStyle: {
    None: 'No border and no title bar at all.',
    FixedSingle: 'Thin fixed border, not resizable by dragging the edges.',
    Fixed3D: 'Sunken-look fixed border, not resizable.',
    FixedDialog: 'Thicker fixed border typical of dialog boxes, not resizable.',
    Sizable: 'Standard resizable window border - the normal default.',
    FixedToolWindow: 'Thin fixed border with a small tool-window-style title bar (no minimize/maximize buttons), not resizable.',
    SizableToolWindow: 'Same small tool-window title bar as FixedToolWindow, but resizable.',
  },
};

function showInfoModal(title, key, options) {
  const overlay = document.getElementById('infoModalOverlay');
  document.getElementById('infoModalTitle').textContent = title;
  const body = document.getElementById('infoModalBody');
  body.innerHTML = '';
  const defs = OPTION_DEFINITIONS[key] || {};
  options.forEach(o => {
    if (!defs[o]) return;
    const line = document.createElement('div');
    line.className = 'option-legend-line';
    line.innerHTML = `<span class="option-legend-value">${escapeHtml(o)}</span><span class="option-legend-text">${escapeHtml(defs[o])}</span>`;
    body.appendChild(line);
  });
  overlay.classList.add('open');
}

function buildOptionInfoButton(key, label, options) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'option-info-btn';
  btn.textContent = 'i';
  btn.title = `What do the ${label} options mean?`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    showInfoModal(label, key, options);
  });
  return btn;
}

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
  dock: 'Dock: hugs and stretches along the chosen edge of the parent - like a taskbar or menu bar. Always flush, always full-length on that edge, no matter how the parent resizes. Overrides Anchor while active.',
  anchor: 'Anchor: keeps this control the same PERCENTAGE distance from each checked edge as the parent resizes (not a fixed pixel margin). Check one edge to reposition proportionally along that axis; check both edges on an axis to scale/stretch proportionally along it. Check all four to keep the control scaling while staying exactly as centered, relative to the parent, as it started. Ignored while Dock is set to anything other than None.',
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
  tabs: 'The tab pages on this control. Rename, add, or remove pages here; click "Show" on a page to switch the canvas to it before placing controls - each page keeps its own separate set of children.',
};

function tt(key) { return TOOLTIPS[key] || ''; }

// Detailed, per-type guidance with a concrete example - shown as its own
// "Help" node in the properties pane for every control, not just the ones
// that seemed confusing. This is the reference a person reaches for when
// they're not sure what a property does or how a control is meant to be
// wired up.
const CONTROL_HELP = {
  Button: 'A clickable push-button. Text is the caption shown on the button. Wire the Click event (Events section below) to run code when it\'s pressed. Example: Text="Save", then in Click write code that writes your form\'s field values to a file.',
  Label: 'Static, read-only text - the user can\'t type into or click it (it has no events). Use it for captions, headings, and instructions next to other controls. Example: a Label reading "Customer Name:" placed just above or beside a TextBox.',
  TextBox: 'A field the user can type into. Text holds the current/starting value. Multiline allows multiple lines (renders as a resizable text area), ReadOnly makes it display-only, PasswordChar masks input (e.g. "*"), MaxLength caps the character count. Example: PasswordChar="*", MaxLength=50 for a password field.',
  CheckBox: 'An independent on/off toggle - unlike RadioButton, any number of CheckBoxes can be checked at once. Checked sets whether it starts ticked. Wire CheckedChanged to react when the user toggles it. Example: a "Remember me" setting, Checked=false by default.',
  RadioButton: 'A mutually-exclusive choice - only one RadioButton per Group Name can be checked at a time. Give every radio button that should behave as one group the SAME Group Name; different Group Names create independent groups. Example: three radio buttons with Group Name="ShippingSpeed" - Standard/Express/Overnight - only one selectable at once.',
  ComboBox: 'A dropdown list. Enter the choices in Items, one per line. Selected Index sets which item is picked by default (0 = first item, -1 = none). Drop Down Style controls whether the user can type a custom value, must pick from the list, or sees it inline. Example: Items="Small\nMedium\nLarge", Selected Index=1 starts on "Medium".',
  ListBox: 'A scrollable list of choices, always visible (not a dropdown). Enter choices in Items, one per line. Selection Mode controls whether the user can pick none/one/multiple items at once. Example: Items="Red\nGreen\nBlue", Selection Mode="MultiExtended" lets the user Ctrl/Shift-click multiple colors.',
  CheckedListBox: 'A real WinForms control that\'s often confused for a dropdown, but it isn\'t one - it\'s always-visible, like ListBox, except every item has its own checkbox so multiple can be picked without needing Ctrl/Shift. Check On Click controls whether a single click toggles the box (true, the common choice) or requires clicking exactly on the checkbox glyph (false). Example: a permissions list where several boxes should be checkable at a glance.',
  Panel: 'A plain, unlabeled container for grouping other controls - drag controls from the toolbox onto it, or use a control\'s Parent dropdown (Layout section) to move it in without dragging. Has no border/title of its own; use GroupBox instead if you want a visible boundary and caption. Example: group a set of address fields inside a Panel so you can reposition or hide them as one unit.',
  GroupBox: 'A bordered, titled container - like Panel, but draws a visible border and caption (Text) so the grouping is obvious to the user. Example: Text="Shipping Address" around a set of address TextBoxes.',
  PictureBox: 'Displays an image. Image Source is a file path or URL. Size Mode controls how the image fits the box - e.g. StretchImage fills it (ignoring aspect ratio), Zoom fits within it (preserving aspect ratio). Example: Image Source="logo.png", Size Mode="Zoom".',
  ProgressBar: 'Shows progress toward completion as a filled bar. Min/Max define the range you\'re measuring (commonly 0-100); Value is where the fill currently sits. In the designer this is just a static preview - there\'s no automatic link to a running command. To show REAL progress at runtime, update Value from your own script as the work happens, e.g.: for ($i=0; $i -le 100; $i+=10) { $ProgressBar1.Value = $i; $Form.Refresh(); Start-Sleep -Milliseconds 200 }',
  TrackBar: 'A draggable slider for picking a numeric value within Min/Max. Value is the starting position; Tick Frequency controls how often a tick mark is drawn along the track. Wire ValueChanged to react as the user drags it. Example: Min=0, Max=100, Value=50, Tick Frequency=10 for a volume-style slider.',
  NumericUpDown: 'A number field with up/down spinner arrows. Min/Max constrain the range, Value is the starting number, Increment is how much each spinner click changes it, Decimal Places sets digits after the decimal point. Example: Min=0, Max=10, Value=1, Increment=1 for a quantity selector.',
  DateTimePicker: 'Lets the user pick a date (or a time, if Format="Time"). Format controls how the value is DISPLAYED (Long/Short/Time/Custom) - it doesn\'t change what\'s stored, only how it looks. Value holds the actual date/time. Example: Format="Short" shows "8/15/2026"; Format="Long" shows "Saturday, August 15, 2026".',
  RichTextBox: 'A multi-line text area for longer content than a TextBox is meant for (notes, logs, formatted text). Text holds the current content. Example: a scrollable output/log panel your script appends status messages to at runtime.',
  LinkLabel: 'Text styled and behaving like a hyperlink. Text is the label shown; URL is where it navigates when clicked (wire LinkClicked to run custom code instead of, or in addition to, navigating). Example: Text="Visit our site", URL="https://example.com".',
  MenuStrip: 'A top menu bar (File/Edit/View/Help, etc). Comes with preset File/View/Help menus you can check on/off, rename, or add custom menus/items to via the Menu Items editor below. Each item can have its own click code - presets like File > Exit and Help > About already come with working defaults. Example: uncheck "Zoom In/Out" if you don\'t need them, or add a custom "Tools > Settings" entry with your own code.',
  TabControl: 'A container with multiple named tab pages, each holding its own separate set of child controls. Use the Tabs editor below to add/rename/remove pages; click "Show" on a page (or click its header on the canvas) to switch which page you\'re placing controls onto. Example: an "Options" dialog with "General", "Advanced", and "About" tabs, each with different controls on it.',
  Form: 'The main window itself - everything else sits inside it. Title is the text shown in the title bar. Form Border Style controls the window\'s chrome and whether it can be resized. Comment-Based Help below becomes the PowerShell help block at the top of every generated file.',
  MaskedTextBox: 'A TextBox that enforces a fixed input pattern instead of free text. Mask uses WinForms mask characters: 0 = required digit, 9 = optional digit, L = required letter, > = force uppercase, < = force lowercase. Example: Mask="000-00-0000" for a Social Security Number field.',
  FlowLayoutPanel: 'A container that automatically arranges its children in a line, wrapping to the next row/column when it runs out of room - similar to how text wraps. Flow Direction sets which way it flows; Wrap Contents controls whether it wraps at all or just keeps going off the edge. Example: a toolbar of buttons that should reflow as the window resizes.',
  TableLayoutPanel: 'A container that arranges its children into a grid - set Columns and Rows to the grid size you want, then place children into specific cells. Example: a 2-column form layout with a Label in each left cell and its matching input in the right cell.',
  StatusStrip: 'A thin status bar, almost always docked to the bottom of the form. Text is the message shown - commonly updated from code as the app does things, e.g. $StatusStrip1.Text = "Saved.".',
  ToolStrip: 'A horizontal bar of quick-action buttons, almost always docked to the top. Add button labels in Items, one per line. Example: Items="New\\nOpen\\nSave" for a classic file toolbar.',
};

function buildUsageHintBlock(text) {
  const div = document.createElement('div');
  div.className = 'usage-hint';
  div.textContent = text;
  return div;
}

function showInfoModalText(title, text) {
  const overlay = document.getElementById('infoModalOverlay');
  document.getElementById('infoModalTitle').textContent = title;
  const body = document.getElementById('infoModalBody');
  body.innerHTML = '';
  const p = document.createElement('div');
  p.className = 'option-legend-text info-modal-freetext';
  p.textContent = text;
  body.appendChild(p);
  overlay.classList.add('open');
}

function buildSelHeaderInfoBtn(title, text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'option-info-btn sel-info-btn';
  btn.textContent = 'i';
  btn.title = `What is a ${title}?`;
  btn.addEventListener('click', () => showInfoModalText(title.toUpperCase(), text));
  return btn;
}

function renderProps() {
  const pane = document.getElementById('propsBody');
  const header = document.getElementById('propsHeader');
  pane.innerHTML = '';
  header.innerHTML = '';

  const ctrl = getControl(state.selectedId);
  if (!ctrl) {
    const typeRow = document.createElement('div');
    typeRow.className = 'sel-header-row';
    if (CONTROL_HELP.Form) typeRow.appendChild(buildSelHeaderInfoBtn('Form', CONTROL_HELP.Form));
    const typeLabel = document.createElement('div');
    typeLabel.className = 'sel-type';
    typeLabel.textContent = 'FORM';
    typeRow.appendChild(typeLabel);
    const nameLabel = document.createElement('div');
    nameLabel.className = 'sel-name';
    nameLabel.textContent = state.form.text;
    const wrap = document.createElement('div');
    wrap.appendChild(typeRow);
    wrap.appendChild(nameLabel);
    header.appendChild(wrap);
    pane.appendChild(buildFormProps());
    return;
  }

  const typeRow = document.createElement('div');
  typeRow.className = 'sel-header-row';
  if (CONTROL_HELP[ctrl.type]) typeRow.appendChild(buildSelHeaderInfoBtn(ctrl.type, CONTROL_HELP[ctrl.type]));
  const typeLabel = document.createElement('div');
  typeLabel.className = 'sel-type';
  typeLabel.textContent = ctrl.type.toUpperCase();
  typeRow.appendChild(typeLabel);
  const nameLabel = document.createElement('div');
  nameLabel.className = 'sel-name';
  nameLabel.textContent = ctrl.name;
  const wrap = document.createElement('div');
  wrap.appendChild(typeRow);
  wrap.appendChild(nameLabel);
  header.appendChild(wrap);

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

function absolutePosition(ctrl) {
  let x = ctrl.x, y = ctrl.y;
  let p = ctrl.parentId ? getControl(ctrl.parentId) : null;
  while (p) {
    x += p.x;
    y += p.y;
    if (CONTROL_DEFS[p.type].isTabControl) y += TAB_HEADER_HEIGHT;
    p = p.parentId ? getControl(p.parentId) : null;
  }
  return { x, y };
}

function isDescendantOf(candidate, ctrl) {
  let p = candidate;
  while (p) {
    if (p.id === ctrl.id) return true;
    p = p.parentId ? getControl(p.parentId) : null;
  }
  return false;
}

// Moves a control to a new parent (or back to the main window) while
// keeping it visually where it was - so picking a new Parent from the
// dropdown doesn't make the control jump somewhere unexpected, the way a
// drag-and-drop reparent wouldn't either.
function reparentControl(ctrl, newParentId) {
  const abs = absolutePosition(ctrl);
  ctrl.parentId = newParentId || null;
  ctrl.tabPage = null;

  if (newParentId) {
    const newParent = getControl(newParentId);
    let offsetX = newParent.x, offsetY = newParent.y;
    let pp = newParent.parentId ? getControl(newParent.parentId) : null;
    while (pp) {
      offsetX += pp.x; offsetY += pp.y;
      if (CONTROL_DEFS[pp.type].isTabControl) offsetY += TAB_HEADER_HEIGHT;
      pp = pp.parentId ? getControl(pp.parentId) : null;
    }
    if (CONTROL_DEFS[newParent.type].isTabControl) {
      ctrl.tabPage = newParent.activeTabId;
      offsetY += TAB_HEADER_HEIGHT;
    }
    ctrl.x = Math.max(0, snap(abs.x - offsetX));
    ctrl.y = Math.max(0, snap(abs.y - offsetY));
  } else {
    ctrl.x = Math.max(0, snap(abs.x));
    ctrl.y = Math.max(0, snap(abs.y));
  }
}

function buildParentDropdownRow(ctrl) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const label = document.createElement('label');
  label.textContent = 'Parent';
  label.title = 'Which container this control belongs to. Change it to move the control into a different Panel/GroupBox/TabControl - or back to the main window - without dragging. The list fills in automatically as you add containers.';

  const select = document.createElement('select');
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(none \u2014 main window)';
  select.appendChild(noneOpt);

  state.controls
    .filter(c => c.id !== ctrl.id && CONTROL_DEFS[c.type].isContainer && !isDescendantOf(c, ctrl))
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.type})`;
      select.appendChild(opt);
    });

  select.value = ctrl.parentId || '';

  select.addEventListener('change', (e) => {
    reparentControl(ctrl, e.target.value || null);
    render();
  });

  row.appendChild(label);
  row.appendChild(select);
  return row;
}

// Related-control families, for the "Convert To" dropdown - lets a control
// switch to a close relative in place (keeping position/size/name/parent)
// instead of deleting and rebuilding it from scratch.
const CONTROL_FAMILIES = {
  ListBox: ['ComboBox', 'CheckedListBox'],
  ComboBox: ['ListBox', 'CheckedListBox'],
  CheckedListBox: ['ListBox', 'ComboBox'],
  TextBox: ['RichTextBox'],
  RichTextBox: ['TextBox'],
  CheckBox: ['RadioButton'],
  RadioButton: ['CheckBox'],
  Panel: ['GroupBox'],
  GroupBox: ['Panel'],
};

function convertControlType(ctrl, newType) {
  const oldType = ctrl.type;
  const oldProps = ctrl.props;
  const oldEvents = ctrl.events;
  const newDef = CONTROL_DEFS[newType];

  const cloneDefault = (v) => (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  const newProps = {};
  newDef.props.forEach(([key, , , def0]) => { newProps[key] = cloneDefault(def0); });
  COMMON_APPEARANCE_PROPS.forEach(([key, , , def0]) => { newProps[key] = cloneDefault(def0); });
  COMMON_BEHAVIOR_PROPS.forEach(([key, , , def0]) => { newProps[key] = cloneDefault(def0); });
  // Best-effort carry-over: any prop key that exists on both old and new
  // types keeps its value (e.g. Items survives ListBox -> ComboBox).
  Object.keys(newProps).forEach(key => { if (key in oldProps) newProps[key] = oldProps[key]; });

  const newEvents = {};
  newDef.events.forEach(evt => { newEvents[evt] = oldEvents[evt] || null; });

  // If the name still matches the auto-generated pattern for the old type
  // (e.g. "ListBox1"), rename it to match the new type; a custom name is
  // left alone.
  if (ctrl.name.startsWith(oldType)) {
    ctrl.name = newType + ctrl.name.slice(oldType.length);
  }

  ctrl.type = newType;
  ctrl.props = newProps;
  ctrl.events = newEvents;
  if (CONTROL_DEFS[newType].isTabControl && !ctrl.activeTabId) {
    ctrl.activeTabId = (newProps.tabs && newProps.tabs[0] && newProps.tabs[0].id) || null;
  }
}

function buildConvertToRow(ctrl) {
  const family = CONTROL_FAMILIES[ctrl.type];
  if (!family || !family.length) return null;

  const row = document.createElement('div');
  row.className = 'prop-row';
  const label = document.createElement('label');
  label.textContent = 'Convert To';
  label.title = 'Switch this control to a closely related type, keeping its position, size, name, and parent - only type-specific properties reset to defaults.';
  const select = document.createElement('select');
  const keepOpt = document.createElement('option');
  keepOpt.value = '';
  keepOpt.textContent = `(keep as ${ctrl.type})`;
  select.appendChild(keepOpt);
  family.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  });
  select.addEventListener('change', (e) => {
    if (!e.target.value) return;
    convertControlType(ctrl, e.target.value);
    state.selectedId = ctrl.id;
    render();
  });
  row.appendChild(label);
  row.appendChild(select);
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
  frag.appendChild(buildParentDropdownRow(ctrl));
  const convertRow = buildConvertToRow(ctrl);
  if (convertRow) frag.appendChild(convertRow);

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

function buildAnchorEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'prop-row anchor-editor-row';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.title = tt(key);

  const grid = document.createElement('div');
  grid.className = 'anchor-editor-grid';

  const current = ctrl.props[key] || 'Top, Left';
  const flags = current === 'None' ? [] : current.split(',').map(s => s.trim());
  const order = ['Top', 'Bottom', 'Left', 'Right'];

  order.forEach(edge => {
    const chip = document.createElement('label');
    chip.className = 'anchor-editor-chip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = flags.includes(edge);
    cb.addEventListener('change', () => {
      const set = new Set(flags);
      if (cb.checked) set.add(edge); else set.delete(edge);
      flags.length = 0;
      order.filter(o => set.has(o)).forEach(o => flags.push(o));
      ctrl.props[key] = flags.length ? flags.join(', ') : 'None';
      // No immediate positional effect - Anchor is forward-looking, its
      // percentages get captured fresh the next time the parent resizes.
      render();
    });
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(edge));
    grid.appendChild(chip);
  });

  wrap.appendChild(labelEl);
  wrap.appendChild(grid);
  return wrap;
}

function buildItemsListEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'items-list-editor';

  const heading = document.createElement('div');
  heading.className = 'items-list-heading';
  heading.title = 'The selectable entries in this control. Add, remove, or edit them below - order matters (item 0 is first).';
  heading.textContent = label;
  wrap.appendChild(heading);

  const arr = (ctrl.props[key] || '').split('\n').filter((s, i, a) => !(s === '' && i === a.length - 1));
  const sync = () => { ctrl.props[key] = arr.join('\n'); render(); };

  arr.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'items-list-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = item;
    input.addEventListener('change', () => { arr[i] = input.value; sync(); });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
    delBtn.textContent = '\u2715';
    delBtn.title = 'Remove this item.';
    delBtn.addEventListener('click', () => { arr.splice(i, 1); sync(); });
    row.appendChild(input);
    row.appendChild(delBtn);
    wrap.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost menu-add-btn';
  addBtn.textContent = '+ Add item';
  addBtn.addEventListener('click', () => { arr.push('New Item'); sync(); });
  wrap.appendChild(addBtn);

  return wrap;
}

function buildPropRows(ctrl, propDefs) {
  const frag = document.createElement('div');
  propDefs.forEach(([key, label, type, , extra]) => {
    const tipAttr = escapeHtml(tt(key));

    if (type === 'hidden') return; // tracked in props for codegen/undo, but not user-editable as a raw row
    if (type === 'menuEditor') {
      frag.appendChild(buildMenuEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'tabEditor') {
      frag.appendChild(buildTabEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'anchorEditor') {
      frag.appendChild(buildAnchorEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'itemsListEditor') {
      frag.appendChild(buildItemsListEditorRow(ctrl, key, label));
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
      row.querySelector('select').addEventListener('change', (e) => {
        const newVal = e.target.value;
        if (key === 'dock') {
          if (newVal !== 'None' && (ctrl.props.dock || 'None') === 'None') ctrl.dockOrder = ++state.dockOrderSeq;
          if (newVal === 'None') ctrl.dockOrder = null;
        }
        ctrl.props[key] = newVal;
        render(); // docking (if this was Dock) is recomputed centrally at the top of render()
      });
      if (OPTION_DEFINITIONS[key]) row.querySelector('label').appendChild(buildOptionInfoButton(key, label, extra.options));
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

/* =========================================================================
   TabControl editor: add/rename/remove tab pages
   ========================================================================= */

function buildTabEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'tab-editor';

  const heading = document.createElement('div');
  heading.className = 'tab-editor-heading';
  heading.title = tt(key);
  heading.textContent = label;
  wrap.appendChild(heading);

  const tabs = ctrl.props[key];
  tabs.forEach((tab, ti) => {
    wrap.appendChild(buildTabEditorItem(ctrl, tabs, tab, ti));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost tab-add-btn';
  addBtn.textContent = '+ Add tab';
  addBtn.title = 'Add a new tab page.';
  addBtn.addEventListener('click', () => {
    const newId = 'tab' + Math.random().toString(36).slice(2, 8);
    tabs.push({ id: newId, label: 'Tab' + (tabs.length + 1) });
    render();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function buildTabEditorItem(ctrl, tabs, tab, ti) {
  const row = document.createElement('div');
  row.className = 'tab-editor-item' + (tab.id === ctrl.activeTabId ? ' active' : '');

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'menu-editor-label-input';
  nameInput.value = tab.label;
  nameInput.addEventListener('change', (e) => { tab.label = e.target.value.trim() || tab.label; render(); });

  const selectBtn = document.createElement('button');
  selectBtn.type = 'button';
  selectBtn.className = 'btn btn-ghost tab-select-btn';
  selectBtn.textContent = tab.id === ctrl.activeTabId ? 'Active' : 'Show';
  selectBtn.title = 'Switch the canvas to this tab page so you can place controls on it.';
  selectBtn.addEventListener('click', () => { ctrl.activeTabId = tab.id; render(); });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this tab page and everything placed on it.';
  delBtn.addEventListener('click', () => {
    if (tabs.length <= 1) return; // a TabControl needs at least one tab
    state.controls = state.controls.filter(c => !(c.parentId === ctrl.id && c.tabPage === tab.id));
    tabs.splice(ti, 1);
    if (ctrl.activeTabId === tab.id) ctrl.activeTabId = tabs[0].id;
    render();
  });

  row.appendChild(nameInput);
  row.appendChild(selectBtn);
  row.appendChild(delBtn);
  return row;
}

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

function buildActionBlock(ctrl, evtName, actions, i, sync) {
  const card = document.createElement('div');
  card.className = 'action-block';

  const head = document.createElement('div');
  head.className = 'action-block-head';
  const label = document.createElement('span');
  label.textContent = `Action ${i + 1}`;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this action.';
  delBtn.addEventListener('click', () => {
    actions.splice(i, 1);
    if (!actions.length) actions.push('');
    sync();
    render();
  });
  head.appendChild(label);
  head.appendChild(delBtn);
  card.appendChild(head);

  const snippetRow = document.createElement('div');
  snippetRow.className = 'snippet-row';
  const sel = document.createElement('select');
  EVENT_SNIPPETS.forEach(s => {
    const o = document.createElement('option');
    o.textContent = s.label;
    o.dataset.code = s.code;
    o.dataset.help = s.help;
    sel.appendChild(o);
  });
  const infoBtn = document.createElement('button');
  infoBtn.type = 'button';
  infoBtn.className = 'option-info-btn';
  infoBtn.textContent = 'i';
  infoBtn.title = 'What does this snippet do?';
  infoBtn.addEventListener('click', () => {
    const opt = sel.selectedOptions[0];
    showInfoModalText(opt.textContent.toUpperCase(), opt.dataset.help || 'No description yet.');
  });
  const insertBtn = document.createElement('button');
  insertBtn.type = 'button';
  insertBtn.className = 'btn btn-ghost';
  insertBtn.textContent = 'Insert';
  snippetRow.appendChild(sel);
  snippetRow.appendChild(infoBtn);
  snippetRow.appendChild(insertBtn);
  card.appendChild(snippetRow);

  const ta = document.createElement('textarea');
  ta.className = 'action-code';
  ta.placeholder = 'PowerShell / JS for this action';
  ta.value = actions[i];
  ta.addEventListener('change', () => { actions[i] = ta.value; sync(); });
  card.appendChild(ta);

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'btn btn-ghost pick-control-btn';
  pickBtn.innerHTML = '\u2316 Select Control';
  pickBtn.title = 'Click, then click any control on the canvas (even ones not currently visible in a collapsed tab/panel) to insert its name here - no need to remember or hunt for the exact spelling.';
  pickBtn.addEventListener('click', () => {
    startControlPick((pickedCtrl) => {
      const varRef = '$' + pickedCtrl.name;
      if (ta.value.includes('$OtherControlName')) {
        ta.value = ta.value.replace('$OtherControlName', varRef);
      } else {
        const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
        const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
        ta.value = ta.value.slice(0, start) + varRef + ta.value.slice(end);
      }
      actions[i] = ta.value;
      sync();
      render();
    });
  });
  card.appendChild(pickBtn);

  insertBtn.addEventListener('click', () => {
    const code = sel.selectedOptions[0].dataset.code;
    if (!code) return;
    ta.value = (ta.value ? ta.value + '\n' : '') + code;
    actions[i] = ta.value;
    sync();
  });

  return card;
}

function buildActionsEditor(ctrl, evtName, data) {
  const wrap = document.createElement('div');
  wrap.className = 'actions-editor';

  const heading = document.createElement('div');
  heading.className = 'items-list-heading';
  heading.title = 'Each action runs in order when this event fires. Add as many as you need - e.g. update a label, AND enable another control, AND show a message, all from one event.';
  heading.textContent = 'Actions';
  wrap.appendChild(heading);

  // Actions are stored as one string (data.code, same field codegen has
  // always read), split on blank lines - so this is purely a friendlier
  // editing view, not a data-model change; nothing downstream needs to
  // know actions exist as a concept.
  const actions = data.code ? data.code.split('\n\n') : [''];
  const sync = () => { data.code = actions.join('\n\n'); ctrl.events[evtName] = data; };

  actions.forEach((action, i) => wrap.appendChild(buildActionBlock(ctrl, evtName, actions, i, sync)));

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost menu-add-btn';
  addBtn.textContent = '+ Add action';
  addBtn.title = 'Add another action to run when this event fires, alongside the ones above.';
  addBtn.addEventListener('click', () => { actions.push(''); sync(); render(); });
  wrap.appendChild(addBtn);

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
    const headLeft = document.createElement('span');
    headLeft.className = 'event-block-head-left';
    if (EVENT_HELP[evtName]) {
      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'option-info-btn';
      infoBtn.textContent = 'i';
      infoBtn.title = `What is ${evtName}?`;
      infoBtn.addEventListener('click', (ev) => { ev.stopPropagation(); showInfoModalText(evtName.toUpperCase(), EVENT_HELP[evtName]); });
      headLeft.appendChild(infoBtn);
    }
    headLeft.appendChild(document.createTextNode(evtName));
    const headRight = document.createElement('span');
    headRight.textContent = existing ? '\u2212 remove (dbl-click)' : '+ add handler';
    head.appendChild(headLeft);
    head.appendChild(headRight);

    const body = document.createElement('div');
    body.className = 'event-block-body';

    const data = existing || { fn: `${ctrl.name}_${evtName}`, code: evtName === 'ClickToClose' ? '$Form.Close()' : '', ps1: '' };

    const fnRow = document.createElement('div');
    fnRow.className = 'prop-row';
    fnRow.innerHTML = `<label title="Name of the function/handler that runs when ${evtName} fires.">Function</label><input type="text" value="${escapeHtml(data.fn)}">`;
    fnRow.querySelector('input').addEventListener('change', (e) => { data.fn = e.target.value; ctrl.events[evtName] = data; });

    const ps1Row = document.createElement('div');
    ps1Row.className = 'prop-row';
    ps1Row.innerHTML = `<label title="Path to an external .ps1 script to dot-source and call instead of inline code.">Or .ps1 file</label><input type="text" placeholder="handlers\\${ctrl.name}_${evtName}.ps1" value="${escapeHtml(data.ps1)}">`;
    ps1Row.querySelector('input').addEventListener('change', (e) => { data.ps1 = e.target.value; ctrl.events[evtName] = data; });

    body.appendChild(fnRow);
    body.appendChild(buildActionsEditor(ctrl, evtName, data));
    body.appendChild(ps1Row);

    head.addEventListener('click', () => {
      if (!ctrl.events[evtName]) {
        ctrl.events[evtName] = data;
        render();
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
    topMost: 'Keeps the window above all other windows.',
  };
  [['minimizeBox', 'Minimize Button'], ['maximizeBox', 'Maximize Button'], ['closeBox', 'Close Button'], ['topMost', 'Always On Top (TopMost)']].forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'toggle-row';
    row.title = chromeTips[key];
    row.innerHTML = `<span class="toggle-label">${label}</span><label class="switch"><input type="checkbox" ${state.form[key] ? 'checked' : ''}><span class="track"></span></label>`;
    row.querySelector('input').addEventListener('change', (e) => { state.form[key] = e.target.checked; render(); });
    frag.appendChild(row);
  });

  // FormBorderStyle is a real multi-value WinForms enum (not a plain
  // true/false), so it's a dropdown - not a toggle - with every option
  // explained, since "Sizable" vs "FixedToolWindow" isn't self-evident.
  const fbsRow = document.createElement('div');
  fbsRow.className = 'prop-row';
  const fbsOpts = ['None', 'FixedSingle', 'Fixed3D', 'FixedDialog', 'Sizable', 'FixedToolWindow', 'SizableToolWindow'];
  fbsRow.innerHTML = `<label title="Controls the window's border/title-bar style AND whether it can be resized - a real WinForms enum, not a simple on/off.">Form Border Style</label><select>${fbsOpts.map(o => `<option ${o === state.form.formBorderStyle ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  fbsRow.querySelector('select').addEventListener('change', (e) => { state.form.formBorderStyle = e.target.value; render(); });
  fbsRow.querySelector('label').appendChild(buildOptionInfoButton('formBorderStyle', 'Form Border Style', fbsOpts));
  frag.appendChild(fbsRow);

  const startRow = document.createElement('div');
  startRow.className = 'prop-row';
  const opts = ['CenterScreen', 'Manual', 'CenterParent', 'WindowsDefaultLocation', 'WindowsDefaultBounds'];
  startRow.innerHTML = `<label title="Where the window appears on screen the first time it opens.">Start Position</label><select>${opts.map(o => `<option ${o === state.form.startPosition ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  startRow.querySelector('select').addEventListener('change', (e) => { state.form.startPosition = e.target.value; });
  startRow.querySelector('label').appendChild(buildOptionInfoButton('startPosition', 'Start Position', opts));
  frag.appendChild(startRow);

  return frag;
}

/* ---- Comment-based help builder (PowerShell-style .SYNOPSIS/.DESCRIPTION/etc.) ---- */

const HELP_PLACEHOLDERS = {
  synopsis: 'Displays a customer intake form with validation.',
  description: 'Collects customer name, email, and order details, validates required fields, then saves the record to CSV on submit.',
  paramName: 'CustomerId',
  paramText: 'The unique ID of the customer to pre-fill the form for, if editing an existing record.',
  example: 'Opens the form pre-filled for customer 4021.\nPS C:\\> .\\CustomerForm.ps1 -CustomerId 4021',
  author: 'Name',
  get filename() { return (state.form.text.replace(/[^a-zA-Z0-9]/g, '') || 'Form') + '.ps1'; },
  notes: 'Requires PowerShell 5.1+ and the .NET Windows Forms assembly.',
};

// Scans every control's events (buttons, menu items, the form itself) for
// a wired-up "Or .ps1 file" and returns each unique one in the exact
// dot-source notation the generated code actually uses, so .NOTES stays
// truthful about what the script calls out to. We can't see INSIDE those
// files (if a called script calls another script, that's invisible to us)
// so this only reports the direct, one-level call graph from this form.
function collectCalledScripts() {
  const found = new Set();

  function scanEvents(events) {
    if (!events) return;
    Object.values(events).forEach(data => {
      if (data && data.ps1 && data.ps1.trim()) found.add(data.ps1.trim());
    });
  }

  scanEvents(state.form.events);
  state.controls.forEach(c => {
    scanEvents(c.events);
    if (c.type === 'MenuStrip') {
      (c.props.menuItems || []).forEach(m => {
        (m.items || []).forEach(it => {
          // Menu items don't have a separate .ps1 field today (inline code
          // or autoAbout only), but this stays future-proof if that's added.
          if (it.ps1 && it.ps1.trim()) found.add(it.ps1.trim());
        });
      });
    }
  });

  return Array.from(found).sort();
}

function helpCheckboxTextRow(label, item, key, placeholder, multiline, tooltip) {
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
  if (tooltip) labelWrap.title = tooltip;
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

  frag.appendChild(buildUsageHintBlock(
    'This becomes a standard PowerShell comment-based help block at the top of every generated file - the same format Get-Help reads, and what MenuStrip\'s Help > About uses to build its message box. Only checked fields are included. Example .SYNOPSIS: "Displays a customer intake form with validation."'
  ));

  frag.appendChild(helpCheckboxTextRow('.SYNOPSIS', h.synopsis, 'text', HELP_PLACEHOLDERS.synopsis, true,
    'A one-line summary of what this script/form does. This is what Help > About shows if you haven\'t written custom code for it.'));
  frag.appendChild(helpCheckboxTextRow('.DESCRIPTION', h.description, 'text', HELP_PLACEHOLDERS.description, true,
    'A longer explanation of what the script does and why. Also included in the auto-generated Help > About message.'));

  const paramWrap = document.createElement('div');
  paramWrap.className = 'help-list';
  const paramTitle = document.createElement('div');
  paramTitle.className = 'items-hint';
  paramTitle.title = 'One entry per script parameter, e.g. if your .ps1 accepts -CustomerId, document it here.';
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
  notesRow.innerHTML = `<label title="Runtime requirements, e.g. PowerShell version or required assemblies. Any button/event wired to an external .ps1 file is automatically listed below this as a 'Calls:' line - you don't need to add those yourself.">Dependencies</label><textarea placeholder="${HELP_PLACEHOLDERS.notes}">${escapeHtml(h.notes.notes)}</textarea>`;
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
    const depText = h.notes.notes || HELP_PLACEHOLDERS.notes;
    if (depText) lines.push('    Dependencies: ' + depText);
    collectCalledScripts().forEach(ps1 => {
      lines.push(`    Calls: . "${ps1}"`);
    });
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
   Code generation (generateHTML/WinForms/WPF/WinUI and their helpers,
   plus GENERATORS) - moved to codegen.js.
   ========================================================================= */

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
    document.getElementById('aboutControlDataVersion').textContent = typeof CONTROL_DATA_VERSION !== 'undefined' ? CONTROL_DATA_VERSION : 'n/a';
    document.getElementById('aboutCodegenVersion').textContent = typeof CODEGEN_VERSION !== 'undefined' ? CODEGEN_VERSION : 'n/a';
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
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.pickingCallback) { cancelControlPick(); return; }
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });
}

function buildObjectsList() {
  const container = document.getElementById('objectsList');
  container.innerHTML = '';

  function renderLevel(parentId, tabPage, depth) {
    const kids = state.controls
      .filter(c => (c.parentId || null) === (parentId || null) && (c.tabPage || null) === (tabPage || null))
      .sort((a, b) => b.z - a.z); // front-most (highest z) first, since that's what's visually "on top"

    kids.forEach(c => {
      const row = document.createElement('div');
      row.className = 'objects-row' + (c.id === state.selectedId ? ' active' : '');
      row.style.paddingLeft = (10 + depth * 16) + 'px';
      row.innerHTML = `<span class="objects-row-name">${escapeHtml(c.name)}</span><span class="objects-row-type">${c.type}</span>`;
      row.title = state.pickingCallback ? 'Click to pick this control.' : 'Click to select this control.';
      row.addEventListener('click', () => {
        if (state.pickingCallback) {
          const cb = state.pickingCallback;
          cancelControlPick();
          cb(c);
        } else {
          selectControl(c.id);
        }
        document.getElementById('objectsModalOverlay').classList.remove('open');
      });
      container.appendChild(row);

      const def = CONTROL_DEFS[c.type];
      if (def.isTabControl) {
        (c.props.tabs || []).forEach(tab => {
          const tabHeader = document.createElement('div');
          tabHeader.className = 'objects-row objects-tab-header';
          tabHeader.style.paddingLeft = (10 + (depth + 1) * 16) + 'px';
          tabHeader.textContent = `[${tab.label}]`;
          container.appendChild(tabHeader);
          renderLevel(c.id, tab.id, depth + 2);
        });
      } else if (def.isContainer) {
        renderLevel(c.id, null, depth + 1);
      }
    });
  }

  renderLevel(null, null, 0);
  if (!container.children.length) {
    const empty = document.createElement('div');
    empty.className = 'objects-empty';
    empty.textContent = 'No controls on the form yet.';
    container.appendChild(empty);
  }
}

function initObjectsModal() {
  const overlay = document.getElementById('objectsModalOverlay');
  document.getElementById('btnObjects').addEventListener('click', () => {
    buildObjectsList();
    overlay.classList.add('open');
  });
  document.getElementById('objectsModalClose').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
}

function initInfoModal() {
  const overlay = document.getElementById('infoModalOverlay');
  document.getElementById('infoModalClose').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
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
  initObjectsModal();
  initInfoModal();
  initTopToolbar();
  render();
}

document.addEventListener('DOMContentLoaded', initEngine);
