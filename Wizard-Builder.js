/*
    Wizard-Builder.js
    Written by: Johnathon Largent
    Version 1.30

    Revision:

    1. wizardAutoWireOptionsLog now covers every control type that
    reasonably has a default log line, not just CheckBox/RadioButton:
    ComboBox/ListBox (selected option), TextBox/MaskedTextBox/RichTextBox
    (entered text), NumericUpDown/DateTimePicker (the value itself), and
    CheckedListBox (its currently-checked items joined into one line,
    manually adjusting for ItemCheck's pre-change timing). Buttons are
    deliberately left alone - an action, not a value, so there's nothing
    sensible to default. Split into wizardAutoWireCheckboxLog/
    wizardAutoWireValueLog/wizardAutoWireCheckedListBoxLog so each type's
    handling stays readable on its own.
*/

const WIZARD_BUILDER_VERSION = '1.30';

const WIZARD_HORIZONTAL_CONTENTS_HEIGHT = 32;
const WIZARD_VERTICAL_CONTENTS_WIDTH = 140;
const WIZARD_FOOTER_HEIGHT = 45;

// The area available to a wizard's PAGE content (not its always-visible
// footer, which always spans the full control) - shrunk to make room for
// the optional Horizontal/Vertical Contents nav strip, same idea as
// TAB_HEADER_HEIGHT for TabControl.
function wizardContentBounds(c) {
  const cs = c.props.contentsStyle;
  let w = c.w, h = c.h;
  if (cs === 'Horizontal' || cs === 'Horizontal Flat') h = Math.max(1, h - WIZARD_HORIZONTAL_CONTENTS_HEIGHT);
  else if (cs === 'Vertical' || cs === 'Vertical Flat') w = Math.max(1, w - WIZARD_VERTICAL_CONTENTS_WIDTH);
  return { w, h };
}

/* =========================================================================
   Starter page templates
   ========================================================================= */

// Each template is a list of lightweight control specs auto-created as
// children of a new wizard page. Kept small on purpose - these are just a
// running start, not a finished dialog.
// Shared default format for every template's top-of-page title label -
// y:35 is the one "highest label point" every template lines up to, and
// fontSize/fontBold keep them all looking the same regardless of which
// template placed them.
const WIZARD_TITLE_LABEL_Y = 35;
const WIZARD_TITLE_LABEL_PROPS = { fontSize: 14, fontBold: true };

const WIZARD_TEMPLATES = {
  blank: [
    { type: 'Label', name: 'PageTitle', x: 20, y: WIZARD_TITLE_LABEL_Y, w: 380, h: 26, props: { text: 'Enter Page title here', ...WIZARD_TITLE_LABEL_PROPS } },
  ],
  welcome: [
    { type: 'Label', name: 'WelcomeTitle', x: 20, y: WIZARD_TITLE_LABEL_Y, w: 380, h: 26, props: { text: 'Welcome to Setup', ...WIZARD_TITLE_LABEL_PROPS } },
    // centerX/centerY: resolved in populateWizardPageTemplate against the
    // page's actual usable area (content width, and height above the
    // footer), so this fixed-size box stays truly centered - both axes,
    // not just horizontal - even if the wizard gets resized or gains a
    // Contents nav strip.
    { type: 'Label', name: 'WelcomeBody', x: 20, y: 69, w: 350, h: 80, centerX: true, centerY: true, props: { text: 'This wizard will guide you through the setup process. Click Next to continue.', textAlign: 'MiddleCenter' } },
  ],
  options: [
    { type: 'Label', name: 'OptionsTitle', x: 20, y: WIZARD_TITLE_LABEL_Y, w: 380, h: 26, props: { text: 'Choose options', ...WIZARD_TITLE_LABEL_PROPS } },
    { type: 'CheckBox', name: 'OptionA', x: 20, y: 70, w: 195, h: 25, props: { text: 'Option A' } },
    { type: 'CheckBox', name: 'OptionB', x: 20, y: 100, w: 195, h: 25, props: { text: 'Option B' } },
  ],
  summary: [
    // Text stays button-agnostic on purpose - whether Next reads "Run" or
    // "Finish" at this page depends on whether a summaryAfter page follows
    // it (see wizardShowFunctionLines), so the label can't safely name one.
    { type: 'Label', name: 'SummaryTitle', x: 20, y: WIZARD_TITLE_LABEL_Y, w: 380, h: 26, props: { text: 'Review your choices before continuing.', ...WIZARD_TITLE_LABEL_PROPS } },
    // ReadOnly: this box is meant to be filled by "Add to Summary of Tasks
    // log" event actions on earlier-page controls, not typed into directly.
    { type: 'RichTextBox', name: 'SummaryLog', x: 20, y: 69, w: 380, h: 140, props: { text: '', readOnly: true } },
  ],
  // Unwired placeholder for now (per John: template it now, wire up actual
  // PowerShell log capture / success-failure flags later) - same shape as
  // summary, a read-only box meant to eventually show what the Run step
  // actually did.
  summaryAfter: [
    { type: 'Label', name: 'SummaryAfterTitle', x: 20, y: WIZARD_TITLE_LABEL_Y, w: 380, h: 26, props: { text: 'Here is what was done:', ...WIZARD_TITLE_LABEL_PROPS } },
    { type: 'RichTextBox', name: 'SummaryAfterLog', x: 20, y: 69, w: 380, h: 140, props: { text: '', readOnly: true } },
  ],
};

const WIZARD_TEMPLATE_LABELS = { blank: 'Blank', welcome: 'Welcome', options: 'Options', summary: 'Summary of Tasks', summaryAfter: 'Summary of Actions Taken' };

// Short default PAGE TAB TITLE per template - deliberately separate from
// WIZARD_TEMPLATE_LABELS above (which names the template in the picker
// dropdown): summaryAfter's picker entry stays the descriptive "Summary of
// Actions Taken", but a page actually built from it defaults to the much
// shorter "Final" as its own tab title. Used by wizardDefaultLabelForTemplate.
const WIZARD_TEMPLATE_DEFAULT_LABEL = { blank: 'Page', welcome: 'Welcome', options: 'Options', summary: 'Summary', summaryAfter: 'Final' };

// Shared numbering helper: returns `base` if it's not taken, otherwise
// base+2, base+3, ... (never base+1 - the first, unsuffixed instance IS
// "1"). One algorithm reused for both default control names (a template
// applied twice on one page) and default page tab titles (a second page
// using the same template) - see wizardUniqueControlName and
// wizardDefaultLabelForTemplate below.
function wizardNextAvailableDefault(base, isTaken) {
  if (!isTaken(base)) return base;
  let n = 2;
  while (isTaken(base + n)) n++;
  return base + n;
}

// A template's starter control default name (e.g. "OptionA"), collision-
// avoided against every control in the whole project (names are global,
// not just per-page) - covers both the same template being applied twice
// to one page, and the same template appearing on two different pages.
function wizardUniqueControlName(base) {
  return wizardNextAvailableDefault(base, (name) => !!getControlByName(name));
}

// A new page's default tab title for a given template, collision-avoided
// against `existingLabels` (the other pages' current labels) - "Options"
// the first time, "Options2" the second, etc.
function wizardDefaultLabelForTemplate(template, existingLabels) {
  const base = WIZARD_TEMPLATE_DEFAULT_LABEL[template] || 'Page';
  return wizardNextAvailableDefault(base, (label) => existingLabels.includes(label));
}

// True if `label` still looks like an untouched default (any template's
// default base, or "Page", each with an optional trailing number) rather
// than something the person typed themselves - used to decide whether
// switching a page's Template dropdown is allowed to relabel it too.
function wizardLooksLikeDefaultLabel(label) {
  const bases = Object.values(WIZARD_TEMPLATE_DEFAULT_LABEL).concat(['Page']);
  return bases.some(base => new RegExp('^' + base + '\\d*$').test(label));
}

// The Setup modal's default page list - Welcome, Options, Summary, Final -
// built through wizardDefaultLabelForTemplate so it stays in sync with
// WIZARD_TEMPLATE_DEFAULT_LABEL rather than hardcoding labels twice.
function wizardBuildDefaultSetupPages() {
  const pages = [];
  ['welcome', 'options', 'summary', 'summaryAfter'].forEach(template => {
    const label = wizardDefaultLabelForTemplate(template, pages.map(p => p.label));
    pages.push({ label, template });
  });
  return pages;
}

function populateWizardPageTemplate(wizardCtrl, page) {
  const specs = WIZARD_TEMPLATES[page.template] || [];
  const bounds = wizardContentBounds(wizardCtrl);
  // The footer (Back/Next/Cancel) always occupies the bottom
  // WIZARD_FOOTER_HEIGHT px regardless of page, but wizardContentBounds
  // doesn't account for it (it only shrinks for the Contents nav strip) -
  // centerY needs the REAL usable vertical space above the footer, or a
  // "centered" box would actually land too low, drifting toward/under it.
  const usableH = Math.max(1, bounds.h - WIZARD_FOOTER_HEIGHT);
  specs.forEach(spec => {
    // centerX/centerY: the spec keeps a fixed size, and its position is
    // recomputed here so the box sits centered within the page's actual
    // usable area - NOT stretched to fill it (that made Label2 look
    // almost full-page-width by default, which wasn't the goal).
    const x = spec.centerX ? Math.round((bounds.w - spec.w) / 2) : spec.x;
    const y = spec.centerY ? Math.round((usableH - spec.h) / 2) : spec.y;
    const child = createControl(spec.type, x, y, wizardCtrl.id, page.id);
    child.w = spec.w;
    child.h = spec.h;
    if (spec.name) child.name = wizardUniqueControlName(spec.name);
    Object.entries(spec.props || {}).forEach(([k, v]) => { child.props[k] = v; });
  });
}

/* =========================================================================
   Footer buttons (Back / Next / Cancel) - real Button controls, always
   visible regardless of which page is active (wizardFooter = true), tagged
   with wizardRole so codegen can auto-generate their navigation code.
   ========================================================================= */

function createWizardFooterButtons(wizardCtrl) {
  // Centered in the 45px footer strip: 10px above, 25px button, 10px
  // below (10 + 25 + 10 = 45).
  const y = wizardCtrl.h - WIZARD_FOOTER_HEIGHT + 10;
  const btnW = 80;
  // Back sits left-of-center, Next dead center, Cancel at the right edge -
  // each anchored so it tracks proportionally as the wizard resizes
  // (Bottom keeps it near the bottom edge; Left/Right - see
  // applyAnchorFromOrigin in Engine.js - scale the margin as a percentage
  // of width/height rather than a fixed pixel offset, which is what lets
  // Back/Next drift back toward their original relative position instead
  // of a fixed absolute one).
  const specs = [
    { role: 'back', text: 'Back', x: Math.round(wizardCtrl.w * 0.30 - btnW / 2), anchor: 'Bottom, Left' },
    { role: 'next', text: 'Next', x: Math.round(wizardCtrl.w * 0.5 - btnW / 2), anchor: 'Bottom, Left' },
    { role: 'cancel', text: 'Cancel', x: wizardCtrl.w - 20 - btnW, anchor: 'Bottom, Right' },
  ];
  specs.forEach(spec => {
    const btn = createControl('Button', spec.x, y, wizardCtrl.id, null);
    btn.name = wizardUniqueControlName(spec.text);
    btn.w = btnW;
    btn.props.text = spec.text;
    btn.props.anchor = spec.anchor;
    btn.wizardFooter = true;
    btn.wizardRole = spec.role;
    btn.events.Click = { fn: `${btn.name}_Click`, code: '# Auto-generated wizard navigation (see generated code) - clear Wizard Role above to write your own.', ps1: '' };
  });
}

// Adds a plain (no wizardRole) footer Button, lined up to the left of
// whatever's currently the leftmost footer button - fixes the earlier
// complaint that manually flipping a button's "Show on all pages" switch
// on left it wherever it happened to already be sitting, not aligned
// with Back/Next/Cancel at all. Same height/anchor/footer-y convention
// as createWizardFooterButtons above.
function addWizardFooterButton(wizardCtrl) {
  const existing = state.controls.filter(c => c.parentId === wizardCtrl.id && c.wizardFooter && c.type === 'Button');
  const btnW = 80;
  const y = wizardCtrl.h - WIZARD_FOOTER_HEIGHT + 10; // centered, same as createWizardFooterButtons
  const leftmostX = existing.length ? Math.min(...existing.map(c => c.x)) : (wizardCtrl.w - 20 - btnW);
  const x = Math.max(10, leftmostX - btnW - 10);
  const btn = createControl('Button', x, y, wizardCtrl.id, null);
  btn.name = wizardUniqueControlName('Button');
  btn.w = btnW;
  btn.props.text = btn.name;
  btn.props.anchor = 'Bottom, Left';
  btn.wizardFooter = true;
  return btn;
}

/* =========================================================================
   Footer Options editor (Wizard-specific section) - the footer button
   list (Add/Remove) plus the scripted extras (border, step counter).
   ========================================================================= */

function buildWizardFooterOptionsEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'tab-editor';

  const heading = document.createElement('div');
  heading.className = 'tab-editor-heading';
  heading.title = tt(key);
  heading.textContent = label;
  wrap.appendChild(heading);

  const footerBtns = state.controls
    .filter(c => c.parentId === ctrl.id && c.wizardFooter && c.type === 'Button')
    .sort((a, b) => a.x - b.x);
  footerBtns.forEach(btn => wrap.appendChild(buildWizardFooterButtonItem(ctrl, btn)));

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost tab-add-btn';
  addBtn.textContent = '+ Add footer button';
  addBtn.title = 'Adds a new Button that shows on every page, lined up next to the current footer buttons.';
  addBtn.addEventListener('click', () => {
    const btn = addWizardFooterButton(ctrl);
    selectControl(btn.id);
    render();
  });
  wrap.appendChild(addBtn);

  const opts = ctrl.props[key] || (ctrl.props[key] = { border: false, stepCounter: false });

  const borderRow = document.createElement('div');
  borderRow.className = 'toggle-row';
  borderRow.title = 'Draws a thin line above the footer strip, separating it from the page content.';
  borderRow.innerHTML = `<span class="toggle-label">Footer Border</span><label class="switch"><input type="checkbox" ${opts.border ? 'checked' : ''}><span class="track"></span></label>`;
  borderRow.querySelector('input').addEventListener('change', (e) => { opts.border = e.target.checked; render(); });
  wrap.appendChild(borderRow);

  const stepRow = document.createElement('div');
  stepRow.className = 'toggle-row';
  stepRow.title = 'Adds a "Step X of N" label to the footer that updates automatically as the active page changes.';
  stepRow.innerHTML = `<span class="toggle-label">Step Counter</span><label class="switch"><input type="checkbox" ${opts.stepCounter ? 'checked' : ''}><span class="track"></span></label>`;
  stepRow.querySelector('input').addEventListener('change', (e) => { opts.stepCounter = e.target.checked; render(); });
  wrap.appendChild(stepRow);

  return wrap;
}

function buildWizardFooterButtonItem(ctrl, btn) {
  const outer = document.createElement('div');
  outer.className = 'tab-editor-item' + (btn.id === state.selectedId ? ' active' : '');

  const topRow = document.createElement('div');
  topRow.className = 'wizard-page-editor-toprow';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'menu-editor-label-input';
  nameInput.value = btn.props.text;
  nameInput.disabled = !!btn.wizardRole; // role buttons manage their own preview text (Run/Finish) elsewhere
  nameInput.addEventListener('change', (e) => { btn.props.text = e.target.value.trim() || btn.props.text; render(); });

  const selectBtn = document.createElement('button');
  selectBtn.type = 'button';
  selectBtn.className = 'btn btn-ghost tab-select-btn';
  selectBtn.textContent = btn.id === state.selectedId ? 'Selected' : 'Select';
  selectBtn.title = 'Select this button to edit its full properties/events.';
  selectBtn.addEventListener('click', () => { selectControl(btn.id); render(); });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.disabled = !!btn.wizardRole;
  delBtn.title = btn.wizardRole
    ? 'Clear its Wizard Role first (select it, then set Wizard Role back to None) before removing it.'
    : 'Remove this footer button.';
  delBtn.addEventListener('click', () => {
    if (btn.wizardRole) return;
    state.controls = state.controls.filter(c => c.id !== btn.id);
    if (state.selectedId === btn.id) state.selectedId = null;
    render();
  });

  topRow.appendChild(nameInput);
  topRow.appendChild(selectBtn);
  topRow.appendChild(delBtn);
  outer.appendChild(topRow);
  return outer;
}

/* =========================================================================
   Create a Wizard control from the setup modal's chosen page list
   ========================================================================= */

// Friendly, stable page ids (PageWelcome, PageOptions, Page4, ...) instead
// of a random suffix - these show up directly in generated variable names
// (e.g. $Wizard1_PageOptions), so they need to actually mean something.
// Generated once at creation and never touched by a later rename, same as
// TabControl's tab.id.
function wizardGeneratePageId(label, existingIds) {
  let sanitized = String(label || '').replace(/[^a-zA-Z0-9]/g, '');
  sanitized = sanitized.replace(/^page/i, ''); // avoid a doubled "Page" prefix when the label itself already starts with one (e.g. the default "Page4")
  let base = 'Page' + sanitized;
  if (base === 'Page') base = 'Page' + (existingIds.length + 1);
  let id = base, n = 2;
  while (existingIds.includes(id)) { id = base + n; n++; }
  return id;
}

function createWizardFromSetup(pageConfigs, x, y, parentId, tabPage) {
  const ctrl = createControl('Wizard', x, y, parentId, tabPage);
  // A wizard conventionally takes over its entire host (the whole Form, or
  // whatever panel/container it was placed into) rather than sitting as a
  // small nested rectangle - default it to Dock=Fill, and size it to that
  // filled size immediately (via the same containerClientRect the dock
  // engine itself uses) so the footer buttons created below are
  // positioned relative to the real final size, not the small pre-dock
  // default. Without this they'd be computed for a 460x320 box and only
  // get moved to match the real size on a LATER resize, never this one.
  const fillRect = containerClientRect(parentId, tabPage);
  ctrl.w = Math.max(1, fillRect.w);
  ctrl.h = Math.max(1, fillRect.h);
  ctrl.props.dock = 'Fill';
  ctrl.dockOrder = ++state.dockOrderSeq;

  const ids = [];
  ctrl.props.pages = pageConfigs.map(pc => {
    const id = wizardGeneratePageId(pc.label, ids);
    ids.push(id);
    return { id, label: pc.label || 'Page', template: pc.template || 'blank', requirements: [] };
  });
  ctrl.activeTabId = ctrl.props.pages[0].id;
  ctrl.props.pages.forEach(page => populateWizardPageTemplate(ctrl, page));
  createWizardFooterButtons(ctrl);
  return ctrl;
}

/* =========================================================================
   Guided setup modal (shown on drop / double-click of the Wizard tool)
   ========================================================================= */

let wizardSetupPending = null; // { x, y, parentId, tabPage } for the drop currently being configured

/* =========================================================================
   Wizards toolbar button - "choose a wizard" picker modal. Wizard isn't in
   the normal toolbox (it doesn't behave like a draggable-to-a-spot
   control), so this is its own dedicated entry point instead - and one
   that scales to more wizard TYPES later (WIZARD_TYPES, Control-Data.js)
   without needing a redesign.
   ========================================================================= */

/* =========================================================================
   Checked/Unchecked/Cancel picker - used wherever a boolean requirement
   needs a real direction chosen rather than assumed, with an actual way
   to back out and create nothing (unlike a plain confirm()'s OK/Cancel,
   which has no way to represent "do nothing" separately from "Unchecked").
   ========================================================================= */

function getWizardCheckedModalOverlay() {
  let overlay = document.getElementById('wizardCheckedModalOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'wizardCheckedModalOverlay';
  overlay.innerHTML = `
    <div class="modal" style="width:340px;">
      <div class="modal-header">
        <h2>Require Checked or Unchecked?</h2>
      </div>
      <div class="modal-body">
        <div class="items-hint" id="wizardCheckedModalText"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="wizardCheckedModalCancel">Cancel</button>
        <button class="btn" id="wizardCheckedModalUnchecked">Unchecked</button>
        <button class="btn btn-accent" id="wizardCheckedModalChecked">Checked</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  return overlay;
}

// onChoice receives 'checked', 'unchecked', or null (Cancel - do nothing,
// as opposed to Cancel silently meaning Unchecked).
function openWizardCheckedModal(controlName, onChoice) {
  const overlay = getWizardCheckedModalOverlay();
  document.getElementById('wizardCheckedModalText').textContent = `Require "${controlName}" to be:`;
  const close = () => overlay.classList.remove('open');
  // Clone-and-replace each button to drop any listener from a previous
  // open rather than stacking a new one on top every time.
  ['wizardCheckedModalCancel', 'wizardCheckedModalUnchecked', 'wizardCheckedModalChecked'].forEach((id, i) => {
    const old = document.getElementById(id);
    const fresh = old.cloneNode(true);
    old.replaceWith(fresh);
    const choice = [null, 'unchecked', 'checked'][i];
    fresh.addEventListener('click', () => { close(); onChoice(choice); });
  });
  overlay.classList.add('open');
}

function getWizardPickerOverlay() {
  let overlay = document.getElementById('wizardPickerModalOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'wizardPickerModalOverlay';
  overlay.innerHTML = `
    <div class="modal" style="width:360px;">
      <div class="modal-header">
        <h2>Add a Wizard</h2>
        <button class="btn icon-btn btn-ghost" id="wizardPickerClose">&times;</button>
      </div>
      <div class="modal-body">
        <div id="wizardPickerList"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="wizardPickerCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWizardPickerModal(); });
  document.getElementById('wizardPickerClose').addEventListener('click', closeWizardPickerModal);
  document.getElementById('wizardPickerCancel').addEventListener('click', closeWizardPickerModal);

  return overlay;
}

function closeWizardPickerModal() {
  const overlay = document.getElementById('wizardPickerModalOverlay');
  if (overlay) overlay.classList.remove('open');
}

// Placing a wizard into whatever's currently selected (or the Form) is
// shared by both entry points below - the picker modal (when there's a
// choice to make) and the direct-launch path (when there isn't).
function wizardTargetFromSelection() {
  const sel = state.selectedId ? getControl(state.selectedId) : null;
  const isSelContainer = sel && CONTROL_DEFS[sel.type].isContainer;
  const parentId = isSelContainer ? sel.id : null;
  const tabPage = isSelContainer && (CONTROL_DEFS[sel.type].isTabControl || CONTROL_DEFS[sel.type].isWizard) ? sel.activeTabId : null;
  return { parentId, tabPage };
}

function openWizardPickerModal() {
  // Only one wizard type exists so far - skip straight to it instead of
  // making the user pick from a list of one. Once WIZARD_TYPES grows,
  // this naturally starts showing the picker on its own.
  if (WIZARD_TYPES.length <= 1) {
    const { parentId, tabPage } = wizardTargetFromSelection();
    if (WIZARD_TYPES[0] && WIZARD_TYPES[0].type === 'Wizard') openWizardSetupModal(20, 20, parentId, tabPage);
    return;
  }

  const overlay = getWizardPickerOverlay();
  const list = document.getElementById('wizardPickerList');
  list.innerHTML = '';
  WIZARD_TYPES.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'tab-editor-item wizard-picker-item';
    item.innerHTML = `<div class="wizard-picker-item-text"><div class="wizard-picker-item-label">${escapeHtml(entry.label)}</div><div class="wizard-picker-item-desc">${escapeHtml(entry.description)}</div></div>`;
    item.title = 'Add this to the currently selected container (or the Form, if nothing\'s selected).';
    item.addEventListener('click', () => {
      closeWizardPickerModal();
      const { parentId, tabPage } = wizardTargetFromSelection();
      if (entry.type === 'Wizard') openWizardSetupModal(20, 20, parentId, tabPage);
    });
    list.appendChild(item);
  });
  overlay.classList.add('open');
}

// Every container a new wizard could be added into - the Form itself
// ("Main Panel") plus any container control that exists, keyed the same
// way createControl expects (parentId/tabPage). Used by the setup modal's
// target dropdown so switching where the wizard lands doesn't require
// closing the modal and re-launching it from a different selection.
function wizardAvailableTargets() {
  const targets = [{ parentId: null, tabPage: null, label: 'Main Panel' }];
  state.controls.forEach(c => {
    if (!CONTROL_DEFS[c.type].isContainer) return;
    const tabPage = (CONTROL_DEFS[c.type].isTabControl || CONTROL_DEFS[c.type].isWizard) ? c.activeTabId : null;
    targets.push({ parentId: c.id, tabPage, label: c.name });
  });
  return targets;
}

/* =========================================================================
   Summary log auto-targeting - lets the Events editor's "+ Add log" button
   (Properties-Pane.js) bind the "Add to Summary of Tasks log" snippet to
   the right RichTextBox on its own, without making the person pick a
   Target Control every time.
   ========================================================================= */

// Walks up from any control to the nearest ancestor Wizard, or null if it
// isn't inside one at all (e.g. a control sitting directly on the Form).
function findAncestorWizard(ctrl) {
  let cur = ctrl;
  const seen = new Set();
  while (cur && cur.parentId != null && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = getControl(cur.parentId);
    if (!parent) return null;
    if (CONTROL_DEFS[parent.type] && CONTROL_DEFS[parent.type].isWizard) return parent;
    cur = parent;
  }
  return null;
}

// The read-only RichTextBox on a Summary-template page inside the given
// The read-only RichTextBox on the wizard's Summary-of-Tasks ("before")
// page - the box that OWNS the log: its own authored Text is the base/header
// that entries get appended under, and it's the thing "Add to Summary of
// Tasks log" actions are conceptually describing ("what this will do").
function findWizardSummaryPageBox(wizardCtrl) {
  if (!wizardCtrl) return null;
  const pages = (wizardCtrl.props.pages || []).filter(pg => pg.template === 'summary');
  for (const pg of pages) {
    const box = state.controls.find(ch => ch.parentId === wizardCtrl.id && ch.tabPage === pg.id && ch.type === 'RichTextBox');
    if (box) return box;
  }
  return null;
}

// The read-only RichTextBox on the wizard's Summary-of-Actions-Taken
// ("after") page. summaryAfter has no dedicated console/log-file capture of
// its own yet (a separate, future feature) - until it does, its box falls
// back to mirroring the SAME entries the Summary page shows (never
// Summary's own authored base text - that's Summary's alone), under its
// own authored base text instead. This is one-directional: Summary never
// looks at summaryAfter, only the reverse.
function findWizardSummaryAfterPageBox(wizardCtrl) {
  if (!wizardCtrl) return null;
  const pages = (wizardCtrl.props.pages || []).filter(pg => pg.template === 'summaryAfter');
  for (const pg of pages) {
    const box = state.controls.find(ch => ch.parentId === wizardCtrl.id && ch.tabPage === pg.id && ch.type === 'RichTextBox');
    if (box) return box;
  }
  return null;
}

// Whichever of the two boxes above exists first (Summary preferred) - used
// only to decide whether logging is possible at all (e.g. gating the
// "+ Add log" button in Properties-Pane.js), not to pick which one gets
// which content.
function findWizardAnyLogDisplayBox(wizardCtrl) {
  return findWizardSummaryPageBox(wizardCtrl) || findWizardSummaryAfterPageBox(wizardCtrl);
}

// Auto-wires a sensible default Summary-of-Tasks log action onto a control
// the moment it lands on a Wizard "Options" page - whether that's the
// template's own starter controls (populateWizardPageTemplate) or one
// dropped there by hand later, since both go through createControl
// (Engine.js), which calls this. What gets wired depends on the control
// type - a checkbox/radio logs its own checked state (toggle on/off), a
// combo/list/text/numeric/date control logs its live value (always set,
// no on/off), and a CheckedListBox logs its currently-checked items as one
// joined line. Buttons (and anything else not covered) are left alone on
// purpose - a button is an action, not a value/state, so there's nothing
// sensible to default it to; that one's still best done by hand. Never
// overwrites a control that already has something wired to the relevant
// event - only ever fills in an untouched one.
function wizardAutoWireOptionsLog(ctrl) {
  if (!ctrl.parentId || !ctrl.tabPage) return;
  const parent = getControl(ctrl.parentId);
  if (!parent || !CONTROL_DEFS[parent.type].isWizard) return;
  const page = (parent.props.pages || []).find(p => p.id === ctrl.tabPage);
  if (!page || page.template !== 'options') return;

  if (ctrl.type === 'CheckBox' || ctrl.type === 'RadioButton') {
    wizardAutoWireCheckboxLog(ctrl);
  } else if (ctrl.type === 'CheckedListBox') {
    wizardAutoWireCheckedListBoxLog(ctrl, parent);
  } else if (WIZARD_LOG_VALUE_EXPR_BY_TYPE[ctrl.type]) {
    wizardAutoWireValueLog(ctrl, parent);
  }
}

// CheckBox/RadioButton: the toggle variant (adds the line while checked,
// removes it again the instant it's unchecked) - same snippet the "+ Add
// log" button binds by hand for CheckedChanged.
function wizardAutoWireCheckboxLog(ctrl) {
  if (ctrl.events.CheckedChanged) return;
  const snippet = EVENT_SNIPPETS.find(s => s.id === 'summaryLogToggle');
  if (!snippet) return;
  const params = {};
  snippet.params.forEach(p => {
    // Defaults to this control's own Text (e.g. "Option A") rather than
    // the generic placeholder sentence - same reasoning as the "+ Add
    // log" button's own default, just applied automatically here.
    params[p.key] = (p.key === 'message' && ctrl.props && ctrl.props.text) ? ctrl.props.text : (p.default !== undefined ? p.default : '');
  });
  const code = computeSnippetCode(snippet, params, ctrl);
  ctrl.events.CheckedChanged = { code, actions: [{ code, snippetId: snippet.id, params }] };
}

// Per-type PowerShell expression that reads a control's own CURRENT value
// (never a static label) - the whole point here is a live log line, not a
// fixed sentence. Deliberately never reads ctrl.props.text as a fallback
// label the way the checkbox/message-label paths do elsewhere: for these
// types props.text (or its equivalent) generally IS the value being
// logged, not a caption describing it - using it as a label too would
// just show the value twice.
const WIZARD_LOG_VALUE_EXPR_BY_TYPE = {
  ComboBox: '$ThisControl.Text', ListBox: '$ThisControl.Text',
  TextBox: '$ThisControl.Text', MaskedTextBox: '$ThisControl.Text', RichTextBox: '$ThisControl.Text',
  NumericUpDown: '$ThisControl.Value', DateTimePicker: '$ThisControl.Value',
};
const WIZARD_LOG_VALUE_EVENT_BY_TYPE = {
  ComboBox: 'SelectedIndexChanged', ListBox: 'SelectedIndexChanged',
  TextBox: 'TextChanged', MaskedTextBox: 'TextChanged', RichTextBox: 'TextChanged',
  NumericUpDown: 'ValueChanged', DateTimePicker: 'ValueChanged',
};

// ComboBox/ListBox (selected option), TextBox/MaskedTextBox/RichTextBox
// (entered text), NumericUpDown/DateTimePicker (the number/date itself) -
// always sets the line (no toggle/remove - there's no "unchecked" state
// for a value), prefixed with the control's own name as a plain, editable
// starting point (e.g. "TextBox1: ") since there's no reliable label to
// pull from otherwise (see the comment on WIZARD_LOG_VALUE_EXPR_BY_TYPE).
function wizardAutoWireValueLog(ctrl, wizardCtrl) {
  const evtName = WIZARD_LOG_VALUE_EVENT_BY_TYPE[ctrl.type];
  const valueExpr = WIZARD_LOG_VALUE_EXPR_BY_TYPE[ctrl.type];
  if (!evtName || ctrl.events[evtName]) return;
  const prefix = wizardEscapePsText(`${ctrl.name}: `);
  const code = `$script:${wizardCtrl.name}_LogEntries['${ctrl.name}'] = "${prefix}" + ${valueExpr}`;
  ctrl.events[evtName] = { code, actions: [{ code, snippetId: null, params: {} }] };
}

// CheckedListBox: "essentially a couple of checkboxes" - logs whichever
// items are currently checked as one joined line, removing the line
// entirely once nothing's checked. ItemCheck fires BEFORE the check state
// is actually applied (the same quirk that keeps CheckedListBox out of
// wizardGateEventForType's live Disable-Next tracking), so this manually
// adjusts for the ONE item mid-toggle (e.Index/e.NewValue) against the
// otherwise-still-current CheckedItems collection, rather than trusting
// CheckedItems as if it already reflected this click.
function wizardAutoWireCheckedListBoxLog(ctrl, wizardCtrl) {
  if (ctrl.events.ItemCheck) return;
  const code = [
    `$__checked = @($ThisControl.CheckedItems | ForEach-Object { $_.ToString() })`,
    `$__changed = $ThisControl.Items[$e.Index].ToString()`,
    `if ($e.NewValue -eq [System.Windows.Forms.CheckState]::Checked) { if ($__checked -notcontains $__changed) { $__checked += $__changed } }`,
    `else { $__checked = @($__checked | Where-Object { $_ -ne $__changed }) }`,
    `if ($__checked.Count -gt 0) { $script:${wizardCtrl.name}_LogEntries['${ctrl.name}'] = ($__checked -join ', ') } else { $script:${wizardCtrl.name}_LogEntries.Remove('${ctrl.name}') }`,
  ].join('\n');
  ctrl.events.ItemCheck = { code, actions: [{ code, snippetId: null, params: {} }] };
}

// Escapes a JS string (which may contain real newlines - a RichTextBox's
// Text property is edited as a multi-line textarea) for embedding as a
// single-line PowerShell double-quoted string literal: quotes doubled,
// matching this file's existing text-escaping convention elsewhere, and
// CRLF/LF converted to a backtick-escaped `r`n so the emitted source stays
// on one line rather than a literal line break splitting the statement.
function wizardEscapePsText(text) {
  return String(text || '')
    .replace(/"/g, '""')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '`r`n');
}

// True if this control has a "summary log" action (summaryLogAdd or
// summaryLogToggle, EVENT_SNIPPETS in Properties-Pane.js) bound anywhere in
// its events - i.e. it's a contributor to the wizard's Summary of Tasks log
// and belongs in the rebuild order below. Page-target-independent on
// purpose: the same entries feed both the Summary box and (as a fallback)
// the summaryAfter box, so this has no notion of "which display" at all.
function wizardControlHasLogAction(ctrl) {
  if (!ctrl.events) return false;
  return Object.values(ctrl.events).some(data => {
    if (!data || !data.actions) return false;
    return data.actions.some(a => a.snippetId === 'summaryLogAdd' || a.snippetId === 'summaryLogToggle');
  });
}

// Ordered list of every log-contributing control's own Name inside this
// wizard, in the order the rebuilt log should read: wizard page order
// first, then top-left-to-bottom-right placement within a page (Y then X) -
// NOT click/interaction order, and NOT dictionary insertion order (a
// PowerShell hashtable has no reliable enumeration order of its own),
// which is exactly why this fixed order is baked into the generated code
// once at build time as $script:<Name>_LogOrder rather than computed live.
function wizardLogTargetOrderedControlNames(wizardCtrl) {
  const pages = wizardCtrl.props.pages || [];
  const names = [];
  pages.forEach(page => {
    const pageControls = state.controls.filter(ch => ch.parentId === wizardCtrl.id && ch.tabPage === page.id && !ch.wizardFooter);
    pageControls.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    pageControls.forEach(ch => { if (wizardControlHasLogAction(ch)) names.push(ch.name); });
  });
  return names;
}

// Generates Update-<Name>SummaryLog: rebuilds the Summary page's
// RichTextBox Text end-to-end from $script:<Name>_LogEntries (set/cleared
// per-control by the summaryLogAdd/summaryLogToggle snippets - never
// appended/replaced-in-place) every time it's called, in the fixed
// $script:<Name>_LogOrder sequence, on top of whatever text the person
// authored directly on the box. A line break is guaranteed before the
// first log entry only if that base text doesn't already end in one, so a
// header like "Options Chosen:" lands as a real header line instead of
// running the first entry onto it.
function wizardSummaryLogFunctionLines(c, displayTarget) {
  const name = c.name;
  const lines = [];
  lines.push(`function Update-${name}SummaryLog {`);
  lines.push(`    $entryLines = @()`);
  lines.push(`    foreach ($key in $script:${name}_LogOrder) {`);
  lines.push(`        if ($script:${name}_LogEntries.ContainsKey($key)) { $entryLines += $script:${name}_LogEntries[$key] }`);
  lines.push(`    }`);
  lines.push(`    $entryText = $entryLines -join [Environment]::NewLine`);
  lines.push(`    $baseText = $script:${name}_LogBaseText`);
  lines.push(`    if ([string]::IsNullOrEmpty($baseText)) {`);
  lines.push(`        $${displayTarget.name}.Text = $entryText`);
  lines.push(`    } elseif ([string]::IsNullOrEmpty($entryText)) {`);
  lines.push(`        $${displayTarget.name}.Text = $baseText`);
  lines.push(`    } else {`);
  lines.push('        $needsBreak = -not ($baseText.EndsWith("`r`n") -or $baseText.EndsWith("`n"))');
  lines.push(`        $sep = if ($needsBreak) { [Environment]::NewLine } else { '' }`);
  lines.push(`        $${displayTarget.name}.Text = $baseText + $sep + $entryText`);
  lines.push(`    }`);
  lines.push(`}`);
  return lines;
}

// Generates Get-<Name>SummaryAfterEntries and Update-<Name>SummaryAfterLog.
// Get-<Name>SummaryAfterEntries is the deliberate placeholder for real
// console/log-file capture (a separate, not-yet-built feature) - it always
// returns $null for now, which is what routes Update-<Name>SummaryAfterLog
// into the fallback branch below every time. When real capture exists
// later, only this one function's body needs to change; the fallback
// branch (and the warning that makes it visibly obvious it IS a fallback,
// not real output) stays exactly as-is underneath it.
function wizardSummaryAfterLogFunctionLines(c, displayTarget) {
  const name = c.name;
  const lines = [];
  lines.push(`function Get-${name}SummaryAfterEntries {`);
  lines.push(`    # TODO: wire this up to real console/log-file output once`);
  lines.push(`    # that feature exists. Returning $null here is deliberate -`);
  lines.push(`    # it's what makes Update-${name}SummaryAfterLog fall back to`);
  lines.push(`    # mirroring the Summary of Tasks log below, so this page is`);
  lines.push(`    # testable end-to-end before real capture is built.`);
  lines.push(`    return $null`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`function Update-${name}SummaryAfterLog {`);
  lines.push(`    $realEntries = Get-${name}SummaryAfterEntries`);
  lines.push(`    if (-not [string]::IsNullOrEmpty($realEntries)) {`);
  lines.push(`        $${displayTarget.name}.Text = $realEntries`);
  lines.push(`    } else {`);
  lines.push(`        $entryLines = @()`);
  lines.push(`        foreach ($key in $script:${name}_LogOrder) {`);
  lines.push(`            if ($script:${name}_LogEntries.ContainsKey($key)) { $entryLines += $script:${name}_LogEntries[$key] }`);
  lines.push(`        }`);
  lines.push(`        $entryText = $entryLines -join [Environment]::NewLine`);
  lines.push(`        $warning = "[Fallback - showing Summary of Tasks log entries, not live output]"`);
  lines.push(`        $fallbackBody = if ([string]::IsNullOrEmpty($entryText)) { $warning } else { $warning + [Environment]::NewLine + $entryText }`);
  lines.push(`        $baseText = $script:${name}_LogAfterBaseText`);
  lines.push(`        if ([string]::IsNullOrEmpty($baseText)) {`);
  lines.push(`            $${displayTarget.name}.Text = $fallbackBody`);
  lines.push(`        } else {`);
  lines.push('            $needsBreak = -not ($baseText.EndsWith("`r`n") -or $baseText.EndsWith("`n"))');
  lines.push(`            $sep = if ($needsBreak) { [Environment]::NewLine } else { '' }`);
  lines.push(`            $${displayTarget.name}.Text = $baseText + $sep + $fallbackBody`);
  lines.push(`        }`);
  lines.push(`    }`);
  lines.push(`}`);
  return lines;
}


function getWizardSetupOverlay() {
  let overlay = document.getElementById('wizardSetupModalOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'wizardSetupModalOverlay';
  overlay.innerHTML = `
    <div class="modal" style="width:440px;">
      <div class="modal-header">
        <h2>Set Up Wizard</h2>
        <button class="btn icon-btn btn-ghost" id="wizardSetupClose">&times;</button>
      </div>
      <div class="modal-body">
        <div class="prop-row" id="wizardSetupTargetRow" style="display:none;">
          <label title="Which panel/container to add this wizard into.">Add into</label>
          <select id="wizardSetupTargetSelect"></select>
        </div>
        <div class="items-hint" style="margin-bottom:8px;">Choose the pages for this wizard. You can add, rename, reorder, or remove pages later from the Pages editor.</div>
        <div id="wizardSetupPagesList"></div>
        <button type="button" class="btn btn-ghost tab-add-btn" id="wizardSetupAddBtn">+ Add page</button>
      </div>
      <div class="modal-footer">
        <button class="btn" id="wizardSetupCancel">Cancel</button>
        <button class="btn btn-accent" id="wizardSetupCreate">Create Wizard</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWizardSetupModal(); });
  document.getElementById('wizardSetupClose').addEventListener('click', closeWizardSetupModal);
  document.getElementById('wizardSetupCancel').addEventListener('click', closeWizardSetupModal);
  document.getElementById('wizardSetupAddBtn').addEventListener('click', () => {
    // Template is chosen per-row (the dropdown built in renderWizardSetupList)
    // rather than here - one editable place for it instead of two.
    const label = wizardDefaultLabelForTemplate('blank', wizardSetupDraftPages.map(p => p.label));
    wizardSetupDraftPages.push({ label, template: 'blank' });
    renderWizardSetupList();
  });
  document.getElementById('wizardSetupCreate').addEventListener('click', () => {
    if (!wizardSetupDraftPages.length || !wizardSetupPending) return;
    const { x, y, parentId, tabPage } = wizardSetupPending;
    const ctrl = createWizardFromSetup(wizardSetupDraftPages, x, y, parentId, tabPage);
    closeWizardSetupModal();
    selectControl(ctrl.id);
  });

  return overlay;
}

let wizardSetupDraftPages = [];

function renderWizardSetupList() {
  const list = document.getElementById('wizardSetupPagesList');
  list.innerHTML = '';
  wizardSetupDraftPages.forEach((page, i) => {
    const row = document.createElement('div');
    row.className = 'tab-editor-item wizard-page-editor-item';

    const topRow = document.createElement('div');
    topRow.className = 'wizard-page-editor-toprow';

    const reorder = document.createElement('div');
    reorder.className = 'wizard-page-reorder';
    const upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.className = 'btn btn-ghost'; upBtn.textContent = '\u25B2';
    upBtn.title = 'Move this page earlier.';
    upBtn.disabled = i === 0;
    upBtn.addEventListener('click', () => { wizardSetupDraftPages.splice(i - 1, 0, wizardSetupDraftPages.splice(i, 1)[0]); renderWizardSetupList(); });
    const downBtn = document.createElement('button');
    downBtn.type = 'button'; downBtn.className = 'btn btn-ghost'; downBtn.textContent = '\u25BC';
    downBtn.title = 'Move this page later.';
    downBtn.disabled = i === wizardSetupDraftPages.length - 1;
    downBtn.addEventListener('click', () => { wizardSetupDraftPages.splice(i + 1, 0, wizardSetupDraftPages.splice(i, 1)[0]); renderWizardSetupList(); });
    reorder.appendChild(upBtn);
    reorder.appendChild(downBtn);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'menu-editor-label-input';
    nameInput.value = page.label;
    nameInput.addEventListener('change', (e) => { page.label = e.target.value.trim() || page.label; });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
    delBtn.textContent = '\u2715';
    delBtn.title = 'Remove this page from the setup.';
    delBtn.addEventListener('click', () => {
      if (wizardSetupDraftPages.length <= 1) return; // need at least one page
      wizardSetupDraftPages.splice(i, 1);
      renderWizardSetupList();
    });

    topRow.appendChild(reorder);
    topRow.appendChild(nameInput);
    topRow.appendChild(delBtn);
    row.appendChild(topRow);

    // Template on its own line - editable here, not a separate selector
    // next to the Add button, so there's one place to set it instead of two.
    const tplRow = document.createElement('div');
    tplRow.className = 'wizard-page-template-row';
    const tplSelect = document.createElement('select');
    Object.keys(WIZARD_TEMPLATE_LABELS).forEach(k => {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = WIZARD_TEMPLATE_LABELS[k];
      if (k === page.template) opt.selected = true;
      tplSelect.appendChild(opt);
    });
    tplSelect.addEventListener('change', (e) => {
      const newTemplate = e.target.value;
      // Only auto-relabel a title that still looks untouched - once the
      // person has typed their own page name, switching templates must
      // never clobber it.
      if (wizardLooksLikeDefaultLabel(page.label)) {
        const others = wizardSetupDraftPages.filter(p => p !== page).map(p => p.label);
        page.label = wizardDefaultLabelForTemplate(newTemplate, others);
      }
      page.template = newTemplate;
      renderWizardSetupList();
    });
    tplRow.appendChild(tplSelect);
    row.appendChild(tplRow);

    list.appendChild(row);
  });
}

function openWizardSetupModal(x, y, parentId, tabPage) {
  wizardSetupPending = { x, y, parentId, tabPage };
  wizardSetupDraftPages = wizardBuildDefaultSetupPages();
  const overlay = getWizardSetupOverlay();

  // Only worth showing a dropdown if there's an actual choice to make -
  // with nothing but the Form to add into, it'd be a one-item selector.
  const targets = wizardAvailableTargets();
  const targetRow = document.getElementById('wizardSetupTargetRow');
  const targetSelect = document.getElementById('wizardSetupTargetSelect');
  if (targets.length > 1) {
    targetSelect.innerHTML = '';
    targets.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = t.label;
      if (t.parentId === parentId && t.tabPage === tabPage) opt.selected = true;
      targetSelect.appendChild(opt);
    });
    // Nothing in the list matched the incoming parentId/tabPage (shouldn't
    // normally happen, but stay safe) - fall back to whatever rendered as
    // selected by default (index 0) rather than leaving it inconsistent.
    if (!targets.some(t => t.parentId === parentId && t.tabPage === tabPage)) targetSelect.value = '0';
    targetSelect.onchange = (e) => {
      const t = targets[Number(e.target.value)];
      wizardSetupPending.parentId = t.parentId;
      wizardSetupPending.tabPage = t.tabPage;
    };
    targetRow.style.display = '';
  } else {
    targetRow.style.display = 'none';
  }

  renderWizardSetupList();
  overlay.classList.add('open');
}

function closeWizardSetupModal() {
  const overlay = document.getElementById('wizardSetupModalOverlay');
  if (overlay) overlay.classList.remove('open');
  wizardSetupPending = null;
}

/* =========================================================================
   Custom requirement-logic builder - grouped AND/OR/parentheses instead of
   the flat All/Any combine mode. A page's built expression
   (page.customExpr, an ordered token list) is independent of
   page.requirementsMode: it's only ACTIVE when the mode is 'custom', but
   it's kept around either way so switching back to All/Any and later back
   to Custom (or just reopening the builder) never loses what was built -
   only hitting Apply here ever writes it back onto the page.
   ========================================================================= */

let wizardCustomExprDraft = null; // { wizardCtrl, page, tokens } - null when closed
let wizardCustomExprDragIndex = null;

function getWizardCustomExprOverlay() {
  let overlay = document.getElementById('wizardCustomExprModalOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'wizardCustomExprModalOverlay';
  overlay.innerHTML = `
    <div class="modal" style="width:480px;">
      <div class="modal-header">
        <h2>Build Custom Requirement Logic</h2>
        <button class="btn icon-btn btn-ghost" id="wizardCustomExprClose">&times;</button>
      </div>
      <div class="modal-body">
        <div class="items-hint" style="margin-bottom:8px;">Click items and operators below to build a boolean expression, e.g. (A AND B) OR C. Drag a chip by its handle to reorder; use the &times; on a chip to remove it.</div>
        <div class="wizard-custom-expr-chips" id="wizardCustomExprChips"></div>
        <div class="wizard-custom-expr-error" id="wizardCustomExprError"></div>
        <div class="wizard-custom-expr-palette-heading">Operators</div>
        <div class="wizard-custom-expr-palette" id="wizardCustomExprOpPalette"></div>
        <div class="wizard-custom-expr-palette-heading">Required Items</div>
        <div class="wizard-custom-expr-palette" id="wizardCustomExprItemPalette"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-danger" id="wizardCustomExprClear">Clear</button>
        <button class="btn" id="wizardCustomExprCancel">Cancel</button>
        <button class="btn btn-accent" id="wizardCustomExprApply">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWizardCustomExprModal(); });
  document.getElementById('wizardCustomExprClose').addEventListener('click', closeWizardCustomExprModal);
  document.getElementById('wizardCustomExprCancel').addEventListener('click', closeWizardCustomExprModal);
  document.getElementById('wizardCustomExprClear').addEventListener('click', () => {
    if (!wizardCustomExprDraft) return;
    wizardCustomExprDraft.tokens = [];
    renderWizardCustomExprModal();
  });
  document.getElementById('wizardCustomExprApply').addEventListener('click', () => {
    if (!wizardCustomExprDraft || !wizardCustomExprValidity(wizardCustomExprDraft.tokens).valid) return;
    wizardCustomExprDraft.page.customExpr = wizardCustomExprDraft.tokens.map(t => ({ ...t }));
    wizardCustomExprDraft.page.requirementsMode = 'custom';
    closeWizardCustomExprModal();
    render();
  });

  return overlay;
}

function closeWizardCustomExprModal() {
  const overlay = document.getElementById('wizardCustomExprModalOverlay');
  if (overlay) overlay.classList.remove('open');
  // Discards any unapplied edits - only Apply above ever writes back onto
  // the page, so Cancel/backdrop-click/X safely revert to whatever was
  // last saved, exactly as if nothing had been touched this time around.
  wizardCustomExprDraft = null;
  wizardCustomExprDragIndex = null;
}

// Opens the builder for one page, pre-loaded from its last-saved
// page.customExpr (or empty, the first time) - reopening never wipes it.
function openWizardCustomExprModal(wizardCtrl, page) {
  const overlay = getWizardCustomExprOverlay();
  wizardCustomExprDraft = {
    wizardCtrl,
    page,
    tokens: (page.customExpr || []).map(t => ({ ...t })),
  };
  renderWizardCustomExprModal();
  overlay.classList.add('open');
}

function wizardCustomExprTokenLabel(token, items) {
  if (token.type === 'and') return 'AND';
  if (token.type === 'or') return 'OR';
  if (token.type === 'lparen') return '(';
  if (token.type === 'rparen') return ')';
  const item = items.find(it => it.key === token.key);
  return item ? item.label : '(removed control)';
}

function renderWizardCustomExprModal() {
  if (!wizardCustomExprDraft) return;
  const { wizardCtrl, page, tokens } = wizardCustomExprDraft;
  const items = wizardRequirementItemsForPage(wizardCtrl, page);

  const chipRow = document.getElementById('wizardCustomExprChips');
  chipRow.innerHTML = '';
  if (!tokens.length) {
    const empty = document.createElement('div');
    empty.className = 'wizard-custom-expr-empty';
    empty.textContent = 'Nothing built yet - use the buttons below.';
    chipRow.appendChild(empty);
  }
  tokens.forEach((token, i) => {
    const chip = document.createElement('div');
    chip.className = `wizard-expr-chip wizard-expr-chip-${token.type}`;
    chip.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'wizard-expr-chip-handle';
    handle.textContent = '\u22ee\u22ee';
    handle.title = 'Drag to reorder';

    const label = document.createElement('span');
    label.className = 'wizard-expr-chip-label';
    label.textContent = wizardCustomExprTokenLabel(token, items);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'wizard-expr-chip-remove';
    removeBtn.textContent = '\u2715';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => { tokens.splice(i, 1); renderWizardCustomExprModal(); });

    chip.appendChild(handle);
    chip.appendChild(label);
    chip.appendChild(removeBtn);

    chip.addEventListener('dragstart', () => { wizardCustomExprDragIndex = i; });
    chip.addEventListener('dragover', (e) => { e.preventDefault(); chip.classList.add('drag-over'); });
    chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
    chip.addEventListener('drop', (e) => {
      e.preventDefault();
      chip.classList.remove('drag-over');
      if (wizardCustomExprDragIndex === null || wizardCustomExprDragIndex === i) return;
      const [moved] = tokens.splice(wizardCustomExprDragIndex, 1);
      const insertAt = wizardCustomExprDragIndex < i ? i - 1 : i;
      tokens.splice(insertAt, 0, moved);
      wizardCustomExprDragIndex = null;
      renderWizardCustomExprModal();
    });

    chipRow.appendChild(chip);
  });

  const opPalette = document.getElementById('wizardCustomExprOpPalette');
  opPalette.innerHTML = '';
  [['lparen', '('], ['rparen', ')'], ['and', 'AND'], ['or', 'OR']].forEach(([type, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost wizard-expr-palette-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => { tokens.push({ type }); renderWizardCustomExprModal(); });
    opPalette.appendChild(btn);
  });

  // One button per requirement currently marked required on this page
  // (toggle, detected, or manual) - the same set Test-<n>PageRequirements
  // already checks, just clickable here instead of typed.
  const itemPalette = document.getElementById('wizardCustomExprItemPalette');
  itemPalette.innerHTML = '';
  if (!items.length) {
    const hint = document.createElement('div');
    hint.className = 'items-hint';
    hint.textContent = 'No requirements on this page yet - mark a control "Required before Next" first.';
    itemPalette.appendChild(hint);
  }
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost wizard-expr-palette-btn';
    btn.textContent = item.label;
    btn.title = item.ctrl.name;
    btn.addEventListener('click', () => { tokens.push({ type: 'item', key: item.key }); renderWizardCustomExprModal(); });
    itemPalette.appendChild(btn);
  });

  const errEl = document.getElementById('wizardCustomExprError');
  const validity = wizardCustomExprValidity(tokens);
  errEl.textContent = validity.message || '';
  errEl.style.display = validity.message ? 'block' : 'none';
  document.getElementById('wizardCustomExprApply').disabled = !validity.valid;
}

// Stack-based structural check: balanced parentheses, no two operands or
// two operators back to back, doesn't start/end on AND/OR, no empty
// parentheses. A missing-item token (its control got deleted since the
// expression was built) isn't flagged here - wizardCustomExprToPs below
// substitutes $true for it rather than breaking codegen outright.
function wizardCustomExprValidity(tokens) {
  if (!tokens.length) return { valid: false, message: 'Add at least one item.' };
  let depth = 0;
  let expectOperand = true; // true: an item or "(" is valid next
  for (const t of tokens) {
    if (t.type === 'lparen') {
      if (!expectOperand) return { valid: false, message: 'A "(" can\'t follow an item or ")".' };
      depth++;
    } else if (t.type === 'rparen') {
      if (expectOperand) return { valid: false, message: 'A ")" can\'t follow an operator or "(".' };
      depth--;
      if (depth < 0) return { valid: false, message: 'Unmatched ")".' };
    } else if (t.type === 'and' || t.type === 'or') {
      if (expectOperand) return { valid: false, message: 'AND/OR can\'t follow another operator or "(".' };
      expectOperand = true;
    } else if (t.type === 'item') {
      if (!expectOperand) return { valid: false, message: 'Two items in a row need AND/OR between them.' };
      expectOperand = false;
    }
  }
  if (depth !== 0) return { valid: false, message: 'Unmatched "(".' };
  if (expectOperand) return { valid: false, message: 'Expression can\'t end with an operator or "(".' };
  return { valid: true, message: '' };
}

// Converts a page's saved token list into a single PowerShell boolean
// expression, substituting each item token with its own requirement
// expression (parenthesized, so combining never depends on -and/-or
// precedence guesswork) - used by both Test-<n>PageRequirements and
// Update-<n>NextEnabled for a page in 'custom' combine mode.
function wizardCustomExprToPs(tokens, items) {
  const byKey = {};
  items.forEach(it => { byKey[it.key] = it.expr; });
  return tokens.map(t => {
    if (t.type === 'item') return byKey[t.key] !== undefined ? `(${byKey[t.key]})` : '$true';
    if (t.type === 'and') return '-and';
    if (t.type === 'or') return '-or';
    if (t.type === 'lparen') return '(';
    if (t.type === 'rparen') return ')';
    return '';
  }).join(' ');
}

// Renders a page's built token list as a plain-English restatement of the
// rule itself - "Option A and Option B or Option J" - for the "Show
// message" friendly text. Deliberately NOT a per-item unmet check: which
// specific items still need attention depends on which OR-branch the
// person is pursuing, so the fixed rule text is the only thing that's
// always accurate, however many other requirements the page also has.
function wizardCustomExprToHumanText(tokens, items) {
  const byKey = {};
  items.forEach(it => { byKey[it.key] = it.label; });
  return tokens.map(t => {
    if (t.type === 'item') return byKey[t.key] || '(removed control)';
    if (t.type === 'and') return 'and';
    if (t.type === 'or') return 'or';
    if (t.type === 'lparen') return '(';
    if (t.type === 'rparen') return ')';
    return '';
  }).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
}

/* =========================================================================
   Pages properties-pane editor - mirrors the TabControl Tabs editor
   (rename / Show-Active / delete), plus reorder and per-page validation.
   ========================================================================= */

function buildWizardPagesEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'tab-editor';

  const heading = document.createElement('div');
  heading.className = 'tab-editor-heading';
  heading.title = tt(key);
  heading.textContent = label;
  wrap.appendChild(heading);

  const pages = ctrl.props[key];
  pages.forEach((page, pi) => {
    wrap.appendChild(buildWizardPageEditorItem(ctrl, pages, page, pi));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost tab-add-btn';
  addBtn.textContent = '+ Add page';
  addBtn.title = 'Add a new wizard page (starts on the Blank template) - switch its Template dropdown afterward for Welcome/Options/Summary starter content instead.';
  addBtn.addEventListener('click', () => {
    const label = wizardDefaultLabelForTemplate('blank', pages.map(p => p.label));
    const id = wizardGeneratePageId(label, pages.map(p => p.id));
    const newPage = { id, label, template: 'blank', requirements: [] };
    pages.push(newPage);
    populateWizardPageTemplate(ctrl, newPage);
    render();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function buildWizardPageEditorItem(ctrl, pages, page, pi) {
  const outer = document.createElement('div');
  outer.className = 'tab-editor-item wizard-page-editor-item' + (page.id === ctrl.activeTabId ? ' active' : '');

  const topRow = document.createElement('div');
  topRow.className = 'wizard-page-editor-toprow';

  const reorder = document.createElement('div');
  reorder.className = 'wizard-page-reorder';
  const upBtn = document.createElement('button');
  upBtn.type = 'button'; upBtn.className = 'btn btn-ghost'; upBtn.textContent = '\u25B2';
  upBtn.title = 'Move this page earlier.';
  upBtn.disabled = pi === 0;
  upBtn.addEventListener('click', () => { pages.splice(pi - 1, 0, pages.splice(pi, 1)[0]); render(); });
  const downBtn = document.createElement('button');
  downBtn.type = 'button'; downBtn.className = 'btn btn-ghost'; downBtn.textContent = '\u25BC';
  downBtn.title = 'Move this page later.';
  downBtn.disabled = pi === pages.length - 1;
  downBtn.addEventListener('click', () => { pages.splice(pi + 1, 0, pages.splice(pi, 1)[0]); render(); });
  reorder.appendChild(upBtn);
  reorder.appendChild(downBtn);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'menu-editor-label-input';
  nameInput.value = page.label;
  nameInput.addEventListener('change', (e) => { page.label = e.target.value.trim() || page.label; render(); });

  const selectBtn = document.createElement('button');
  selectBtn.type = 'button';
  selectBtn.className = 'btn btn-ghost tab-select-btn';
  selectBtn.textContent = page.id === ctrl.activeTabId ? 'Active' : 'Show';
  selectBtn.title = 'Switch the canvas to this page so you can place controls on it.';
  selectBtn.addEventListener('click', () => { ctrl.activeTabId = page.id; render(); });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this page and everything placed on it.';
  delBtn.addEventListener('click', () => {
    if (pages.length <= 1) return; // a Wizard needs at least one page
    state.controls = state.controls.filter(c => !(c.parentId === ctrl.id && c.tabPage === page.id));
    pages.splice(pi, 1);
    if (ctrl.activeTabId === page.id) ctrl.activeTabId = pages[0].id;
    render();
  });

  topRow.appendChild(reorder);
  topRow.appendChild(nameInput);
  topRow.appendChild(selectBtn);
  topRow.appendChild(delBtn);
  outer.appendChild(topRow);

  // Template gets its own line - editable now (it used to be an
  // informational-only badge), and applying one adds that template's
  // starter controls to the page immediately (it doesn't remove anything
  // already there, so switching templates layers content rather than
  // replacing it - safest default given there's no undo prompt here).
  const tplRow = document.createElement('div');
  tplRow.className = 'wizard-page-template-row';
  const tplLabel = document.createElement('label');
  tplLabel.textContent = 'Template';
  tplLabel.title = 'Applying a template adds its starter controls to this page - it doesn\'t remove anything already there.';
  const tplSelect = document.createElement('select');
  Object.keys(WIZARD_TEMPLATE_LABELS).forEach(k => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = WIZARD_TEMPLATE_LABELS[k];
    if (k === page.template) opt.selected = true;
    tplSelect.appendChild(opt);
  });
  tplSelect.addEventListener('change', (e) => {
    const newTemplate = e.target.value;
    // Same untouched-default guard as the Setup modal's row - a page the
    // person already renamed by hand keeps its name across a template switch.
    if (wizardLooksLikeDefaultLabel(page.label)) {
      const others = pages.filter(p => p !== page).map(p => p.label);
      page.label = wizardDefaultLabelForTemplate(newTemplate, others);
    }
    page.template = newTemplate;
    populateWizardPageTemplate(ctrl, page);
    render();
  });
  tplRow.appendChild(tplLabel);
  tplRow.appendChild(tplSelect);
  outer.appendChild(tplRow);

  const reqWrap = document.createElement('div');
  reqWrap.className = 'wizard-requirements-wrap';
  const reqHeading = document.createElement('div');
  reqHeading.className = 'wizard-requirements-heading';
  reqHeading.title = 'Extra conditions - beyond any controls checked "Required before Next" on the control itself - that must hold before Next can leave THIS page. Detected ones (grey, "from event handler") come from a control\'s own CheckedChanged handler that already enables/disables Next directly - nothing to configure, they just show what\'s already wired up. Add more manually below for anything not covered that way. Gates only this page\'s turn at the shared Next button, never the button\'s Enabled property directly, so it can\'t leak onto other pages.';
  reqHeading.textContent = 'Additional requirements';
  reqWrap.appendChild(reqHeading);

  const detected = wizardDetectedRequirementsForPage(ctrl, page);
  if (!page.requirements) page.requirements = [];
  const reqChildrenCount = state.controls.filter(ch => ch.parentId === ctrl.id && ch.tabPage === page.id && ch.wizardRequired).length;
  const totalCount = detected.length + reqChildrenCount + page.requirements.length;

  // Governs every requirement on this page together - a control's own
  // "Required before Next" toggle, a detected event handler, AND the
  // manual list below - not just the manual ones alone, since all three
  // are really one combined set the wizard checks before allowing Next.
  // Only meaningful with 2+ total requirements to combine.
  if (totalCount > 1) {
    const modeRow = document.createElement('div');
    modeRow.className = 'wizard-requirements-mode-row';
    modeRow.title = 'How every requirement on this page combines - a control\'s own "Required before Next" toggle and a detected event handler included, not just the manual list below. "All": every one must hold. "Any": at least one of them must hold. "Custom": a boolean expression built with the button below, e.g. "(A AND B) OR C".';
    const mode = page.requirementsMode || 'all';
    const hasCustom = !!(page.customExpr && page.customExpr.length);
    modeRow.innerHTML = `<label>Combine as</label>
      <select>
        <option value="all" ${mode === 'all' ? 'selected' : ''}>All of these must hold</option>
        <option value="any" ${mode === 'any' ? 'selected' : ''}>Any one of these must hold</option>
        ${hasCustom ? `<option value="custom" ${mode === 'custom' ? 'selected' : ''}>Custom (built with builder)</option>` : ''}
      </select>`;
    modeRow.querySelector('select').addEventListener('change', (e) => { page.requirementsMode = e.target.value; render(); });
    reqWrap.appendChild(modeRow);

    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'btn btn-ghost wizard-custom-expr-btn';
    customBtn.textContent = hasCustom ? 'Edit Custom Expression\u2026' : 'Build Custom Expression\u2026';
    customBtn.title = 'Opens a builder for grouped AND/OR logic, e.g. "(A AND B) OR C", instead of the flat All/Any above. Reopening keeps whatever you built last time - it never wipes on open.';
    customBtn.addEventListener('click', () => openWizardCustomExprModal(ctrl, page));
    reqWrap.appendChild(customBtn);
  }

  if (totalCount > 0) {
    const nextModeRow = document.createElement('div');
    nextModeRow.className = 'wizard-requirements-mode-row';
    nextModeRow.title = '"Show a message" (default): Next stays clickable - clicking it while something\'s unmet shows a friendly message naming what\'s outstanding. "Keep Next disabled": Next\'s Enabled state tracks this page\'s requirements live as the person fills it out, instead of only checking on click.';
    const nextMode = page.nextMode || 'message';
    nextModeRow.innerHTML = `<label>When incomplete</label>
      <select>
        <option value="message" ${nextMode === 'message' ? 'selected' : ''}>Show a message</option>
        <option value="disable" ${nextMode === 'disable' ? 'selected' : ''}>Keep Next disabled</option>
      </select>`;
    nextModeRow.querySelector('select').addEventListener('change', (e) => { page.nextMode = e.target.value; render(); });
    reqWrap.appendChild(nextModeRow);
  }

  detected.forEach(d => reqWrap.appendChild(buildWizardDetectedRequirementRow(d, ctrl)));

  const pageControls = state.controls.filter(ch => ch.parentId === ctrl.id && ch.tabPage === page.id && !ch.wizardFooter);
  if (!pageControls.length) {
    if (!detected.length) {
      const hint = document.createElement('div');
      hint.className = 'items-hint';
      hint.textContent = 'Add a control to this page first to set up a requirement.';
      reqWrap.appendChild(hint);
    }
  } else {
    page.requirements.forEach((req, ri) => reqWrap.appendChild(buildWizardRequirementRow(ctrl, page, req, ri, pageControls)));
    const addReqBtn = document.createElement('button');
    addReqBtn.type = 'button';
    addReqBtn.className = 'btn btn-ghost tab-add-btn';
    addReqBtn.textContent = '+ Add requirement';
    addReqBtn.title = 'Click, then click any control on this page (canvas) to require it - checkboxes/radio buttons ask whether Checked or Unchecked is required, everything else gets a comparator (>, <, =, ...) against a value.';
    addReqBtn.addEventListener('click', () => {
      startControlPick((picked) => {
        if (!pageControls.some(c => c.id === picked.id)) {
          alert(`${picked.name} isn't on this page, so it can't be a requirement for leaving it - pick a control that's actually placed on "${page.label}".`);
          return;
        }
        const property = wizardPrimaryGateProperty(picked.type);
        const kind = resolveValueWidgetKind(picked.type, property);
        if (kind === 'boolean') {
          // "Must be Unchecked" is a real (if less common) case for a
          // CheckBox - RadioButtons don't have a sensible equivalent
          // (there's nothing to frame as "not the selected one"), so only
          // ask for those. A real Cancel option here (not just OK/Cancel
          // standing in for Checked/Unchecked) means backing out actually
          // creates nothing.
          if (picked.type === 'CheckBox') {
            openWizardCheckedModal(picked.name, (choice) => {
              if (!choice) return; // Cancel - do nothing
              wizardSyncBooleanGate(ctrl, picked, choice);
              render();
            });
          } else {
            wizardSyncBooleanGate(ctrl, picked, 'checked');
            render();
          }
        } else {
          page.requirements.push({ targetId: picked.id, property, comparator: 'eq', value: kind === 'number' ? 0 : '' });
          render();
        }
      });
    });
    reqWrap.appendChild(addReqBtn);
  }
  outer.appendChild(reqWrap);

  return outer;
}

// Comparator options for a page requirement - PS operator on the right.
const WIZARD_COMPARATORS = [
  { id: 'eq', label: 'Equals', ps: '-eq' },
  { id: 'ne', label: 'Not Equals', ps: '-ne' },
  { id: 'gt', label: 'Greater Than', ps: '-gt' },
  { id: 'ge', label: 'Greater Or Equal', ps: '-ge' },
  { id: 'lt', label: 'Less Than', ps: '-lt' },
  { id: 'le', label: 'Less Or Equal', ps: '-le' },
];

// The expanding "Message Label" line shown under any active requirement
// (a control's own "Required before Next" toggle, a detected requirement,
// or a manual row) - an optional override for how that item reads in the
// "Show message" friendly list. `source` is where the override itself is
// stored (the control, for toggle/detected requirements; the requirement
// row object, for manual ones) - `ctrl` is always the target control,
// used only for the placeholder fallback text.
function buildWizardMessageLabelRow(source, ctrl) {
  const row = document.createElement('div');
  row.className = 'wizard-requirement-message-row';
  const label = document.createElement('label');
  label.textContent = 'Message Label';
  label.title = 'Optional text for this item in the "Show message" mode\'s friendly list of what\'s outstanding - falls back to the control\'s own Text property, or its name if that\'s blank, when left empty.';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = source.wizardMessageLabel || '';
  input.placeholder = (ctrl.props && ctrl.props.text) ? ctrl.props.text : ctrl.name;
  input.addEventListener('change', (e) => {
    source.wizardMessageLabel = e.target.value.trim();
    render();
  });
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

// One requirement row: [target control] [its property] [comparator] [value] -
// reuses getSettableProps() and resolveValueWidgetKind() (Control-Data.js),
// the exact same helpers the "Set another control's property" event snippet
// already uses, so this feels like the rest of the app instead of a raw
// textarea island.
// The property to gate on is auto-derived from the control's type instead
// of asking the user to pick one - realistically there's only ever one
// property worth comparing per type (Checked for a CheckBox, Value for a
// NumericUpDown, ...), so a whole dropdown for it was one control too many.
const WIZARD_PRIMARY_GATE_PROPERTY = {
  CheckBox: 'Checked', RadioButton: 'Checked',
  TextBox: 'Text', MaskedTextBox: 'Text', RichTextBox: 'Text',
  ComboBox: 'SelectedIndex', ListBox: 'SelectedIndex', CheckedListBox: 'CheckedItems.Count',
  NumericUpDown: 'Value', TrackBar: 'Value', ProgressBar: 'Value',
  DateTimePicker: 'Value',
};
function wizardPrimaryGateProperty(type) {
  return WIZARD_PRIMARY_GATE_PROPERTY[type] || getSettableProps(type)[0] || 'Text';
}

// A requirement row is 2 fields for a boolean control (target, Checked/
// Unchecked) or 3 for anything else (target, comparator, value) - never
// more than that, and never a property dropdown at all.
function buildWizardRequirementRow(ctrl, page, req, ri, pageControls) {
  const row = document.createElement('div');
  row.className = 'wizard-requirement-row';

  if (!req.targetId || !pageControls.some(c => c.id === req.targetId)) req.targetId = pageControls[0].id;
  const target = getControl(req.targetId);
  req.property = wizardPrimaryGateProperty(target.type);
  const kind = resolveValueWidgetKind(target.type, req.property);

  const targetWrap = document.createElement('div');
  targetWrap.className = 'snippet-param-control wizard-requirement-target';
  const targetDisplay = document.createElement('span');
  targetDisplay.className = 'snippet-param-control-name';
  targetDisplay.textContent = `${target.name} (${target.type})`;
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'btn btn-ghost pick-control-btn';
  pickBtn.innerHTML = '\u2316 Select Control';
  pickBtn.title = 'Click, then click a control on this page (on the canvas) to require it - same picker used everywhere else in the app.';
  pickBtn.addEventListener('click', () => {
    startControlPick((picked) => {
      if (!pageControls.some(c => c.id === picked.id)) {
        alert(`${picked.name} isn't on this page, so it can't be a requirement for leaving it - pick a control that's actually placed on "${page.label}".`);
        return;
      }
      const pickedKind = resolveValueWidgetKind(picked.type, wizardPrimaryGateProperty(picked.type));
      if (pickedKind === 'boolean') {
        // Boolean-kind targets live in the toggle+event sync, not this
        // comparator list - convert instead of leaving two representations
        // of the same thing lying around.
        if (picked.type === 'CheckBox') {
          openWizardCheckedModal(picked.name, (choice) => {
            if (!choice) return; // Cancel - leave this row as it was
            page.requirements.splice(ri, 1);
            wizardSyncBooleanGate(ctrl, picked, choice);
            render();
          });
          return;
        }
        page.requirements.splice(ri, 1);
        wizardSyncBooleanGate(ctrl, picked, 'checked');
      } else {
        req.targetId = picked.id;
        req.property = wizardPrimaryGateProperty(picked.type);
        req.comparator = 'eq';
        req.value = 0;
      }
      render();
    });
  });
  targetWrap.appendChild(targetDisplay);
  targetWrap.appendChild(pickBtn);
  row.appendChild(targetWrap);
  row.className = 'wizard-requirement-row' + (kind === 'boolean' ? ' wizard-requirement-row-2' : ' wizard-requirement-row-3');

  if (kind === 'boolean') {
    const stateSelect = document.createElement('select');
    [{ v: 'true', t: 'Checked' }, { v: 'false', t: 'Unchecked' }].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.t;
      if (String(!!req.value) === o.v) opt.selected = true;
      stateSelect.appendChild(opt);
    });
    req.comparator = 'eq';
    stateSelect.addEventListener('change', (e) => { req.value = e.target.value === 'true'; });
    row.appendChild(stateSelect);
  } else {
    const compSelect = document.createElement('select');
    WIZARD_COMPARATORS.forEach(cmp => {
      const opt = document.createElement('option');
      opt.value = cmp.id; opt.textContent = cmp.label;
      if (cmp.id === req.comparator) opt.selected = true;
      compSelect.appendChild(opt);
    });
    compSelect.addEventListener('change', (e) => { req.comparator = e.target.value; });
    row.appendChild(compSelect);

    let valueInput;
    if (kind === 'number') {
      valueInput = document.createElement('input');
      valueInput.type = 'number';
      valueInput.value = typeof req.value === 'number' ? req.value : 0;
      valueInput.addEventListener('change', (e) => { req.value = Number(e.target.value) || 0; });
    } else {
      // targetItemIndex/date/text fall back to a plain text field - good
      // enough for the comparator-based cases this covers (a control's own
      // Required checkbox already handles the plain "must be filled in/
      // checked/selected" case without needing a comparator at all).
      valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.value = req.value != null ? req.value : '';
      valueInput.addEventListener('change', (e) => { req.value = e.target.value; });
    }
    valueInput.className = 'wizard-requirement-value';
    row.appendChild(valueInput);
  }

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this requirement.';
  delBtn.addEventListener('click', () => { page.requirements.splice(ri, 1); render(); });
  row.appendChild(delBtn);

  const group = document.createElement('div');
  group.className = 'wizard-requirement-group';
  group.appendChild(row);
  group.appendChild(buildWizardMessageLabelRow(req, target));
  return group;
}

// Read-only row for a requirement detected from an existing event handler
// (see wizardDetectedRequirementsForPage) - shown alongside the editable
// ones above, but not deletable here since there's nothing to delete: it
// goes away on its own if the handler that created it does.
function buildWizardDetectedRequirementRow(detected, wizardCtrl) {
  const row = document.createElement('div');
  row.className = 'wizard-requirement-row wizard-requirement-row-detected';
  const text = document.createElement('div');
  text.className = 'wizard-requirement-detected-text';
  text.textContent = `${detected.ctrl.name} must be ${detected.checkedRequired ? 'Checked' : 'Unchecked'}`;
  text.title = `From ${detected.ctrl.name}'s own CheckedChanged handler, which already enables/disables the wizard's Next button directly.`;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = `Remove this requirement - clears ${detected.ctrl.name}'s Required toggle and its CheckedChanged handler, without needing to go select that control directly.`;
  delBtn.addEventListener('click', () => {
    wizardSyncBooleanGate(wizardCtrl, detected.ctrl, null);
    render();
  });
  row.appendChild(text);
  row.appendChild(delBtn);

  const group = document.createElement('div');
  group.className = 'wizard-requirement-group';
  group.appendChild(row);
  group.appendChild(buildWizardMessageLabelRow(detected.ctrl, detected.ctrl));
  return group;
}

/* =========================================================================
   Per-child "Wizard Page" property rows - shown in the properties pane for
   any control whose parent is a Wizard.
   ========================================================================= */

const WIZARD_REQUIRED_SUPPORTED_TYPES = [
  'CheckBox', 'RadioButton', 'TextBox', 'MaskedTextBox', 'RichTextBox',
  'ComboBox', 'ListBox', 'CheckedListBox', 'NumericUpDown', 'DateTimePicker',
];

// Detects whether a control's OWN CheckedChanged handler already gates a
// given Wizard's Next button via the Enable/Disable-another-control-while-
// checked snippets (mirrorChecked/mirrorUnchecked) - i.e. the user wired
// this up through the ordinary Events UI rather than the Required
// checkbox. Returns null if there's no such handler, or
// { checkedRequired: true/false } if there is (true = must be Checked to
// enable Next, false = must be Unchecked).
function wizardDetectNextGate(ctrl, wizardCtrl) {
  const nextBtn = state.controls.find(ch => ch.parentId === wizardCtrl.id && ch.wizardFooter && ch.wizardRole === 'next');
  if (!nextBtn) return null;
  const evt = ctrl.events && ctrl.events.CheckedChanged;
  if (!evt || !evt.actions) return null;
  const match = evt.actions.find(a => (a.snippetId === 'mirrorChecked' || a.snippetId === 'mirrorUnchecked') && a.params && a.params.target === nextBtn.name);
  if (!match) return null;
  return { checkedRequired: match.snippetId === 'mirrorChecked' };
}

// Same detection, run across every non-footer control on one page - used
// to auto-populate the Pages editor's Additional Requirements list and to
// feed Test-<Name>PageRequirements, so wiring "enable Next while checked"
// through the normal Events UI IS setting up the wizard requirement,
// instead of the two systems staying blind to each other.
function wizardDetectedRequirementsForPage(wizardCtrl, page) {
  const pageControls = state.controls.filter(ch => ch.parentId === wizardCtrl.id && ch.tabPage === page.id && !ch.wizardFooter);
  const found = [];
  pageControls.forEach(ctrl => {
    const gate = wizardDetectNextGate(ctrl, wizardCtrl);
    if (gate) found.push({ ctrl, checkedRequired: gate.checkedRequired });
  });
  return found;
}

// The single mutator for a boolean-kind (Checked-property) requirement -
// the "Required before Next" toggle, the "+ Add requirement" button, and
// a requirement row's own "Select Control" retarget all funnel through
// this, so all three always agree with each other. Purely metadata now
// (wizardRequired + wizardRequiredMode) - it does NOT touch the Next
// button's Enabled property or write any event handler. It used to (via
// the mirrorChecked/mirrorUnchecked snippets), which seemed reasonable
// but broke two ways in practice: (1) Enabled is one shared property
// across every page, so a checkbox's handler on Page 1 could leave Next
// permanently disabled (or enabled) on Page 2, which has nothing to do
// with that checkbox; (2) a disabled button never fires Click at all, so
// Test-<Name>PageRequirements' friendly "please complete this page"
// message box could never run - the button just sat there disabled with
// no explanation. wizardRequiredMode now carries the Checked/Unchecked
// distinction directly (wizardRequiredCheckExpr reads it), so nothing is
// lost - the soft, page-scoped Test-PageRequirements check (wired into
// Next's own Click handler) is the sole gate again, same as every other
// requirement type (TextBox non-empty, ComboBox selection, etc.) already
// used. Deliberately hand-wiring a mirrorChecked/mirrorUnchecked snippet
// through the ordinary Events UI is still detected separately
// (wizardDetectNextGate) and still hard-toggles Enabled if someone
// genuinely wants that - this only changes what the toggle itself does.
// mode: true/'checked' -> must be Checked, 'unchecked' -> must be Unchecked,
// false/null/undefined -> remove the requirement entirely. Accepts a plain
// boolean too (from the simple Required toggle, which only ever means
// "must be Checked") so existing callers don't need to change.
// RadioButtons sharing an immediate parent form one mutually-exclusive
// group in real WinForms - only one can ever be Checked at a time, so
// requiring two of them Checked simultaneously would make the page
// permanently impossible to complete. Returns the conflicting control, or
// null if there isn't one.
function wizardRadioGroupConflict(targetCtrl) {
  if (targetCtrl.type !== 'RadioButton') return null;
  return state.controls.find(c => c.id !== targetCtrl.id && c.type === 'RadioButton' && c.parentId === targetCtrl.parentId && c.wizardRequired) || null;
}

function wizardSyncBooleanGate(wizardCtrl, targetCtrl, mode) {
  const resolvedMode = mode === true ? 'checked' : (mode === false || mode == null) ? null : mode;
  if (resolvedMode === 'checked') {
    const conflict = wizardRadioGroupConflict(targetCtrl);
    if (conflict) {
      alert(`"${targetCtrl.name}" can't be Required at the same time as "${conflict.name}" - they're radio buttons in the same group, so only one of them can ever be checked. Remove ${conflict.name}'s requirement first if you want to switch which one is required.`);
      return;
    }
  }
  targetCtrl.wizardRequired = !!resolvedMode;
  targetCtrl.wizardRequiredMode = resolvedMode || null;
}

function buildWizardChildRows(ctrl, parentCtrl) {
  const frag = document.createElement('div');

  if (ctrl.type === 'Button') {
    const roleRow = document.createElement('div');
    roleRow.className = 'prop-row';
    const roleVal = ctrl.wizardRole || 'none';
    roleRow.innerHTML = `<label title="Assigns built-in wizard navigation behavior to this button - its Click code is then generated automatically and the button is always shown (footer). Choose None to write your own Click handler instead.">Wizard Role</label>
      <select>
        <option value="none" ${roleVal === 'none' ? 'selected' : ''}>None</option>
        <option value="back" ${roleVal === 'back' ? 'selected' : ''}>Back</option>
        <option value="next" ${roleVal === 'next' ? 'selected' : ''}>Next</option>
        <option value="cancel" ${roleVal === 'cancel' ? 'selected' : ''}>Cancel</option>
      </select>`;
    roleRow.querySelector('select').addEventListener('change', (e) => {
      const v = e.target.value;
      ctrl.wizardRole = v === 'none' ? null : v;
      if (ctrl.wizardRole) ctrl.wizardFooter = true;
      render();
    });
    frag.appendChild(roleRow);
  }

  const footerRow = document.createElement('div');
  footerRow.className = 'toggle-row';
  const footerDisabled = !!ctrl.wizardRole;
  footerRow.title = 'When on, this control shows on every page instead of just the page it was placed on - used for footer buttons, step counters, etc.';
  footerRow.innerHTML = `<span class="toggle-label">Show on all pages (footer)</span><label class="switch"><input type="checkbox" ${ctrl.wizardFooter ? 'checked' : ''} ${footerDisabled ? 'disabled' : ''}><span class="track"></span></label>`;
  footerRow.querySelector('input').addEventListener('change', (e) => {
    ctrl.wizardFooter = e.target.checked;
    ctrl.tabPage = ctrl.wizardFooter ? null : parentCtrl.activeTabId;
    render();
  });
  frag.appendChild(footerRow);

  if (!ctrl.wizardFooter && WIZARD_REQUIRED_SUPPORTED_TYPES.includes(ctrl.type)) {
    const kind = resolveValueWidgetKind(ctrl.type, wizardPrimaryGateProperty(ctrl.type));
    // Keep the flag itself in sync with whatever the event handler
    // actually says every render - if someone wired the event manually,
    // this toggle should already show ON, not need a separate note to
    // explain the discrepancy.
    if (kind === 'boolean') {
      const gate = wizardDetectNextGate(ctrl, parentCtrl);
      if (gate) ctrl.wizardRequired = true;
    }
    const reqRow = document.createElement('div');
    reqRow.className = 'toggle-row';
    reqRow.title = kind === 'boolean'
      ? 'If on, the wizard won\'t let the user click Next off this page until this control is checked - validated when Next is clicked (shows a message if not met yet), same as every other requirement type. Doesn\'t disable Next directly.'
      : 'If on, the wizard won\'t let the user click Next off this page until this control is satisfied (non-empty or a real selection, depending on type).';
    reqRow.innerHTML = `<span class="toggle-label">Required before Next</span><label class="switch"><input type="checkbox" ${ctrl.wizardRequired ? 'checked' : ''}><span class="track"></span></label>`;
    reqRow.querySelector('input').addEventListener('change', (e) => {
      if (kind === 'boolean') wizardSyncBooleanGate(parentCtrl, ctrl, e.target.checked);
      else ctrl.wizardRequired = e.target.checked;
      render();
    });
    frag.appendChild(reqRow);
    if (ctrl.wizardRequired) frag.appendChild(buildWizardMessageLabelRow(ctrl, ctrl));
  }

  return frag;
}

/* =========================================================================
   Contents nav strip (Horizontal/Vertical) - both the canvas preview
   (below) and the matching WinForms codegen (further down).
   ========================================================================= */

function buildWizardContentsNav(c) {
  const cs = c.props.contentsStyle;
  if (!cs || cs === 'None') return document.createDocumentFragment();
  const flat = cs.includes('Flat');
  const vertical = cs.startsWith('Vertical');
  const pages = c.props.pages || [];
  const nav = document.createElement('div');
  nav.className = (vertical ? 'wizard-nav-vertical' : 'wizard-nav-horizontal') + (flat ? ' wizard-nav-flat' : '');
  pages.forEach((page, pi) => {
    const item = document.createElement('div');
    item.className = 'wizard-nav-item' + (page.id === c.activeTabId ? ' active' : '');
    item.textContent = page.label;
    item.title = 'Click to switch to this page, or drag to reorder it, while designing.';
    item.draggable = true;

    // mousedown still needs to stop the wizard's own select/move gesture
    // from also firing, but NOT preventDefault - that would block the
    // browser from ever starting the native drag below.
    item.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      c.activeTabId = page.id;
      selectControl(c.id);
    });

    item.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/wizard-page-index', String(pi));
    });
    item.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/wizard-page-index')) { e.preventDefault(); item.classList.add('drag-over'); }
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', (e) => {
      if (!e.dataTransfer.types.includes('text/wizard-page-index')) return;
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drag-over');
      const fromIdx = Number(e.dataTransfer.getData('text/wizard-page-index'));
      if (Number.isNaN(fromIdx) || fromIdx === pi) return;
      pages.splice(pi, 0, pages.splice(fromIdx, 1)[0]);
      render();
    });

    nav.appendChild(item);
  });
  return nav;
}

/* =========================================================================
   Render.js helper: non-interactive page indicator overlay shown at the
   top of a Wizard while designing (page switching itself happens via the
   Pages editor's Show/Active button, not by clicking this).
   ========================================================================= */

function buildWizardPageIndicator(c) {
  const pages = c.props.pages || [];
  const idx = pages.findIndex(p => p.id === c.activeTabId);
  const label = document.createElement('div');
  label.className = 'wizard-page-indicator';
  label.textContent = pages.length ? `Page ${idx + 1} of ${pages.length}: ${pages[idx] ? pages[idx].label : ''}` : 'No pages';
  return label;
}

/* =========================================================================
   WinForms codegen helpers
   ========================================================================= */

function wizardRequiredCheckExpr(ctrl) {
  switch (ctrl.type) {
    case 'CheckBox':
    case 'RadioButton':
      // wizardRequiredMode carries the Checked/Unchecked distinction set by
      // the "Required before Next" toggle (wizardSyncBooleanGate) - absent
      // (undefined/null) defaults to the original "must be Checked" behavior.
      return ctrl.wizardRequiredMode === 'unchecked' ? `-not $${ctrl.name}.Checked` : `$${ctrl.name}.Checked`;
    case 'TextBox':
    case 'MaskedTextBox':
    case 'RichTextBox':
      return `-not [string]::IsNullOrWhiteSpace($${ctrl.name}.Text)`;
    case 'ComboBox':
    case 'ListBox':
      return `$${ctrl.name}.SelectedIndex -ge 0`;
    case 'CheckedListBox':
      return `$${ctrl.name}.CheckedItems.Count -gt 0`;
    default:
      return '$true';
  }
}

// Generates the Show-<Name>Page function: flips page-panel Visible flags,
// tracks the current index in a script-scope variable, updates the Next
// button's label and the Back button's Enabled state (if present), and
// bolds the active page's label in the Contents nav strip (if any).
// Design-time mirror of the "Run"/"Finish"/"Next" label logic below (used
// by Render.js for the canvas's Next button preview) - same rule, just
// evaluated for whichever page is currently active in the designer instead
// of emitted as PowerShell for every page up front.
function wizardNextButtonLabelForActivePage(c) {
  const pages = c.props.pages || [];
  const idx = pages.findIndex(p => p.id === c.activeTabId);
  if (idx === -1) return 'Next';
  if (idx === pages.length - 1) return 'Finish';
  return pages[idx].template === 'summary' ? 'Run' : 'Next';
}

function wizardShowFunctionLines(c, pageVarNames, navVarNames, stepCounterVar) {
  const name = c.name;
  const pages = c.props.pages || [];
  const footerBtns = state.controls.filter(ch => ch.parentId === c.id && ch.wizardFooter);
  const nextBtn = footerBtns.find(b => b.wizardRole === 'next');
  const backBtn = footerBtns.find(b => b.wizardRole === 'back');
  const lines = [];
  lines.push(`function Show-${name}Page {`);
  lines.push(`    param([int]$Index)`);
  lines.push(`    $pages = @(${pageVarNames.map(v => '$' + v).join(', ')})`);
  lines.push(`    for ($i = 0; $i -lt $pages.Count; $i++) { $pages[$i].Visible = ($i -eq $Index) }`);
  lines.push(`    $script:${name}_CurrentPage = $Index`);
  if (stepCounterVar) {
    lines.push(`    $${stepCounterVar}.Text = "Step " + ($Index + 1) + " of " + $pages.Count`);
  }
  // Rebuild whichever log display(s) this wizard has, the moment the person
  // actually lands on that page - not on each contributing control's own
  // event (wizardSummaryLogFunctionLines above) - so each always reflects
  // the live end-state of $script:<Name>_LogEntries at the moment it's
  // seen, regardless of what order pages were visited or revisited in.
  // Summary and summaryAfter are independent triggers on independent page
  // indices - a wizard can have either, both, or neither.
  const summaryBox = findWizardSummaryPageBox(c);
  const summaryPageIndex = pages.findIndex(p => p.template === 'summary');
  if (summaryBox && summaryPageIndex !== -1) {
    lines.push(`    if ($Index -eq ${summaryPageIndex}) { Update-${name}SummaryLog }`);
  }
  const summaryAfterBox = findWizardSummaryAfterPageBox(c);
  const summaryAfterPageIndex = pages.findIndex(p => p.template === 'summaryAfter');
  if (summaryAfterBox && summaryAfterPageIndex !== -1) {
    lines.push(`    if ($Index -eq ${summaryAfterPageIndex}) { Update-${name}SummaryAfterLog }`);
  }
  // Disable Next pages: reseed that page's live unmet-requirements list
  // from the controls' ACTUAL current values every time it's shown - not
  // just relying on each control's own change event, since values can
  // differ from a prior visit (or never have changed at all) by the time
  // the person comes back to this page.
  pages.forEach((page, i) => {
    const seedLines = wizardUnmetListSeedLines(c, page, i);
    if (seedLines.length) lines.push(`    if ($Index -eq ${i}) {`, ...seedLines, `    }`);
  });
  if (nextBtn) {
    // "Run" on a Summary-of-Tasks page that ISN'T the last page (a
    // Summary-of-Actions-Taken page follows it) - "Finish" on whichever
    // page actually is last, same as before - plain "Next" everywhere else.
    const nextLabels = pages.map(p => (p.template === 'summary' ? 'Run' : 'Next'));
    lines.push(`    $${name}_NextLabels = @(${nextLabels.map(l => `"${l}"`).join(', ')})`);
    lines.push(`    $${nextBtn.name}.Text = if ($Index -eq ($pages.Count - 1)) { "Finish" } else { $${name}_NextLabels[$Index] }`);
  }
  if (backBtn) {
    lines.push(`    $${backBtn.name}.Visible = ($Index -gt 0)`);
    lines.push(`    $${backBtn.name}.Enabled = ($Index -gt 0)`);
  }
  if (navVarNames && navVarNames.length) {
    lines.push(`    $navLabels = @(${navVarNames.map(v => '$' + v).join(', ')})`);
    lines.push(`    for ($i = 0; $i -lt $navLabels.Count; $i++) {`);
    lines.push(`        if ($i -eq $Index) { $navLabels[$i].Font = New-Object System.Drawing.Font($navLabels[$i].Font.FontFamily, $navLabels[$i].Font.Size, [System.Drawing.FontStyle]::Bold) }`);
    lines.push(`        else { $navLabels[$i].Font = New-Object System.Drawing.Font($navLabels[$i].Font.FontFamily, $navLabels[$i].Font.Size, [System.Drawing.FontStyle]::Regular) }`);
    lines.push(`    }`);
  }
  // Always recompute Next's Enabled for whichever page is now showing -
  // pages without "Disable Next" requirements just fall to
  // Update-<n>NextEnabled's default (Enabled = $true), so this both
  // activates the live gate on pages that need it AND resets Next back to
  // enabled when leaving one.
  if (nextBtn) lines.push(`    Update-${name}NextEnabled`);
  lines.push(`}`);
  return lines;
}

// Generates the Contents nav strip itself: a docked Panel holding one
// static Label per page (real installers' step lists are informational,
// not clickable) - Show-<Name>Page bolds whichever one is current.
// Returns { lines, navVarNames } so the caller can wire navVarNames into
// wizardShowFunctionLines above.
function wizardContentsNavCodegenLines(c) {
  const cs = c.props.contentsStyle;
  if (!cs || cs === 'None') return { lines: [], navVarNames: [] };
  const flat = cs.includes('Flat');
  const horizontal = cs.startsWith('Horizontal');
  const pages = c.props.pages || [];
  const name = c.name;
  const navVar = `${name}_Nav`;
  const lines = [];
  const navVarNames = [];

  lines.push(`$${navVar} = New-Object System.Windows.Forms.Panel`);
  if (horizontal) {
    lines.push(`$${navVar}.Location = New-Object System.Drawing.Point(0, 0)`);
    lines.push(`$${navVar}.Size = New-Object System.Drawing.Size(${c.w}, ${WIZARD_HORIZONTAL_CONTENTS_HEIGHT})`);
  } else {
    lines.push(`$${navVar}.Location = New-Object System.Drawing.Point(0, 0)`);
    lines.push(`$${navVar}.Size = New-Object System.Drawing.Size(${WIZARD_VERTICAL_CONTENTS_WIDTH}, ${c.h})`);
  }
  // Flat leaves the strip's own background alone (plain window color) to
  // match the classic installer's plain-text step list; the boxed variant
  // keeps the light-grey strip background it always had.
  if (!flat) lines.push(`$${navVar}.BackColor = [System.Drawing.Color]::FromArgb(236,236,236)`);
  lines.push(`$${c.name}.Controls.Add($${navVar})`);

  pages.forEach((page, i) => {
    const labelVar = `${navVar}_${page.id}`;
    const itemW = horizontal ? Math.round(c.w / Math.max(1, pages.length)) : WIZARD_VERTICAL_CONTENTS_WIDTH;
    const itemH = horizontal ? WIZARD_HORIZONTAL_CONTENTS_HEIGHT : 28;
    const x = horizontal ? i * itemW : 0;
    const y = horizontal ? 0 : i * itemH;
    lines.push(`$${labelVar} = New-Object System.Windows.Forms.Label`);
    lines.push(`$${labelVar}.Text = "${(page.label || '').replace(/"/g, '""')}"`);
    lines.push(`$${labelVar}.Location = New-Object System.Drawing.Point(${x}, ${y})`);
    lines.push(`$${labelVar}.Size = New-Object System.Drawing.Size(${itemW}, ${itemH})`);
    lines.push(`$${labelVar}.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter`);
    // Boxed gives each item a visible border (like a tab/chip); flat
    // leaves Label's default BorderStyle (None) for plain clickable text.
    if (!flat) lines.push(`$${labelVar}.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle`);
    lines.push(`$${navVar}.Controls.Add($${labelVar})`);
    navVarNames.push(labelVar);
  });

  return { lines, navVarNames };
}

// Turns one structured page requirement into a PS boolean expression -
// the picker-built equivalent of what used to be typed as raw text.
function wizardRequirementExpr(req) {
  const target = getControl(req.targetId);
  if (!target) return null;
  const cmp = WIZARD_COMPARATORS.find(c => c.id === req.comparator) || WIZARD_COMPARATORS[0];
  const kind = resolveValueWidgetKind(target.type, req.property);
  let valLiteral;
  if (kind === 'boolean') valLiteral = req.value ? '$true' : '$false';
  else if (kind === 'number') valLiteral = Number(req.value) || 0;
  else valLiteral = `"${String(req.value != null ? req.value : '').replace(/"/g, '""')}"`;
  return `$${target.name}.${req.property} ${cmp.ps} ${valLiteral}`;
}

// Generates Test-<Name>PageRequirements: per page, checks every Required
// child control plus that page's structured requirement rows (built via
// the Pages editor's control/property/comparator pickers, not raw text).
// Always emits at least one clause (a bare `default { }` when no page has
// anything to check) - an empty switch body errored out in testing.
// Gathers every requirement expression for one page - a control's own
// Required toggle, anything detected from an event handler, and the
// manual Additional Requirements list - deduped by control (a control
// counted via its toggle isn't counted again if it also happens to match
// the event-handler detection). This combined set is what
// page.requirementsMode (All/Any) actually governs, not just the manual
// list alone - a toggle-driven and a detected requirement both belong to
// the same "requirements for this page" set the user edits and combines.
// A requirement's friendly display text for the "Show message" list - an
// explicit override (wizardMessageLabel, stored on the control itself for
// toggle/detected requirements, or on the requirement row for manual ones)
// wins; otherwise falls back to the target control's own Text property,
// and finally its name. Deliberately never derived from a nearby Label
// control - matching by canvas proximity/placement is fragile.
function wizardMessageLabelFor(source, ctrl) {
  const raw = source && source.wizardMessageLabel;
  if (raw && String(raw).trim()) return String(raw).trim();
  if (ctrl.props && ctrl.props.text) return String(ctrl.props.text);
  return ctrl.name;
}

// Per-control-type event that fires on a SPECIFIC state change of that
// control's primary gate property (see WIZARD_PRIMARY_GATE_PROPERTY) -
// used only by the "Disable Next" live-tracking path (wizardShowFunctionLines
// seeding + the per-control Add_<Event> injection in CodeGen-WinForms.js).
// CheckedListBox is deliberately absent: its ItemCheck event fires BEFORE
// the check state is actually applied, so live Enabled-tracking for it is
// deferred rather than wired against stale state.
const WIZARD_GATE_EVENT_BY_TYPE = {
  CheckBox: 'CheckedChanged', RadioButton: 'CheckedChanged',
  TextBox: 'TextChanged', MaskedTextBox: 'TextChanged', RichTextBox: 'TextChanged',
  ComboBox: 'SelectedIndexChanged', ListBox: 'SelectedIndexChanged',
  NumericUpDown: 'ValueChanged', DateTimePicker: 'ValueChanged', TrackBar: 'ValueChanged',
};
function wizardGateEventForType(type) {
  return WIZARD_GATE_EVENT_BY_TYPE[type] || null;
}

// The full requirement-item list for one page - a superset of the plain
// expression list below, also carrying the target control, a stable key
// (for the Disable-Next unmet-list add/remove pattern), and the friendly
// label (for the Show-message list). One combined set regardless of how
// the requirement got here (a control's own toggle, a detected event
// handler, or the manual Additional Requirements list) - same dedup rule
// as before: a toggle-driven and a detected requirement for the same
// control only count once; the manual list is never deduped against them.
function wizardRequirementItemsForPage(wizardCtrl, page) {
  const reqChildren = state.controls.filter(ch => ch.parentId === wizardCtrl.id && ch.tabPage === page.id && ch.wizardRequired);
  const detected = wizardDetectedRequirementsForPage(wizardCtrl, page);
  const seenIds = new Set();
  const items = [];
  // Detected first: it's still the only path for a requirement that was
  // hand-wired through the ordinary Events UI rather than the Required
  // toggle - the toggle itself now carries its own Checked/Unchecked mode
  // directly (wizardRequiredMode), so it doesn't need to round-trip
  // through event-handler detection to know which one was asked for.
  detected.forEach(d => {
    seenIds.add(d.ctrl.id);
    items.push({
      key: `c${d.ctrl.id}`,
      ctrl: d.ctrl,
      expr: d.checkedRequired ? `$${d.ctrl.name}.Checked` : `-not $${d.ctrl.name}.Checked`,
      label: wizardMessageLabelFor(d.ctrl, d.ctrl),
    });
  });
  reqChildren.forEach(ch => {
    if (seenIds.has(ch.id)) return;
    seenIds.add(ch.id);
    items.push({
      key: `c${ch.id}`,
      ctrl: ch,
      expr: wizardRequiredCheckExpr(ch),
      label: wizardMessageLabelFor(ch, ch),
    });
  });
  (page.requirements || []).forEach((req, ri) => {
    const target = getControl(req.targetId);
    if (!target) return;
    const expr = wizardRequirementExpr(req);
    if (!expr) return;
    items.push({
      key: `r${ri}_${target.id}`,
      ctrl: target,
      expr,
      label: wizardMessageLabelFor(req, target),
    });
  });
  return items;
}

// Backward-compatible plain-expression list - Test-<n>PageRequirements only
// ever needed the boolean expressions, so it stays untouched, now just
// derived from the richer item list above instead of rebuilding it.
function wizardAllRequirementExprsForPage(wizardCtrl, page) {
  return wizardRequirementItemsForPage(wizardCtrl, page).map(it => it.expr);
}

function wizardTestFunctionLines(c) {
  const name = c.name;
  const pages = c.props.pages || [];
  const lines = [];
  let anyClause = false;
  lines.push(`function Test-${name}PageRequirements {`);
  lines.push(`    param([int]$Index)`);
  lines.push(`    switch ($Index) {`);
  pages.forEach((page, i) => {
    const exprs = wizardAllRequirementExprsForPage(c, page);
    if (!exprs.length) return; // nothing to check on this page - falls through to default $true
    anyClause = true;
    lines.push(`        ${i} {`);
    // "custom" mode uses the page's built token expression (grouped
    // AND/OR/parentheses) instead of a flat combine - "any" combines every
    // requirement into a single -or- expression; "all" (the default)
    // keeps one check per requirement, equivalent to ANDing them. This
    // applies uniformly across however the requirement got here (a
    // control's own toggle, a detected event handler, or the manual
    // list) - they're all one combined set now, not three separately-
    // governed ones.
    if (page.requirementsMode === 'custom' && page.customExpr && page.customExpr.length) {
      const items = wizardRequirementItemsForPage(c, page);
      lines.push(`            if (-not (${wizardCustomExprToPs(page.customExpr, items)})) { return $false }`);
    } else if (exprs.length > 1 && page.requirementsMode === 'any') {
      lines.push(`            if (-not (${exprs.map(e => `(${e})`).join(' -or ')})) { return $false }`);
    } else {
      exprs.forEach(expr => lines.push(`            if (-not (${expr})) { return $false }`));
    }
    lines.push(`        }`);
  });
  if (!anyClause) lines.push(`        default { }`);
  lines.push(`    }`);
  lines.push(`    return $true`);
  lines.push(`}`);
  return lines;
}

// Generates Get-<n>UnmetRequirementMessage: given a page index, returns the
// ready-to-show MessageBox text listing that page's currently-unmet
// requirements, or $null if everything is satisfied. Built fresh at
// Next-click time by re-evaluating each requirement's expression - "Show
// message" mode only ever needs this at the moment Next is clicked, so
// there's no need for a live-tracked list the way "Disable Next" mode uses
// (see wizardNextEnabledFunctionLines/wizardUnmetListSeedLines below).
// Header wording adapts to that page's combine mode - "any" asks for at
// least one item from the list, "all" (the default) asks for every one.
function wizardUnmetMessageFunctionLines(c) {
  const name = c.name;
  const pages = c.props.pages || [];
  const lines = [];
  let anyClause = false;
  lines.push(`function Get-${name}UnmetRequirementMessage {`);
  lines.push(`    param([int]$Index)`);
  lines.push(`    $labels = New-Object System.Collections.Generic.List[string]`);
  // Custom-combine pages can't be reduced to "here's what's unmet" - which
  // specific items still need attention depends on which OR-branch the
  // person is going for, and listing every item in the whole expression
  // regardless of whether the built logic actually needs it (e.g. all 10
  // options on a page where only 3 are wired into the expression) is
  // actively misleading. Instead, $customText holds the expression itself,
  // rendered with item labels and lowercase and/or in place of the raw
  // tokens - a fixed explanation of the rule, not a per-item runtime check.
  lines.push(`    $customText = $null`);
  lines.push(`    switch ($Index) {`);
  pages.forEach((page, i) => {
    const items = wizardRequirementItemsForPage(c, page);
    if (!items.length) return;
    anyClause = true;
    lines.push(`        ${i} {`);
    if (page.requirementsMode === 'custom' && page.customExpr && page.customExpr.length) {
      lines.push(`            $customText = "${wizardEscapePsText(wizardCustomExprToHumanText(page.customExpr, items))}"`);
    } else {
      items.forEach(it => lines.push(`            if (-not (${it.expr})) { $labels.Add("${wizardEscapePsText(it.label)}") }`));
    }
    lines.push(`        }`);
  });
  if (!anyClause) lines.push(`        default { }`);
  lines.push(`    }`);
  lines.push(`    if ($customText) {`);
  lines.push(`        return "The following must be satisfied to continue:" + [Environment]::NewLine + [Environment]::NewLine + $customText`);
  lines.push(`    }`);
  lines.push(`    if ($labels.Count -eq 0) { return $null }`);
  lines.push(`    $header = switch ($Index) {`);
  pages.forEach((page, i) => {
    if (page.requirementsMode === 'any') lines.push(`        ${i} { "1 of the following must be selected to continue:" }`);
  });
  lines.push(`        default { "All the following must be selected to continue:" }`);
  lines.push(`    }`);
  lines.push(`    return $header + [Environment]::NewLine + [Environment]::NewLine + "- " + ($labels -join ([Environment]::NewLine + "- "))`);
  lines.push(`}`);
  return lines;
}

// Pages using "Disable Next" mode (page.nextMode === 'disable') keep
// $script:<n>_UnmetN - a List[string] of that page's currently-unmet
// requirement keys - up to date live: seeded whenever the page is shown
// (this function), then kept current by each required control's own
// specific-state change event adding/removing itself
// (wizardUnmetListUpdateLines, wired in by CodeGen-WinForms.js), never by
// a blanket re-check of every requirement on every keystroke.
function wizardUnmetListSeedLines(c, page, pageIndex) {
  if (page.nextMode !== 'disable') return [];
  // Custom-combine pages don't use the incremental unmet-list mechanism at
  // all (see wizardNextEnabledFunctionLines) - nothing to seed.
  if (page.requirementsMode === 'custom') return [];
  const items = wizardRequirementItemsForPage(c, page);
  if (!items.length) return [];
  const varName = `${c.name}_Unmet${pageIndex}`;
  const lines = [`    $script:${varName} = [System.Collections.Generic.List[string]]::new()`];
  items.forEach(it => lines.push(`    if (-not (${it.expr})) { $script:${varName}.Add('${it.key}') }`));
  return lines;
}

// The snippet appended into ONE required control's own gate event
// (wizardGateEventForType) when its page is in "Disable Next" mode - adds
// or removes just this control's own key(s) (normally one, but a control
// can back more than one requirement item in rare cases - see
// wizardRequirementItemsForPage's dedup notes) from that page's unmet list
// (never a full page re-check) and asks Update-<n>NextEnabled to
// recompute Next's Enabled from the list's current state. Page-scoped by
// construction - a control only ever lives on the one page whose list
// variable name is baked in here, so there's no cross-page leakage the way
// the old direct-mirror-onto-Enabled approach had. Custom-combine pages
// skip the list entirely (see wizardNextEnabledFunctionLines) - the
// control's own event just asks Update-<n>NextEnabled to re-evaluate the
// full built expression directly.
function wizardUnmetListUpdateLines(c, page, items) {
  const pages = c.props.pages || [];
  const pageIndex = pages.indexOf(page);
  const lines = [];
  if (page.requirementsMode === 'custom') {
    lines.push(`Update-${c.name}NextEnabled`);
    return lines.join('\n    ');
  }
  const varName = `${c.name}_Unmet${pageIndex}`;
  items.forEach(item => {
    lines.push(`if (${item.expr}) { $script:${varName}.Remove('${item.key}') | Out-Null }`);
    lines.push(`elseif (-not $script:${varName}.Contains('${item.key}')) { $script:${varName}.Add('${item.key}') }`);
  });
  lines.push(`Update-${c.name}NextEnabled`);
  return lines.join('\n    ');
}

// Generates Update-<n>NextEnabled: recomputes the shared Next button's
// Enabled state from whichever page is currently showing. Pages in "Show
// message" mode (the default) always leave Next enabled - Next stays
// clickable there and Test-<n>PageRequirements/Get-<n>UnmetRequirementMessage
// handle validation on click instead. Pages in "Disable Next" mode compare
// their live unmet-list count against the page's combine mode: "all"
// requires the list empty, "any" requires at least one requirement met
// (list smaller than the full requirement count).
function wizardNextEnabledFunctionLines(c) {
  const name = c.name;
  const nextBtn = state.controls.find(ch => ch.parentId === c.id && ch.wizardFooter && ch.wizardRole === 'next');
  if (!nextBtn) return [];
  const nextBtnName = nextBtn.name;
  const pages = c.props.pages || [];
  const lines = [];
  lines.push(`function Update-${name}NextEnabled {`);
  lines.push(`    switch ($script:${name}_CurrentPage) {`);
  pages.forEach((page, i) => {
    if (page.nextMode !== 'disable') return;
    const items = wizardRequirementItemsForPage(c, page);
    if (!items.length) return;
    // Custom-combine pages evaluate the full built expression directly on
    // every gate event instead of tracking an incremental unmet-count
    // list - a grouped AND/OR/parentheses result can't be reduced to "how
    // many are unmet", so there's no shortcut list to keep in sync here.
    const cond = (page.requirementsMode === 'custom' && page.customExpr && page.customExpr.length)
      ? wizardCustomExprToPs(page.customExpr, items)
      : (page.requirementsMode === 'any'
        ? `$script:${name}_Unmet${i}.Count -lt ${items.length}`
        : `$script:${name}_Unmet${i}.Count -eq 0`);
    lines.push(`        ${i} { $${nextBtnName}.Enabled = (${cond}) }`);
  });
  lines.push(`        default { $${nextBtnName}.Enabled = $true }`);
  lines.push(`    }`);
  lines.push(`}`);
  return lines;
}

// Click-body generators for the three built-in wizard roles - always
// generated fresh from the live page count, overriding whatever is stored
// in the button's own events.Click.code (same convention as MenuStrip's
// autoAbout items).
function wizardNextClickBody(wizardCtrl) {
  const name = wizardCtrl.name;
  const lastIndex = (wizardCtrl.props.pages || []).length - 1;
  return [
    `if (-not (Test-${name}PageRequirements $script:${name}_CurrentPage)) {`,
    // "Disable Next" pages normally never reach here (Next is Enabled=$false
    // until requirements are met) - the generic fallback text only shows if
    // Next somehow got clicked anyway. "Show message" pages hit this every
    // time and get the real per-page unmet-requirements list.
    `    $msg = Get-${name}UnmetRequirementMessage $script:${name}_CurrentPage`,
    `    [System.Windows.Forms.MessageBox]::Show($(if ($msg) { $msg } else { "Please complete this page before continuing." }))`,
    `} elseif ($script:${name}_CurrentPage -ge ${lastIndex}) {`,
    `    # TODO: run your install/finish action here`,
    `    $Form.Close()`,
    `} else {`,
    `    Show-${name}Page ($script:${name}_CurrentPage + 1)`,
    `}`,
  ].join('\n    ');
}

function wizardBackClickBody(wizardCtrl) {
  const name = wizardCtrl.name;
  return `if ($script:${name}_CurrentPage -gt 0) { Show-${name}Page ($script:${name}_CurrentPage - 1) }`;
}

function wizardCancelClickBody() {
  return `$Form.Close()`;
}

function wizardNavClickBody(btnCtrl, wizardCtrl) {
  if (btnCtrl.wizardRole === 'next') return wizardNextClickBody(wizardCtrl);
  if (btnCtrl.wizardRole === 'back') return wizardBackClickBody(wizardCtrl);
  return wizardCancelClickBody();
}
