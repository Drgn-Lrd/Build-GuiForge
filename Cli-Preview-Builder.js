/*
    Cli-Preview-Builder.js
    Written by: Johnathon Largent
    Version 1.1

    Revision:

    1. Removed the Run CLI Command on Click feature added in 1.0's
    initial draft (cliRunInvocationLines and its call sites) - out of
    scope. CliPreview is a pure display control, the same role as the
    Wizard's Summary-of-Tasks log: it shows the assembled command-line
    string, it does not execute anything, now or as a future option.
    Renamed the "aggregator" terminology back to "preview" throughout
    now that there's only ever one kind of thing building this string.
*/

const CLI_PREVIEW_BUILDER_VERSION = '1.1';

// ---- Design-time helpers (used by Properties-Pane.js) ---------------

// Every cli-tagged action on a control, across all of its events, in a
// stable (event, then action index) order - each entry becomes one
// dictionary key at codegen time. A Flag is required for Switch kind
// (the flag IS the whole contribution), but optional for Value kind - a
// blank Flag there is a deliberate way to contribute just a control's
// own raw value with nothing prepended (e.g. a TextBox sitting right
// after a CheckBox that already supplied the flag).
function cliTaggedActionEntries(ctrl) {
  const entries = [];
  if (!ctrl.events) return entries;
  Object.entries(ctrl.events).forEach(([evtName, data]) => {
    if (!data || !data.actions) return;
    data.actions.forEach((action, actionIndex) => {
      if (action.cli && action.cli.enabled && (action.cli.kind === 'value' || action.cli.flag)) {
        entries.push({ evtName, actionIndex, action });
      }
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
    const kindRow = document.createElement('div');
    kindRow.className = 'prop-row';
    kindRow.innerHTML = `<label title="Switch: the Flag text appears alone, only while THIS control's own boolean state (Checked) is true - use for a command verb, a bare flag, or any other literal fragment. Value: the Flag text (if any) plus this control's own value (Text/Value/etc, based on its type) - leave Flag blank to contribute just the raw value on its own; blank VALUES are omitted entirely.">Kind</label>`;
    const kindSel = document.createElement('select');
    ['switch', 'value'].forEach(k => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = k === 'switch' ? 'Switch' : 'Value';
      if (action.cli.kind === k) o.selected = true;
      kindSel.appendChild(o);
    });
    kindSel.addEventListener('change', () => { action.cli.kind = kindSel.value; sync(); render(); });
    kindRow.appendChild(kindSel);
    wrap.appendChild(kindRow);

    const flagRow = document.createElement('div');
    flagRow.className = 'prop-row';
    flagRow.innerHTML = `<label>Flag${action.cli.kind === 'value' ? ' (optional)' : ''}</label>`;
    const flagInput = document.createElement('input');
    flagInput.type = 'text';
    flagInput.placeholder = action.cli.kind === 'value' ? '-Name (leave blank for a bare value)' : '-Full';
    flagInput.value = action.cli.flag || '';
    flagInput.addEventListener('change', () => { action.cli.flag = flagInput.value; sync(); });
    flagRow.appendChild(flagInput);
    wrap.appendChild(flagRow);
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
// control. A Wizard is a special case ON PURPOSE: its pages are
// cumulative steps the person walks through in sequence (options on
// page 1, more on page 2, etc.), so a wizard-hosted Preview spans ALL
// of that wizard's pages, fixed page order then top-left-to-bottom-
// right within a page - same convention as
// wizardLogTargetOrderedControlNames (Wizard-Builder.js).
// Everywhere else - the Form itself, a Panel/GroupBox, or one page of a
// plain TabControl - a Preview only ever sees its OWN immediate
// container's siblings (same parentId, and same tabPage when that
// parent is a TabControl). A TabControl's tabs are independent views a
// person can switch between at will, not sequential steps, so pulling
// in another tab's controls would silently include state the person
// may never have looked at; scoping to the exact container the Preview
// itself sits in - matching by construction, since the Preview can only
// be seen/clicked while its own tab/panel is showing - avoids that
// without needing any runtime "which tab is active" check. Only direct
// children of the wizard/page (or the Preview's own immediate parent)
// are scanned, matching the Summary log's own scoping - a cli-tagged
// action inside a nested Panel/GroupBox one level further down isn't
// reached, same limitation as that feature.
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
    collectFrom(state.controls.filter(ch => ch.parentId === previewCtrl.parentId && ch.tabPage === previewCtrl.tabPage));
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
// Value sets/removes "flag value" (or just "value" when Flag is blank)
// based on whether the control's own value property is blank
// (numeric/date properties are never blank, so those are always
// included once the control exists).
function cliArgAssignmentLines(ctrl, flag, key, kind, previewVar) {
  const escapedFlag = (flag || '').replace(/"/g, '""').replace(/'/g, "''");
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
  const prefix = escapedFlag ? `'${escapedFlag} ' + ` : '';
  if (prop === 'Text') {
    return [
      `if ([string]::IsNullOrWhiteSpace($ThisControl.Text)) {`,
      `    $script:${previewVar}_Args.Remove('${key}')`,
      `} else {`,
      `    $script:${previewVar}_Args['${key}'] = ${prefix}$ThisControl.Text`,
      `}`,
    ].join('\n');
  }
  return `$script:${previewVar}_Args['${key}'] = ${prefix}$ThisControl.${prop}`;
}

// The CLI Preview control's own Click handler: rebuilds the command
// string fresh from $script:<Name>_Args (in $script:<Name>_ArgsOrder
// order) and shows it in a standard blocking dialog (ShowDialog, not
// Show) - same "stays open until you deal with it" behavior as any
// ordinary "Save changes?" prompt, never a click-outside-to-dismiss
// popup. The Close button's DialogResult is set directly rather than
// wired through its own Add_Click, so ShowDialog() returns/closes on
// click with no extra nested handler needed for it. Purely a display -
// the same role as the Wizard's Summary-of-Tasks log - it never
// executes $cliCommand.
function cliPreviewClickHandlerLines(c) {
  const lines = [];
  lines.push(`$${c.name}.Add_Click({`);
  lines.push(`    param($sender, $e)`);
  lines.push(`    $cliParts = @()`);
  lines.push(`    foreach ($key in $script:${c.name}_ArgsOrder) {`);
  lines.push(`        if ($script:${c.name}_Args.ContainsKey($key)) { $cliParts += $script:${c.name}_Args[$key] }`);
  lines.push(`    }`);
  lines.push(`    $cliCommand = ($cliParts -join ' ').Trim()`);
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
  lines.push(`    $cliCloseBtn = New-Object System.Windows.Forms.Button`);
  lines.push(`    $cliCloseBtn.Location = New-Object System.Drawing.Point(150, 42)`);
  lines.push(`    $cliCloseBtn.Size = New-Object System.Drawing.Size(80, 25)`);
  lines.push(`    $cliCloseBtn.Text = "Close"`);
  lines.push(`    $cliCloseBtn.DialogResult = [System.Windows.Forms.DialogResult]::Cancel`);
  lines.push(`    $cliModal.Controls.Add($cliCloseBtn)`);
  lines.push(`    $cliModal.CancelButton = $cliCloseBtn`);
  lines.push(`    [void]$cliModal.ShowDialog($sender.FindForm())`);
  lines.push(`})`);
  return lines;
}
