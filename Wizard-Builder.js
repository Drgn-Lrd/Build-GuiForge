/*
    Wizard-Builder.js
    Written by: Johnathon Largent
    Version 1.8

    Revision:

    1. Made the Required/Additional-Requirements/Events-handler
    relationship for boolean-kind (Checked) controls genuinely
    bidirectional instead of the one-way (event -> detected requirement)
    version from the previous revision. New single mutator
    wizardSyncBooleanGate(wizardCtrl, targetCtrl, required) is now what
    the "Required before Next" toggle and "+ Add requirement" (when only
    boolean-kind controls exist on the page) both call - it sets
    wizardRequired AND writes/removes the actual CheckedChanged event
    action (mirrorChecked targeting Next), so flipping either one updates
    the other two, since the Pages editor's detected-requirements scan
    picks up whatever the event action says on every render regardless
    of which path wrote it. Retargeting a comparator-based requirement
    row to a boolean-kind control now converts it into a synced gate
    instead of leaving two separate representations of the same thing.
    Removed the "Also detected from..." note - the toggle itself is the
    truth now, so there's nothing left to separately explain.
*/

const WIZARD_BUILDER_VERSION = '1.8';

const WIZARD_HORIZONTAL_CONTENTS_HEIGHT = 32;
const WIZARD_VERTICAL_CONTENTS_WIDTH = 140;

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
const WIZARD_TEMPLATES = {
  blank: [],
  welcome: [
    { type: 'Label', x: 20, y: 20, w: 380, h: 26, props: { text: 'Welcome to Setup', fontSize: 14, fontBold: true } },
    { type: 'Label', x: 20, y: 54, w: 380, h: 80, props: { text: 'This wizard will guide you through the setup process. Click Next to continue.' } },
  ],
  options: [
    { type: 'CheckBox', x: 20, y: 20, w: 200, h: 22, props: { text: 'Option A' } },
    { type: 'CheckBox', x: 20, y: 46, w: 200, h: 22, props: { text: 'Option B' } },
  ],
  summary: [
    { type: 'Label', x: 20, y: 20, w: 380, h: 22, props: { text: 'Review your choices, then click Finish.' } },
    { type: 'RichTextBox', x: 20, y: 48, w: 380, h: 140, props: { text: '' } },
  ],
};

const WIZARD_TEMPLATE_LABELS = { blank: 'Blank', welcome: 'Welcome', options: 'Options', summary: 'Summary' };

function populateWizardPageTemplate(wizardCtrl, page) {
  const specs = WIZARD_TEMPLATES[page.template] || [];
  specs.forEach(spec => {
    const child = createControl(spec.type, spec.x, spec.y, wizardCtrl.id, page.id);
    child.w = spec.w; child.h = spec.h;
    Object.entries(spec.props || {}).forEach(([k, v]) => { child.props[k] = v; });
  });
}

/* =========================================================================
   Footer buttons (Back / Next / Cancel) - real Button controls, always
   visible regardless of which page is active (wizardFooter = true), tagged
   with wizardRole so codegen can auto-generate their navigation code.
   ========================================================================= */

function createWizardFooterButtons(wizardCtrl) {
  const y = wizardCtrl.h - 46;
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
    btn.w = btnW;
    btn.props.text = spec.text;
    btn.props.anchor = spec.anchor;
    btn.wizardFooter = true;
    btn.wizardRole = spec.role;
    btn.events.Click = { fn: `${btn.name}_Click`, code: '# Auto-generated wizard navigation (see generated code) - clear Wizard Role above to write your own.', ps1: '' };
  });
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
    wizardSetupDraftPages.push({ label: 'Page' + (wizardSetupDraftPages.length + 1), template: 'blank' });
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
    tplSelect.addEventListener('change', (e) => { page.template = e.target.value; });
    tplRow.appendChild(tplSelect);
    row.appendChild(tplRow);

    list.appendChild(row);
  });
}

function openWizardSetupModal(x, y, parentId, tabPage) {
  wizardSetupPending = { x, y, parentId, tabPage };
  wizardSetupDraftPages = [
    { label: 'Welcome', template: 'welcome' },
    { label: 'Options', template: 'options' },
    { label: 'Summary', template: 'summary' },
  ];
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
  addBtn.title = 'Add a new blank wizard page - pick a starter template from the new page\'s own Template dropdown afterward, if you want one.';
  addBtn.addEventListener('click', () => {
    const label = 'Page' + (pages.length + 1);
    const id = wizardGeneratePageId(label, pages.map(p => p.id));
    pages.push({ id, label, template: 'blank', requirements: [] });
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
    page.template = e.target.value;
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
  detected.forEach(d => reqWrap.appendChild(buildWizardDetectedRequirementRow(d)));

  if (!page.requirements) page.requirements = [];
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
    addReqBtn.title = 'For a checkbox-like control, use its own "Required before Next" toggle instead - it stays in sync with this list automatically. This button is for comparator-based requirements (numeric/text controls) that don\'t have an equivalent toggle.';
    addReqBtn.addEventListener('click', () => {
      // A boolean-kind (Checked) target is better served by its own
      // Required toggle - which keeps this list AND the event handler in
      // sync automatically - so prefer a non-boolean target here and only
      // fall back to syncing a boolean one directly if nothing else exists.
      const nonBoolTarget = pageControls.find(c => resolveValueWidgetKind(c.type, wizardPrimaryGateProperty(c.type)) !== 'boolean');
      if (nonBoolTarget) {
        page.requirements.push({ targetId: nonBoolTarget.id, property: wizardPrimaryGateProperty(nonBoolTarget.type), comparator: 'eq', value: 0 });
      } else {
        const notYetRequired = pageControls.find(c => !c.wizardRequired);
        if (notYetRequired) wizardSyncBooleanGate(ctrl, notYetRequired, true);
      }
      render();
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
        page.requirements.splice(ri, 1);
        wizardSyncBooleanGate(ctrl, picked, true);
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

  return row;
}

// Read-only row for a requirement detected from an existing event handler
// (see wizardDetectedRequirementsForPage) - shown alongside the editable
// ones above, but not deletable here since there's nothing to delete: it
// goes away on its own if the handler that created it does.
function buildWizardDetectedRequirementRow(detected) {
  const row = document.createElement('div');
  row.className = 'wizard-requirement-row wizard-requirement-row-detected';
  const text = document.createElement('div');
  text.className = 'wizard-requirement-detected-text';
  text.textContent = `${detected.ctrl.name} must be ${detected.checkedRequired ? 'Checked' : 'Unchecked'}`;
  text.title = `Detected from ${detected.ctrl.name}'s own CheckedChanged handler (it already enables/disables the wizard's Next button directly) - not something to configure here separately.`;
  const badge = document.createElement('span');
  badge.className = 'menu-editor-tag';
  badge.textContent = 'from event handler';
  row.appendChild(text);
  row.appendChild(badge);
  return row;
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
// this, so all three (toggle, Additional Requirements list, and the
// control's own CheckedChanged handler) always agree with each other
// instead of being three independent paths to roughly the same effect.
// Writing/removing the actual event action is what wizardDetectNextGate
// picks back up on the next render, closing the loop.
function wizardSyncBooleanGate(wizardCtrl, targetCtrl, required) {
  targetCtrl.wizardRequired = required;
  const nextBtn = state.controls.find(ch => ch.parentId === wizardCtrl.id && ch.wizardFooter && ch.wizardRole === 'next');
  if (!nextBtn) return;

  const existing = targetCtrl.events && targetCtrl.events.CheckedChanged;
  const actions = (existing && existing.actions) ? existing.actions.slice() : [];
  const idx = actions.findIndex(a => (a.snippetId === 'mirrorChecked' || a.snippetId === 'mirrorUnchecked') && a.params && a.params.target === nextBtn.name);

  if (required) {
    const snippet = EVENT_SNIPPETS.find(s => s.id === 'mirrorChecked');
    const params = { target: nextBtn.name };
    const action = { snippetId: 'mirrorChecked', params, code: computeSnippetCode(snippet, params) };
    if (idx >= 0) actions[idx] = action; else actions.push(action);
  } else if (idx >= 0) {
    actions.splice(idx, 1);
  }

  if (!targetCtrl.events) targetCtrl.events = {};
  if (actions.length) {
    targetCtrl.events.CheckedChanged = {
      fn: (existing && existing.fn) || `${targetCtrl.name}_CheckedChanged`,
      ps1: (existing && existing.ps1) || '',
      code: actions.map(a => a.code).join('\n\n'),
      actions,
    };
  } else if (existing) {
    delete targetCtrl.events.CheckedChanged;
  }
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
      ? 'If on, the wizard won\'t let the user click Next off this page until this control is checked - also wires (or removes) a CheckedChanged handler that enables Next directly, so this toggle, the Additional Requirements list, and the Events section all stay in agreement.'
      : 'If on, the wizard won\'t let the user click Next off this page until this control is satisfied (non-empty or a real selection, depending on type).';
    reqRow.innerHTML = `<span class="toggle-label">Required before Next</span><label class="switch"><input type="checkbox" ${ctrl.wizardRequired ? 'checked' : ''}><span class="track"></span></label>`;
    reqRow.querySelector('input').addEventListener('change', (e) => {
      if (kind === 'boolean') wizardSyncBooleanGate(parentCtrl, ctrl, e.target.checked);
      else ctrl.wizardRequired = e.target.checked;
      render();
    });
    frag.appendChild(reqRow);
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
      return `$${ctrl.name}.Checked`;
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
function wizardShowFunctionLines(c, pageVarNames, navVarNames) {
  const name = c.name;
  const footerBtns = state.controls.filter(ch => ch.parentId === c.id && ch.wizardFooter);
  const nextBtn = footerBtns.find(b => b.wizardRole === 'next');
  const backBtn = footerBtns.find(b => b.wizardRole === 'back');
  const lines = [];
  lines.push(`function Show-${name}Page {`);
  lines.push(`    param([int]$Index)`);
  lines.push(`    $pages = @(${pageVarNames.map(v => '$' + v).join(', ')})`);
  lines.push(`    for ($i = 0; $i -lt $pages.Count; $i++) { $pages[$i].Visible = ($i -eq $Index) }`);
  lines.push(`    $script:${name}_CurrentPage = $Index`);
  if (nextBtn) lines.push(`    $${nextBtn.name}.Text = if ($Index -eq ($pages.Count - 1)) { "Finish" } else { "Next" }`);
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
function wizardTestFunctionLines(c) {
  const name = c.name;
  const pages = c.props.pages || [];
  const lines = [];
  let anyClause = false;
  lines.push(`function Test-${name}PageRequirements {`);
  lines.push(`    param([int]$Index)`);
  lines.push(`    switch ($Index) {`);
  pages.forEach((page, i) => {
    const reqChildren = state.controls.filter(ch => ch.parentId === c.id && ch.tabPage === page.id && ch.wizardRequired);
    const detected = wizardDetectedRequirementsForPage(c, page);
    const extraReqs = (page.requirements || []).map(wizardRequirementExpr).filter(Boolean);
    if (!reqChildren.length && !detected.length && !extraReqs.length) return; // nothing to check on this page - falls through to default $true
    anyClause = true;
    lines.push(`        ${i} {`);
    const seenIds = new Set();
    reqChildren.forEach(ch => {
      seenIds.add(ch.id);
      lines.push(`            if (-not (${wizardRequiredCheckExpr(ch)})) { return $false }`);
    });
    // Detected requirements come from a control's own CheckedChanged
    // handler (Enable/Disable Next while checked, via the ordinary Events
    // UI) - skip one already counted above via the Required toggle so the
    // same control isn't checked twice in the generated code.
    detected.forEach(d => {
      if (seenIds.has(d.ctrl.id)) return;
      seenIds.add(d.ctrl.id);
      const expr = d.checkedRequired ? `$${d.ctrl.name}.Checked` : `-not $${d.ctrl.name}.Checked`;
      lines.push(`            if (-not (${expr})) { return $false }`);
    });
    extraReqs.forEach(expr => lines.push(`            if (-not (${expr})) { return $false }`));
    lines.push(`        }`);
  });
  if (!anyClause) lines.push(`        default { }`);
  lines.push(`    }`);
  lines.push(`    return $true`);
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
    `    [System.Windows.Forms.MessageBox]::Show("Please complete this page before continuing.")`,
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
