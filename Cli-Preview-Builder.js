/*
    Cli-Preview-Builder.js
    Written by: Johnathon Largent
    Version 1.0

    Revision:

    1. New file. Implements the CLI Command Preview control: a button
    that pops a modal showing a live-assembled command-line string built
    from other controls' event Actions tagged as CLI contributors.
    Mirrors the Wizard Summary-of-Tasks log's architecture (Wizard-
    Builder.js) - a fixed, build-time-computed order plus a $script:-
    scoped dictionary kept in sync by each contributing control's own
    event handler - generalized to build a command line instead of a
    log, and to reach across a Wizard's pages OR a plain Form.
*/

const CLI_PREVIEW_BUILDER_VERSION = '1.0';

// Options for the CLI Preview control's own "Pipe Output To" property -
// a handful of common cmdlets plus a Custom freeform entry.
const CLI_PIPE_CMDLETS = ['None', 'Out-GridView', 'Out-File', 'Format-Table', 'Format-List', 'Custom'];

// ---- Design-time helpers (used by Properties-Pane.js) ---------------

// Every cli-tagged action on a control, across all of its events, in a
// stable (event, then action index) order - each entry becomes one
// dictionary key at codegen time.
function cliTaggedActionEntries(ctrl) {
  const entries = [];
  if (!ctrl.events) return entries;
  Object.entries(ctrl.events).forEach(([evtName, data]) => {
    if (!data || !data.actions) return;
    data.actions.forEach((action, actionIndex) => {
      if (action.cli && action.cli.enabled && action.cli.flag) entries.push({ evtName, actionIndex, action });
    });
  });
  return entries;
}

// Renders the "Also contributes to CLI command preview" sub-editor
// appended to a single action card (Properties-Pane.js buildActionBlock),
// regardless of whether that action is snippet-bound or raw/freeform -
// the tag lives on the action itself (action.cli), independent of what
// the action's own code does.
function buildCliActionTagEditor(ctrl, action, sync) {
  if (!action.cli) action.cli = { enabled: false, flag: '', kind: 'switch' };

  const wrap = document.createElement('div');
  wrap.className = 'cli-tag-editor';

  const row = document.createElement('div');
  row.className = 'prop-row';
  const label = document.createElement('label');
  label.textContent = 'Also contributes to CLI command preview';
  label.title = 'Tags THIS action so a CLI Command Preview control elsewhere on the form (or wizard) can include a fragment built from this control\'s own state.';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = !!action.cli.enabled;
  check.addEventListener('change', () => { action.cli.enabled = check.checked; sync(); render(); });
  row.appendChild(label);
  row.appendChild(check);
  wrap.appendChild(row);

  if (action.cli.enabled) {
    const flagRow = document.createElement('div');
    flagRow.className = 'prop-row';
    flagRow.innerHTML = `<label>Flag</label>`;
    const flagInput = document.createElement('input');
    flagInput.type = 'text';
    flagInput.placeholder = '-Full';
    flagInput.value = action.cli.flag || '';
    flagInput.addEventListener('change', () => { action.cli.flag = flagInput.value; sync(); });
    flagRow.appendChild(flagInput);
    wrap.appendChild(flagRow);

    const kindRow = document.createElement('div');
    kindRow.className = 'prop-row';
    kindRow.innerHTML = `<label title="Switch: the flag appears alone, only while THIS control's own boolean state (Checked) is true. Value: the flag plus this control's own value (Text/Value/etc, based on its type) - blank values are omitted entirely.">Kind</label>`;
    const kindSel = document.createElement('select');
    ['switch', 'value'].forEach(k => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = k === 'switch' ? 'Switch' : 'Value';
      if (action.cli.kind === k) o.selected = true;
      kindSel.appendChild(o);
    });
    kindSel.addEventListener('change', () => { action.cli.kind = kindSel.value; sync(); });
    kindRow.appendChild(kindSel);
    wrap.appendChild(kindRow);
  }

  return wrap;
}

// Properties-pane row for the CLI Preview control's own "Pipe Output To"
// property - a dropdown of common cmdlets, plus a Custom freeform field.
function buildCliPipeEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'prop-row cli-pipe-editor-row';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.title = tt(key);
  wrap.appendChild(labelEl);

  const val = ctrl.props[key] || { mode: 'None', custom: '' };
  const sel = document.createElement('select');
  CLI_PIPE_CMDLETS.forEach(cmd => {
    const o = document.createElement('option');
    o.value = cmd;
    o.textContent = cmd;
    if (val.mode === cmd) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => { val.mode = sel.value; ctrl.props[key] = val; render(); });
  wrap.appendChild(sel);

  if (val.mode === 'Custom') {
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Custom-Cmdlet';
    customInput.value = val.custom || '';
    customInput.addEventListener('change', () => { val.custom = customInput.value; ctrl.props[key] = val; render(); });
    wrap.appendChild(customInput);
  }

  return wrap;
}

// ---- Codegen helpers (used by CodeGen-WinForms.js) -------------------

// Walks up the parent chain to find the nearest Wizard ancestor of a
// control, or null if it isn't inside one (e.g. sitting directly on the
// Form).
function cliFindHostWizard(ctrl) {
  let cur = ctrl;
  while (cur && cur.parentId) {
    const parent = getControl(cur.parentId);
    if (!parent) break;
    if (CONTROL_DEFS[parent.type] && CONTROL_DEFS[parent.type].isWizard) return parent;
    cur = parent;
  }
  return null;
}

// Ordered list of every cli-tagged action reachable by one CLI Preview
// control: if it lives inside a Wizard, spans ALL of that wizard's pages
// (fixed page order, then top-left-to-bottom-right within a page) - the
// same convention as wizardLogTargetOrderedControlNames (Wizard-
// Builder.js), just generalized from "has a log action" to "has a
// cli-tagged action" and keeping the action entries themselves (a
// control can contribute more than one flag). Otherwise, every
// top-level control directly on the Form, in the same Y-then-X order.
// Only direct children of the wizard/page (or the Form) are scanned,
// matching the Summary log's own scoping - a cli-tagged action inside a
// nested Panel/GroupBox isn't reached, same limitation as that feature.
function cliOrderedContributors(previewCtrl) {
  const wizard = cliFindHostWizard(previewCtrl);
  const results = [];
  const collectFrom = (controlsList) => {
    controlsList.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    controlsList.forEach(ch => {
      cliTaggedActionEntries(ch).forEach(entry => results.push({ ctrl: ch, ...entry }));
    });
  };
  if (wizard) {
    const pages = wizard.props.pages || [];
    pages.forEach(page => {
      collectFrom(state.controls.filter(ch => ch.parentId === wizard.id && ch.tabPage === page.id && !ch.wizardFooter));
    });
  } else {
    collectFrom(state.controls.filter(ch => !ch.parentId));
  }
  return results;
}

// Which property of $ThisControl holds its contributed value, per
// control type - same "Text for TextBox/ComboBox/Label, Value for
// numeric, Checked for booleans" convention already used by the
// readValue snippet (Properties-Pane.js EVENT_SNIPPETS).
function cliValuePropertyForType(type) {
  if (['TextBox', 'MaskedTextBox', 'RichTextBox', 'ComboBox', 'Label', 'LinkLabel'].includes(type)) return 'Text';
  if (['NumericUpDown', 'TrackBar', 'ProgressBar', 'DateTimePicker'].includes(type)) return 'Value';
  if (['CheckBox', 'RadioButton'].includes(type)) return 'Checked';
  return 'Text';
}

// The PowerShell lines that keep one $script:<Preview>_Args entry in
// sync with this control's current state for a single cli-tagged
// action - Switch sets/removes a bare flag based on $ThisControl.Checked;
// Value sets/removes "flag value" based on whether the control's own
// value property is blank (numeric/date properties are never blank, so
// those are always included once the control exists).
function cliArgAssignmentLines(ctrl, flag, key, kind, previewVar) {
  const escapedFlag = flag.replace(/"/g, '""').replace(/'/g, "''");
  if (kind === 'switch') {
    return [
      `if ($ThisControl.Checked) {`,
      `    $script:${previewVar}_Args['${key}'] = '${escapedFlag}'`,
      `} else {`,
      `    $script:${previewVar}_Args.Remove('${key}')`,
      `}`,
    ].join('\n');
  }
  const prop = cliValuePropertyForType(ctrl.type);
  if (prop === 'Text') {
    return [
      `if ([string]::IsNullOrWhiteSpace($ThisControl.Text)) {`,
      `    $script:${previewVar}_Args.Remove('${key}')`,
      `} else {`,
      `    $script:${previewVar}_Args['${key}'] = '${escapedFlag} ' + $ThisControl.Text`,
      `}`,
    ].join('\n');
  }
  return `$script:${previewVar}_Args['${key}'] = '${escapedFlag} ' + $ThisControl.${prop}`;
}

// The CLI Preview control's own Click handler: rebuilds the command
// string fresh from $script:<Name>_Args (in $script:<Name>_ArgsOrder
// order) and shows it in a small popout. This is a snapshot by design -
// the popout closes the instant the person clicks outside it (Deactivate
// -> Close), so there is no case where it needs to keep redrawing while
// they interact with controls behind it.
function cliPreviewClickHandlerLines(c, p) {
  const baseCmd = (p.baseCommand || '').replace(/"/g, '""');
  const pipe = p.pipeCmdlet || { mode: 'None', custom: '' };
  const pipeName = pipe.mode === 'Custom' ? (pipe.custom || '') : pipe.mode;
  const pipeSuffix = (pipeName && pipeName !== 'None') ? ` | ${pipeName}`.replace(/"/g, '\\"') : '';

  const lines = [];
  lines.push(`$${c.name}.Add_Click({`);
  lines.push(`    param($sender, $e)`);
  lines.push(`    $cliParts = @()`);
  lines.push(`    foreach ($key in $script:${c.name}_ArgsOrder) {`);
  lines.push(`        if ($script:${c.name}_Args.ContainsKey($key)) { $cliParts += $script:${c.name}_Args[$key] }`);
  lines.push(`    }`);
  lines.push(`    $cliCommand = "${baseCmd}"`);
  lines.push(`    if ($cliParts.Count -gt 0) { $cliCommand = $cliCommand + ' ' + ($cliParts -join ' ') }`);
  if (pipeSuffix) lines.push(`    $cliCommand = $cliCommand + "${pipeSuffix}"`);
  lines.push(`    $cliModal = New-Object System.Windows.Forms.Form`);
  lines.push(`    $cliModal.Text = "Command Preview"`);
  lines.push(`    $cliModal.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog`);
  lines.push(`    $cliModal.StartPosition = "CenterParent"`);
  lines.push(`    $cliModal.ShowInTaskbar = $false`);
  lines.push(`    $cliModal.MinimizeBox = $false`);
  lines.push(`    $cliModal.MaximizeBox = $false`);
  lines.push(`    $cliModal.ClientSize = New-Object System.Drawing.Size(420, 90)`);
  lines.push(`    $cliText = New-Object System.Windows.Forms.TextBox`);
  lines.push(`    $cliText.Location = New-Object System.Drawing.Point(10, 10)`);
  lines.push(`    $cliText.Size = New-Object System.Drawing.Size(400, 22)`);
  lines.push(`    $cliText.ReadOnly = $true`);
  lines.push(`    $cliText.Text = $cliCommand`);
  lines.push(`    $cliModal.Controls.Add($cliText)`);
  lines.push(`    $cliCopyBtn = New-Object System.Windows.Forms.Button`);
  lines.push(`    $cliCopyBtn.Location = New-Object System.Drawing.Point(10, 42)`);
  lines.push(`    $cliCopyBtn.Size = New-Object System.Drawing.Size(130, 25)`);
  lines.push(`    $cliCopyBtn.Text = "Copy to Clipboard"`);
  lines.push(`    $cliCopyBtn.Add_Click({ [System.Windows.Forms.Clipboard]::SetText($cliText.Text) }.GetNewClosure())`);
  lines.push(`    $cliModal.Controls.Add($cliCopyBtn)`);
  lines.push(`    $cliModal.Add_Deactivate({ $cliModal.Close() }.GetNewClosure())`);
  lines.push(`    $cliModal.Show($sender.FindForm())`);
  lines.push(`})`);
  return lines;
}
