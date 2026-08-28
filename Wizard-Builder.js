/*
    Wizard-Builder.js
    Written by: Johnathon Largent
    Version 1.1

    Revision:

    1. Fixed Test-<Name>PageRequirements generating a switch statement
    with zero clauses (errored out) when no page had any Required
    control or custom validation - now always emits at least a
    `default { }` clause.

    2. Footer buttons repositioned (Back left-of-center, Next center,
    Cancel right) and anchored (Bottom, Left/Right) instead of fixed
    Top-Left, so they track the bottom edge - including on a Dock=Fill
    resize (paired with the Engine.js anchor-cascade fix) - instead of
    staying stuck near their original creation-time position.

    3. Added the Wizard's Contents nav (buildWizardContentsNav, for
    Render.js) and wizardContentBounds() (for Engine.js's docking/clamp
    math) supporting the new Horizontal/Vertical step-list styles, plus
    matching WinForms codegen (wizardContentsNavCodegenLines) that
    generates a real nav Panel of Labels, bolded by Show-<Name>Page.
*/

const WIZARD_BUILDER_VERSION = '1.1';

const WIZARD_HORIZONTAL_CONTENTS_HEIGHT = 32;
const WIZARD_VERTICAL_CONTENTS_WIDTH = 140;

// The area available to a wizard's PAGE content (not its always-visible
// footer, which always spans the full control) - shrunk to make room for
// the optional Horizontal/Vertical Contents nav strip, same idea as
// TAB_HEADER_HEIGHT for TabControl.
function wizardContentBounds(c) {
  const cs = c.props.contentsStyle;
  let w = c.w, h = c.h;
  if (cs === 'Horizontal') h = Math.max(1, h - WIZARD_HORIZONTAL_CONTENTS_HEIGHT);
  else if (cs === 'Vertical') w = Math.max(1, w - WIZARD_VERTICAL_CONTENTS_WIDTH);
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

function createWizardFromSetup(pageConfigs, x, y, parentId, tabPage) {
  const ctrl = createControl('Wizard', x, y, parentId, tabPage);
  ctrl.props.pages = pageConfigs.map(pc => ({
    id: 'page' + Math.random().toString(36).slice(2, 8),
    label: pc.label || 'Page',
    template: pc.template || 'blank',
    validation: '',
  }));
  ctrl.activeTabId = ctrl.props.pages[0].id;
  ctrl.props.pages.forEach(page => populateWizardPageTemplate(ctrl, page));
  createWizardFooterButtons(ctrl);
  return ctrl;
}

/* =========================================================================
   Guided setup modal (shown on drop / double-click of the Wizard tool)
   ========================================================================= */

let wizardSetupPending = null; // { x, y, parentId, tabPage } for the drop currently being configured

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
        <div class="items-hint" style="margin-bottom:8px;">Choose the pages for this wizard. You can add, rename, reorder, or remove pages later from the Pages editor.</div>
        <div id="wizardSetupPagesList"></div>
        <div class="wizard-setup-add-row">
          <select id="wizardSetupAddTemplate">
            <option value="blank">Blank</option>
            <option value="welcome">Welcome</option>
            <option value="options">Options</option>
            <option value="summary">Summary</option>
          </select>
          <button type="button" class="btn btn-ghost" id="wizardSetupAddBtn">+ Add page</button>
        </div>
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
    const tpl = document.getElementById('wizardSetupAddTemplate').value;
    wizardSetupDraftPages.push({ label: WIZARD_TEMPLATE_LABELS[tpl] || 'Page', template: tpl });
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
    row.className = 'tab-editor-item';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'menu-editor-label-input';
    nameInput.value = page.label;
    nameInput.addEventListener('change', (e) => { page.label = e.target.value.trim() || page.label; });

    const tplBadge = document.createElement('span');
    tplBadge.className = 'menu-editor-tag';
    tplBadge.textContent = WIZARD_TEMPLATE_LABELS[page.template] || page.template;

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

    row.appendChild(nameInput);
    row.appendChild(tplBadge);
    row.appendChild(delBtn);
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

  const addRow = document.createElement('div');
  addRow.className = 'wizard-setup-add-row';
  const tplSelect = document.createElement('select');
  Object.keys(WIZARD_TEMPLATE_LABELS).forEach(k => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = WIZARD_TEMPLATE_LABELS[k];
    tplSelect.appendChild(opt);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost tab-add-btn';
  addBtn.textContent = '+ Add page';
  addBtn.title = 'Add a new wizard page, optionally pre-filled from a starter template.';
  addBtn.addEventListener('click', () => {
    const newPage = { id: 'page' + Math.random().toString(36).slice(2, 8), label: 'Page' + (pages.length + 1), template: tplSelect.value, validation: '' };
    pages.push(newPage);
    populateWizardPageTemplate(ctrl, newPage);
    render();
  });
  addRow.appendChild(tplSelect);
  addRow.appendChild(addBtn);
  wrap.appendChild(addRow);

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

  const tplBadge = document.createElement('span');
  tplBadge.className = 'menu-editor-tag';
  tplBadge.title = 'The starter template this page was created from - informational only, does not change existing content.';
  tplBadge.textContent = WIZARD_TEMPLATE_LABELS[page.template] || page.template;

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
  topRow.appendChild(tplBadge);
  topRow.appendChild(selectBtn);
  topRow.appendChild(delBtn);
  outer.appendChild(topRow);

  const valRow = document.createElement('div');
  valRow.className = 'wizard-page-validation-row';
  valRow.innerHTML = `<label title="Optional PowerShell boolean expression checked (in addition to any Required controls on this page) before Next is allowed to proceed. Must evaluate to $true. Example: $NumericUpDown1.Value -gt 0">Custom validation (optional)</label><textarea placeholder="e.g. $TextBox1.Text.Length -gt 3">${escapeHtml(page.validation || '')}</textarea>`;
  valRow.querySelector('textarea').addEventListener('change', (e) => { page.validation = e.target.value; });
  outer.appendChild(valRow);

  return outer;
}

/* =========================================================================
   Per-child "Wizard Page" property rows - shown in the properties pane for
   any control whose parent is a Wizard.
   ========================================================================= */

const WIZARD_REQUIRED_SUPPORTED_TYPES = [
  'CheckBox', 'RadioButton', 'TextBox', 'MaskedTextBox', 'RichTextBox',
  'ComboBox', 'ListBox', 'CheckedListBox', 'NumericUpDown', 'DateTimePicker',
];

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
  footerRow.className = 'prop-row';
  const footerDisabled = !!ctrl.wizardRole;
  footerRow.innerHTML = `<label title="When on, this control shows on every page instead of just the page it was placed on - used for footer buttons, step counters, etc.">Show on all pages (footer)</label><input type="checkbox" ${ctrl.wizardFooter ? 'checked' : ''} ${footerDisabled ? 'disabled' : ''}>`;
  footerRow.querySelector('input').addEventListener('change', (e) => {
    ctrl.wizardFooter = e.target.checked;
    ctrl.tabPage = ctrl.wizardFooter ? null : parentCtrl.activeTabId;
    render();
  });
  frag.appendChild(footerRow);

  if (!ctrl.wizardFooter && WIZARD_REQUIRED_SUPPORTED_TYPES.includes(ctrl.type)) {
    const reqRow = document.createElement('div');
    reqRow.className = 'prop-row';
    reqRow.innerHTML = `<label title="If on, the wizard won't let the user click Next off this page until this control is satisfied (checked, non-empty, or a real selection, depending on type).">Required before Next</label><input type="checkbox" ${ctrl.wizardRequired ? 'checked' : ''}>`;
    reqRow.querySelector('input').addEventListener('change', (e) => { ctrl.wizardRequired = e.target.checked; render(); });
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
  const pages = c.props.pages || [];
  const nav = document.createElement('div');
  nav.className = cs === 'Horizontal' ? 'wizard-nav-horizontal' : 'wizard-nav-vertical';
  pages.forEach(page => {
    const item = document.createElement('div');
    item.className = 'wizard-nav-item' + (page.id === c.activeTabId ? ' active' : '');
    item.textContent = page.label;
    item.title = 'Click to switch to this page while designing.';
    item.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      c.activeTabId = page.id;
      selectControl(c.id);
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
  if (backBtn) lines.push(`    $${backBtn.name}.Enabled = ($Index -gt 0)`);
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
  const pages = c.props.pages || [];
  const name = c.name;
  const navVar = `${name}_Nav`;
  const lines = [];
  const navVarNames = [];

  lines.push(`$${navVar} = New-Object System.Windows.Forms.Panel`);
  if (cs === 'Horizontal') {
    lines.push(`$${navVar}.Location = New-Object System.Drawing.Point(0, 0)`);
    lines.push(`$${navVar}.Size = New-Object System.Drawing.Size(${c.w}, ${WIZARD_HORIZONTAL_CONTENTS_HEIGHT})`);
  } else {
    lines.push(`$${navVar}.Location = New-Object System.Drawing.Point(0, 0)`);
    lines.push(`$${navVar}.Size = New-Object System.Drawing.Size(${WIZARD_VERTICAL_CONTENTS_WIDTH}, ${c.h})`);
  }
  lines.push(`$${navVar}.BackColor = [System.Drawing.Color]::FromArgb(236,236,236)`);
  lines.push(`$${c.name}.Controls.Add($${navVar})`);

  pages.forEach((page, i) => {
    const labelVar = `${navVar}_${page.id}`;
    const itemW = cs === 'Horizontal' ? Math.round(c.w / Math.max(1, pages.length)) : WIZARD_VERTICAL_CONTENTS_WIDTH;
    const itemH = cs === 'Horizontal' ? WIZARD_HORIZONTAL_CONTENTS_HEIGHT : 28;
    const x = cs === 'Horizontal' ? i * itemW : 0;
    const y = cs === 'Horizontal' ? 0 : i * itemH;
    lines.push(`$${labelVar} = New-Object System.Windows.Forms.Label`);
    lines.push(`$${labelVar}.Text = "${(page.label || '').replace(/"/g, '""')}"`);
    lines.push(`$${labelVar}.Location = New-Object System.Drawing.Point(${x}, ${y})`);
    lines.push(`$${labelVar}.Size = New-Object System.Drawing.Size(${itemW}, ${itemH})`);
    lines.push(`$${labelVar}.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter`);
    lines.push(`$${navVar}.Controls.Add($${labelVar})`);
    navVarNames.push(labelVar);
  });

  return { lines, navVarNames };
}

// Generates Test-<Name>PageRequirements: per page, checks every Required
// child control plus that page's optional custom validation expression.
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
    const customExpr = (page.validation || '').trim();
    if (!reqChildren.length && !customExpr) return; // nothing to check on this page - falls through to default $true
    anyClause = true;
    lines.push(`        ${i} {`);
    reqChildren.forEach(ch => lines.push(`            if (-not (${wizardRequiredCheckExpr(ch)})) { return $false }`));
    if (customExpr) lines.push(`            if (-not (${customExpr})) { return $false }`);
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
