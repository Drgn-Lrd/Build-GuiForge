/*
    Engine.js
    Written by: Johnathon Largent
    Version 1.41

    Revision:

    1. File Versions modal: Last Updated column now tries a live
    Last-Modified HTTP header check (HEAD request) per file when the
    modal opens, via new formatHttpDateForFileVersions() and
    fetchLastModifiedForFileVersions() helpers. Each cell shows its
    hardcoded LAST_UPDATED constant immediately, then gets overwritten
    if/when that file's fetch succeeds - so it degrades gracefully on
    file:// (where fetch to local files fails) or if a host doesn't
    return the header.
*/

const ENGINE_VERSION = '1.41';
const ENGINE_LAST_UPDATED = '29Aug2026 @ 12:00:00';

/* =========================================================================
   Control catalog, toolbox icons/descriptions, MenuStrip/TabControl
   defaults - moved to Control-Data.js (loaded before this file).
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
function getControlByName(name) { return state.controls.find(c => c.name === name); }

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
  if (def.isWizard) {
    // Same design-time-only role as TabControl's activeTabId above, just
    // reusing the field name - which wizard page is currently showing.
    ctrl.activeTabId = (props.pages[0] && props.pages[0].id) || null;
  }

  // Menu/tool/status bars conventionally dock themselves - no reason to
  // make the user manually flip Dock every time. MenuStrip always forces
  // itself to sort before any already-docked Top sibling (real apps
  // always put the menu above the toolbar, whichever was added first);
  // ToolStrip slots in right after a MenuStrip sibling if one exists.
  const sameGroup = (c) => (c.parentId || null) === (ctrl.parentId || null) && (c.tabPage || null) === (ctrl.tabPage || null);
  if (type === 'MenuStrip') {
    ctrl.props.dock = 'Top';
    const topSiblings = state.controls.filter(c => sameGroup(c) && c.props.dock && c.props.dock !== 'None' && c.dockOrder != null);
    ctrl.dockOrder = topSiblings.length ? Math.min(...topSiblings.map(c => c.dockOrder)) - 1 : ++state.dockOrderSeq;
  } else if (type === 'ToolStrip') {
    ctrl.props.dock = 'Top';
    const menuSibling = state.controls.find(c => c.type === 'MenuStrip' && sameGroup(c) && c.dockOrder != null);
    ctrl.dockOrder = menuSibling ? menuSibling.dockOrder + 1 : ++state.dockOrderSeq;
  } else if (type === 'StatusStrip') {
    ctrl.props.dock = 'Bottom';
    ctrl.dockOrder = ++state.dockOrderSeq;
  }

  state.controls.push(ctrl);
  // A CheckBox/RadioButton landing on a Wizard "Options" page defaults to
  // logging itself to the Summary of Tasks (Wizard-Builder.js) - covers
  // both the template's own starter controls and one dropped there later.
  wizardAutoWireOptionsLog(ctrl);
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
    } else if (def.isWizard) {
      // Each page's content docks within the wizard's content area (full
      // bounds, minus the optional Contents nav strip - wizardContentBounds,
      // Wizard-Builder.js); footer children (Back/Next/Cancel and anything
      // else marked "always visible") dock against the FULL bounds instead,
      // since a real installer's footer bar spans under the nav strip too.
      const contentBounds = wizardContentBounds(c);
      (c.props.pages || []).forEach(page => {
        const kids = state.controls.filter(ch => ch.parentId === c.id && ch.tabPage === page.id && !ch.wizardFooter);
        applyDockStack(kids, contentBounds);
      });
      const footerKids = state.controls.filter(ch => ch.parentId === c.id && ch.wizardFooter);
      applyDockStack(footerKids, { w: c.w, h: c.h });
    } else {
      const kids = state.controls.filter(ch => ch.parentId === c.id);
      applyDockStack(kids, { w: c.w, h: c.h });
    }
  });

  cascadeAnchorsOnSizeChange();
}

// Anchor repositioning previously only ran during a manual drag-resize
// (startResize's onMove) - a container resized purely by Dock (e.g. the
// user setting a Wizard's own Dock to Fill) never triggered it, so
// Anchored children (like a wizard's footer buttons) stayed stuck at
// their original pixel position instead of tracking the new bounds. This
// compares each container's size against what it was last render pass and,
// if it changed, cascades Anchor the same way a manual resize would.
const containerLastSize = {};
function cascadeAnchorsOnSizeChange() {
  state.controls.forEach(c => {
    const prev = containerLastSize[c.id];
    if (prev && (prev.w !== c.w || prev.h !== c.h)) {
      state.controls.filter(ch => ch.parentId === c.id).forEach(child => {
        applyAnchorFromOrigin(child, { x: child.x, y: child.y, w: child.w, h: child.h }, prev.w, prev.h, c.w, c.h);
      });
    }
    containerLastSize[c.id] = { w: c.w, h: c.h };
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
    let h = p.h, w = p.w;
    if (CONTROL_DEFS[p.type].isTabControl) h = Math.max(1, h - TAB_HEADER_HEIGHT);
    else if (CONTROL_DEFS[p.type].isWizard && tabPage) {
      // Only page content (a real tabPage id, not a footer child's null)
      // is shrunk for the Contents nav strip - a footer button still gets
      // the full bounds, same as recomputeAllDocking treats it.
      const cb = wizardContentBounds(p);
      w = cb.w; h = cb.h;
    }
    bounds = { w, h };
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

/* =========================================================================
   renderControl / renderInner and the format-skin CSS-class rendering
   logic (buildTabHeaderStrip, fontStyleFor, borderStyleFor, the
   DateTimePicker .NET-format renderer, renderMenuStripPreview) - moved
   to Render.js (loaded before this file). escapeHtml stays here since
   it's a shared utility used by Render.js, Properties-Pane.js, and the
   objects list below.
   ========================================================================= */

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
  document.getElementById('statusVersion').textContent = `engine v${ENGINE_VERSION}`;
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
  if (e.key === 'ArrowUp') ctrl.y = ctrl.y - step;
  else if (e.key === 'ArrowDown') ctrl.y = ctrl.y + step;
  else if (e.key === 'ArrowLeft') ctrl.x = ctrl.x - step;
  else if (e.key === 'ArrowRight') ctrl.x = ctrl.x + step;
  else if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  else moved = false;
  if (moved) { e.preventDefault(); render(); }
});

function nudge(dir) {
  const ctrl = getControl(state.selectedId);
  if (!ctrl) return;
  const step = state.nudgeStep;
  if (dir === 'up') ctrl.y = ctrl.y - step;
  if (dir === 'down') ctrl.y = ctrl.y + step;
  if (dir === 'left') ctrl.x = ctrl.x - step;
  if (dir === 'right') ctrl.x = ctrl.x + step;
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
        // For a TabControl or Wizard, coordinates are relative to the
        // content area (below the header strip, if any), not the whole
        // control, and the new child belongs to whichever page is active.
        const contentEl = hostEl.querySelector(':scope > .tabcontrol-content, :scope > .wizard-content');
        const refEl = contentEl || hostEl;
        const refRect = refEl.getBoundingClientRect();
        x = e.clientX - refRect.left;
        y = e.clientY - refRect.top;
        if (CONTROL_DEFS[hostCtrl.type].isTabControl || CONTROL_DEFS[hostCtrl.type].isWizard) tabPage = hostCtrl.activeTabId;
      }
    }
    const c = createControl(type, x, y, parentId, tabPage);
    selectControl(c.id);
  });
}

/* =========================================================================
   Properties pane (renderProps, every buildXRow/buildXSection builder,
   the events/snippets editor, MenuStrip/TabControl editors, the
   comment-based help block builder and its generator functions) -
   moved to Properties-Pane.js (loaded before this file).
   ========================================================================= */

/* =========================================================================
   Code generation (generateHTML/WinForms/WPF/WinUI and their helpers,
   plus GENERATORS) - moved to CodeGen.js/CodeGen-HTML.js/
   CodeGen-WinForms.js/CodeGen-WPF.js/CodeGen-WinUI.js.
   ========================================================================= */

/* =========================================================================
   Wiring: toolbar, modals
   ========================================================================= */

// Single source of truth for each output format's implementation status -
// used both for the toolbar language buttons' tooltips and the Show Code
// modal's scaffold note, so the wording can't drift out of sync between
// the two places it's shown.
const FORMAT_STATUS = {
  winforms: { level: 'done', tooltip: 'Fully implemented and tested.' },
  html: { level: 'done', tooltip: 'Fully implemented and tested.' },
  wpf: { level: 'done', tooltip: 'Fully implemented and tested.' },
  winui: {
    level: 'stub',
    tooltip: 'Not implemented yet: generates a page shell with a TODO list of your controls for manual porting.',
  },
};

function initFormatSwitch() {
  document.querySelectorAll('.format-switch button').forEach(btn => {
    const status = FORMAT_STATUS[btn.dataset.format];
    if (status) btn.title = status.tooltip;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.format-switch button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFormat = btn.dataset.format;
      render();
    });
  });
}

// UI chrome theme (Standard/Dark/Light) - separate from state.currentFormat,
// which controls the WinForms/HTML/WPF/WinUI PREVIEW skin inside the design
// canvas. This only affects the app's own toolbar/toolbox/properties-pane/
// status-bar colors and persists across sessions via localStorage.
const THEME_STORAGE_KEY = 'guiDesignerTheme';
const DEFAULT_THEME = 'dark';

function applyTheme(theme) {
  if (theme === 'standard') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.dataset.theme = theme;
  }
  document.querySelectorAll('.theme-switch button').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { /* storage unavailable - theme just won't persist */ }
}

function initThemeSwitch() {
  document.querySelectorAll('.theme-switch button').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
  let saved = DEFAULT_THEME;
  try { saved = localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME; } catch (e) { /* storage unavailable - use default */ }
  applyTheme(saved);
}

function initShowCodeModal() {
  const overlay = document.getElementById('codeModalOverlay');
  document.getElementById('btnShowCode').addEventListener('click', () => {
    overlay.classList.add('open');
    switchCodeTab(state.currentFormat);
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

  document.getElementById('btnCopyXaml').addEventListener('click', async () => {
    const text = document.getElementById('xamlOutput').textContent;
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('btnCopyXaml');
      const orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    } catch (err) { /* clipboard may be unavailable in this context */ }
  });

  document.querySelectorAll('#wpfFileModeSwitch button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#wpfFileModeSwitch button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setWpfFileMode(btn.dataset.mode);
      switchCodeTab('wpf');
    });
  });

  const xamlInput = document.getElementById('wpfXamlFilenameInput');
  const xamlError = document.getElementById('wpfXamlFilenameError');
  xamlInput.addEventListener('input', () => {
    const val = xamlInput.value.trim();
    const bad = val && !isValidWpfXamlPath(val);
    xamlInput.classList.toggle('input-error', bad);
    xamlError.textContent = bad ? 'Use a filename or relative path ending in .xaml, e.g. ui.xaml or ./sub/ui.xaml' : '';
  });
  xamlInput.addEventListener('change', () => {
    const result = setWpfXamlFileName(xamlInput.value);
    xamlInput.classList.toggle('input-error', !result.ok);
    xamlError.textContent = result.ok ? '' : result.error;
    if (result.ok) xamlInput.value = result.value;
    switchCodeTab('wpf');
  });
  xamlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') xamlInput.blur(); });
}

function switchCodeTab(tab) {
  document.querySelectorAll('.code-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const note = document.getElementById('scaffoldNote');
  const status = FORMAT_STATUS[tab];
  const scaffolded = status && status.level !== 'done';
  note.style.display = scaffolded ? 'block' : 'none';
  note.textContent = scaffolded ? status.tooltip : '';

  const isWpf = tab === 'wpf';
  const dualMode = isWpf && getWpfFileMode() === 'dual';
  document.getElementById('wpfFileControls').style.display = isWpf ? 'flex' : 'none';
  document.getElementById('wpfXamlFilenameRow').style.display = dualMode ? 'flex' : 'none';
  document.getElementById('codeOutputPrimaryLabel').style.display = isWpf ? 'block' : 'none';
  document.getElementById('codeOutputPrimaryLabel').textContent = dualMode ? 'PowerShell (.ps1)' : 'PowerShell (.ps1, embedded XAML)';
  document.getElementById('xamlOutputLabel').style.display = dualMode ? 'block' : 'none';
  document.getElementById('xamlOutput').style.display = dualMode ? 'block' : 'none';
  document.getElementById('btnCopyXaml').style.display = dualMode ? 'inline-block' : 'none';

  if (dualMode) {
    document.getElementById('wpfXamlFilenameInput').value = currentWpfXamlFileName();
    document.getElementById('xamlOutput').textContent = generateWPFXaml();
  }

  document.getElementById('codeOutput').textContent = GENERATORS[tab]();
}

// Formats a Last-Modified HTTP-date header into the project's
// "DDMonYYYY @ HH:MM:SS" display style (local time).
function formatHttpDateForFileVersions(httpDateStr) {
  const d = new Date(httpDateStr);
  if (isNaN(d.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(d.getDate())}${months[d.getMonth()]}${d.getFullYear()} @ ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Attempts to read the server's Last-Modified header for a file via a
// HEAD request (works when served over HTTP, e.g. GitHub Pages; fails
// silently on file:// or if the header is missing/blocked, in which
// case the caller's hardcoded LAST_UPDATED fallback stays on screen).
async function fetchLastModifiedForFileVersions(fileName) {
  try {
    const res = await fetch(fileName, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return null;
    const lastModified = res.headers.get('Last-Modified');
    if (!lastModified) return null;
    return formatHttpDateForFileVersions(lastModified);
  } catch (err) {
    return null;
  }
}

function initAboutModal() {
  const overlay = document.getElementById('aboutModalOverlay');

  // [file name, version cell id, last-updated cell id, version value, last-updated value]
  function fileVersionsRows() {
    const stylesheetVersion = getComputedStyle(document.documentElement).getPropertyValue('--stylesheet-version').trim().replace(/'/g, '') || 'n/a';
    const stylesheetLastUpdated = getComputedStyle(document.documentElement).getPropertyValue('--stylesheet-last-updated').trim().replace(/'/g, '') || 'n/a';
    return [
      ['CodeGen-HTML.js', 'aboutCodegenHtmlVersion', 'aboutCodegenHtmlLastUpdated', typeof CODEGEN_HTML_VERSION !== 'undefined' ? CODEGEN_HTML_VERSION : 'n/a', typeof CODEGEN_HTML_LAST_UPDATED !== 'undefined' ? CODEGEN_HTML_LAST_UPDATED : 'n/a'],
      ['CodeGen-WinForms.js', 'aboutCodegenWinFormsVersion', 'aboutCodegenWinFormsLastUpdated', typeof CODEGEN_WINFORMS_VERSION !== 'undefined' ? CODEGEN_WINFORMS_VERSION : 'n/a', typeof CODEGEN_WINFORMS_LAST_UPDATED !== 'undefined' ? CODEGEN_WINFORMS_LAST_UPDATED : 'n/a'],
      ['CodeGen-WinUI.js', 'aboutCodegenWinUiVersion', 'aboutCodegenWinUiLastUpdated', typeof CODEGEN_WINUI_VERSION !== 'undefined' ? CODEGEN_WINUI_VERSION : 'n/a', typeof CODEGEN_WINUI_LAST_UPDATED !== 'undefined' ? CODEGEN_WINUI_LAST_UPDATED : 'n/a'],
      ['CodeGen-WPF.js', 'aboutCodegenWpfVersion', 'aboutCodegenWpfLastUpdated', typeof CODEGEN_WPF_VERSION !== 'undefined' ? CODEGEN_WPF_VERSION : 'n/a', typeof CODEGEN_WPF_LAST_UPDATED !== 'undefined' ? CODEGEN_WPF_LAST_UPDATED : 'n/a'],
      ['CodeGen.js', 'aboutCodegenVersion', 'aboutCodegenLastUpdated', typeof CODEGEN_VERSION !== 'undefined' ? CODEGEN_VERSION : 'n/a', typeof CODEGEN_LAST_UPDATED !== 'undefined' ? CODEGEN_LAST_UPDATED : 'n/a'],
      ['Control-Copy.js', 'aboutControlCopyVersion', 'aboutControlCopyLastUpdated', typeof CONTROL_COPY_VERSION !== 'undefined' ? CONTROL_COPY_VERSION : 'n/a', typeof CONTROL_COPY_LAST_UPDATED !== 'undefined' ? CONTROL_COPY_LAST_UPDATED : 'n/a'],
      ['Control-Data.js', 'aboutControlDataVersion', 'aboutControlDataLastUpdated', typeof CONTROL_DATA_VERSION !== 'undefined' ? CONTROL_DATA_VERSION : 'n/a', typeof CONTROL_DATA_LAST_UPDATED !== 'undefined' ? CONTROL_DATA_LAST_UPDATED : 'n/a'],
      ['Engine.js', 'aboutEngineVersion', 'aboutEngineLastUpdated', ENGINE_VERSION, typeof ENGINE_LAST_UPDATED !== 'undefined' ? ENGINE_LAST_UPDATED : 'n/a'],
      ['Properties-Pane.js', 'aboutPropsPaneVersion', 'aboutPropsPaneLastUpdated', typeof PROPERTIES_PANE_VERSION !== 'undefined' ? PROPERTIES_PANE_VERSION : 'n/a', typeof PROPERTIES_PANE_LAST_UPDATED !== 'undefined' ? PROPERTIES_PANE_LAST_UPDATED : 'n/a'],
      ['Render.js', 'aboutRenderVersion', 'aboutRenderLastUpdated', typeof RENDER_VERSION !== 'undefined' ? RENDER_VERSION : 'n/a', typeof RENDER_LAST_UPDATED !== 'undefined' ? RENDER_LAST_UPDATED : 'n/a'],
      ['Styles.css', 'aboutStyleVersion', 'aboutStyleLastUpdated', stylesheetVersion, stylesheetLastUpdated],
      ['Wizard-Boolean-Builder.js', 'aboutWizardBooleanBuilderVersion', 'aboutWizardBooleanBuilderLastUpdated', typeof WIZARD_BOOLEAN_BUILDER_VERSION !== 'undefined' ? WIZARD_BOOLEAN_BUILDER_VERSION : 'n/a', typeof WIZARD_BOOLEAN_BUILDER_LAST_UPDATED !== 'undefined' ? WIZARD_BOOLEAN_BUILDER_LAST_UPDATED : 'n/a'],
      ['Wizard-Builder.js', 'aboutWizardBuilderVersion', 'aboutWizardBuilderLastUpdated', typeof WIZARD_BUILDER_VERSION !== 'undefined' ? WIZARD_BUILDER_VERSION : 'n/a', typeof WIZARD_BUILDER_LAST_UPDATED !== 'undefined' ? WIZARD_BUILDER_LAST_UPDATED : 'n/a'],
      ['index.html', 'aboutPageVersion', 'aboutPageLastUpdated', window.PAGE_VERSION || 'n/a', window.PAGE_LAST_UPDATED || 'n/a']
    ];
  }

  document.getElementById('btnAbout').addEventListener('click', () => {
    const rows = fileVersionsRows();
    rows.forEach(([fileName, verId, updId, verVal, fallbackUpdVal]) => {
      document.getElementById(verId).textContent = verVal;
      document.getElementById(updId).textContent = fallbackUpdVal;
      fetchLastModifiedForFileVersions(fileName).then((headerVal) => {
        if (headerVal) document.getElementById(updId).textContent = headerVal;
      });
    });
    overlay.classList.add('open');
  });
  document.getElementById('aboutModalClose').addEventListener('click', () => overlay.classList.remove('open'));
  document.getElementById('aboutModalClose2').addEventListener('click', () => overlay.classList.remove('open'));

  document.getElementById('aboutCopyVersions').addEventListener('click', async () => {
    const rows = fileVersionsRows();
    const nameWidth = Math.max(...rows.map(([name]) => name.length));
    const plainBody = rows.map(([name, verId]) => `${name.padEnd(nameWidth)}\t${document.getElementById(verId).textContent}`).join('\n');
    const fencedPlain = '```\n' + plainBody + '\n```';
    const htmlBody = `<pre><code>${escapeHtml(plainBody)}</code></pre>`;

    const btn = document.getElementById('aboutCopyVersions');
    const orig = btn.textContent;
    const showCopied = () => {
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    };

    if (window.ClipboardItem) {
      try {
        const item = new ClipboardItem({
          'text/plain': new Blob([fencedPlain], { type: 'text/plain' }),
          'text/html': new Blob([htmlBody], { type: 'text/html' })
        });
        await navigator.clipboard.write([item]);
        showCopied();
        return;
      } catch (err) { /* fall through to plain-text clipboard write */ }
    }

    try {
      await navigator.clipboard.writeText(fencedPlain);
      showCopied();
      return;
    } catch (err) { /* fall through to execCommand fallback */ }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = fencedPlain;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showCopied();
    } catch (err) { /* clipboard unavailable in this context */ }
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
}

function initTopToolbar() {
  document.getElementById('btnDelete').addEventListener('click', deleteSelected);
  document.getElementById('btnCopy').addEventListener('click', startCopySelected);
  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (state.controls.length && !confirm('Remove all controls from the form?')) return;
    state.controls = [];
    state.selectedId = null;
    render();
  });
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
  document.getElementById('btnWizards').addEventListener('click', openWizardPickerModal);

  document.addEventListener('click', () => {
    document.querySelectorAll('.icon-picker-popover.open').forEach(p => p.classList.remove('open'));
  });

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

  // Root "Main Panel" (the Form itself) - was previously unreachable here
  // once child controls fully covered it (e.g. Dock=Fill left no empty
  // canvas to click), since there was no way to re-select the form to
  // get back to its properties. Selecting it mirrors clicking empty
  // canvas: selectedId becomes null and the props pane shows Form props.
  // Not offered as a "Select Control" pick-mode target (e.g. wiring
  // another control's property) since the Form isn't a valid target for
  // that flow - it's only here so the form can always be re-selected.
  if (!state.pickingCallback) {
    const formRow = document.createElement('div');
    formRow.className = 'objects-row' + (state.selectedId === null ? ' active' : '');
    formRow.style.paddingLeft = '10px';
    formRow.innerHTML = `<span class="objects-row-name">Main Panel</span><span class="objects-row-type">Form</span>`;
    formRow.title = 'Click to select the form.';
    formRow.addEventListener('click', () => {
      selectControl(null);
      document.getElementById('objectsModalOverlay').classList.remove('open');
    });
    container.appendChild(formRow);
  }

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
        // Selecting a control that lives on a specific TabControl/Wizard
        // page also switches the canvas to that page - so, e.g., picking
        // "CheckBox1" (which only exists on the Options page) from here
        // shows Options, the same as clicking its "[Options]" header does.
        if (c.tabPage && c.parentId) {
          const parent = getControl(c.parentId);
          if (parent && (CONTROL_DEFS[parent.type].isTabControl || CONTROL_DEFS[parent.type].isWizard)) {
            parent.activeTabId = c.tabPage;
          }
        }
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
          tabHeader.title = 'Click to switch the canvas to this tab.';
          tabHeader.addEventListener('click', (ev) => {
            ev.stopPropagation();
            c.activeTabId = tab.id;
            render();
            document.getElementById('objectsModalOverlay').classList.remove('open');
          });
          container.appendChild(tabHeader);
          renderLevel(c.id, tab.id, depth + 2);
        });
      } else if (def.isWizard) {
        (c.props.pages || []).forEach(page => {
          const pageHeader = document.createElement('div');
          pageHeader.className = 'objects-row objects-tab-header';
          pageHeader.style.paddingLeft = (10 + (depth + 1) * 16) + 'px';
          pageHeader.textContent = `[${page.label}]`;
          pageHeader.title = 'Click to switch the canvas to this page.';
          pageHeader.addEventListener('click', (ev) => {
            ev.stopPropagation();
            c.activeTabId = page.id;
            render();
            document.getElementById('objectsModalOverlay').classList.remove('open');
          });
          container.appendChild(pageHeader);
          renderLevel(c.id, page.id, depth + 2);
        });
        const footerHeader = document.createElement('div');
        footerHeader.className = 'objects-row objects-tab-header';
        footerHeader.style.paddingLeft = (10 + (depth + 1) * 16) + 'px';
        footerHeader.textContent = '[Footer]';
        container.appendChild(footerHeader);
        renderLevel(c.id, null, depth + 2);
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
    // Copy's scoped tab/page picker (Control-Copy.js) borrows this same
    // modal shell and retitles it - reset it back here so a leftover
    // "Copy from ..." title never lingers into the real Objects list.
    const titleEl = document.getElementById('objectsModalTitle');
    if (titleEl) titleEl.textContent = 'Objects';
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
  initThemeSwitch();
  initShowCodeModal();
  initAboutModal();
  initObjectsModal();
  initInfoModal();
  initTopToolbar();
  render();
}

document.addEventListener('DOMContentLoaded', initEngine);
