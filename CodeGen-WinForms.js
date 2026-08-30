/*
    Cli-Preview-Builder.js
    Written by: Johnathon Largent
    Version 1.4

    Revision:

    1. Fixed orList reading stale state: WinForms fires ItemCheck BEFORE
    the clicked item's own check state actually updates, so reading
    CheckedItems directly inside that event was PERSISTENTLY one click
    behind (every check/uncheck, not just the first) - visible as "the
    first item doesn't attach until a second one is checked" and
    unchecking never removing anything. Fixed the same way the existing
    itemCheckedSetProp snippet already does: when the injection's target
    event is ItemCheck, compute the up-to-date checked set directly from
    $e.Index/$e.NewValue for the just-toggled item plus GetItemChecked
    for every other item, instead of trusting CheckedItems. Elsewhere
    (e.g. a gate's CheckedChanged, via Only When) CheckedItems is used
    as before, since there's no pending click on that list to account
    for there. cliArgAssignmentLines takes the injection's target event
    name now, to tell which case applies.

    2. Split the old single "Switch" Kind into "Command / Literal"
    (unchanged behavior, exact text) and a new "Parameter" Kind that
    auto-prefixes the typed Flag with '-' if missing - clearer tooltip
    on the Kind select explaining what each is for, with examples
    (Get-Service/tool.ps1 for Command, DisplayName for Parameter).

    3. Value Kind gained "Use $cliValue from this action's own code
    (advanced)" - when checked, the contribution reads a $cliValue
    variable the person's own action code is expected to set, instead of
    automatically reading a fixed property off the tagged control, so a
    computation they've already written doesn't need to be duplicated.
*/

const CLI_PREVIEW_BUILDER_VERSION = '1.4';

// ---- Design-time helpers (used by Properties-Pane.js) ---------------

// Every cli-tagged action on a control, across all of its events, in a
// stable (event, then action index) order - each entry becomes one
// dictionary key at codegen time. Validity depends on kind: Command/
// Literal (switch) and Parameter both require a Flag (the flag IS the
// whole contribution); Value is always valid (a blank Flag there is a
// deliberate way to contribute just a control's own raw value with
// nothing prepended); List (OR'd) requires an Item Template (Prefix/
// Joiner/Suffix are optional).
function cliTaggedActionEntries(ctrl) {
  const entries = [];
  if (!ctrl.events) return entries;
  Object.entries(ctrl.events).forEach(([evtName, data]) => {
    if (!data || !data.actions) return;
    data.actions.forEach((action, actionIndex) => {
      if (!action.cli || !action.cli.enabled) return;
      const cli = action.cli;
      const valid = cli.kind === 'value'
        || ((cli.kind === 'switch' || cli.kind === 'parameter') && cli.flag)
        || (cli.kind === 'orList' && cli.itemTemplate);
      if (valid) entries.push({ evtName, actionIndex, action });
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
    kindRow.innerHTML = `<label title="Command / Literal: the Flag text appears exactly as typed, only while THIS control's own boolean state (Checked) is true - use for a command or script name (Get-Service, tool.ps1) or any other literal syntax fragment (| Where-Object, {, }). Parameter: same idea, but a leading '-' is added automatically if you don't type one - use for a bare parameter/switch (type DisplayName, get -DisplayName). Value: the Flag text (if any) plus this control's own value (Text/Value/etc, based on its type) - leave Flag blank to contribute just the raw value on its own; blank VALUES are omitted entirely. List (OR'd): CheckedListBox only - wraps and OR-joins every checked item into one self-contained clause.">Kind</label>`;
    const kindSel = document.createElement('select');
    const kindOptions = [['switch', 'Command / Literal'], ['parameter', 'Parameter'], ['value', 'Value']];
    if (ctrl.type === 'CheckedListBox') kindOptions.push(['orList', 'List (OR\'d)']);
    kindOptions.forEach(([k, kLabel]) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = kLabel;
      if (action.cli.kind === k) o.selected = true;
      kindSel.appendChild(o);
    });
    kindSel.addEventListener('change', () => {
      action.cli.kind = kindSel.value;
      if (action.cli.kind === 'orList') {
        // Defaults land you on the {$_.Status -eq 'Running' -or ...}
        // pattern out of the box - all four fields stay editable for
        // any other OR'd clause shape.
        if (!action.cli.itemTemplate) action.cli.itemTemplate = `$_.Status -eq '{item}'`;
        if (action.cli.prefix === undefined) action.cli.prefix = '| Where-Object {';
        if (action.cli.joiner === undefined) action.cli.joiner = ' -or ';
        if (action.cli.suffix === undefined) action.cli.suffix = '}';
      }
      sync();
      render();
    });
    kindRow.appendChild(kindSel);
    wrap.appendChild(kindRow);

    if (action.cli.kind === 'orList') {
      const fields = [
        ['prefix', 'Prefix', '| Where-Object {'],
        ['itemTemplate', 'Item Template (use {item})', `$_.Status -eq '{item}'`],
        ['joiner', 'Joiner', ' -or '],
        ['suffix', 'Suffix', '}'],
      ];
      fields.forEach(([fieldKey, fieldLabel, placeholder]) => {
        const fieldRow = document.createElement('div');
        fieldRow.className = 'prop-row';
        fieldRow.innerHTML = `<label>${fieldLabel}</label>`;
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.value = action.cli[fieldKey] || '';
        input.addEventListener('change', () => { action.cli[fieldKey] = input.value; sync(); });
        fieldRow.appendChild(input);
        wrap.appendChild(fieldRow);
      });
    } else if (action.cli.kind === 'value') {
      const flagRow = document.createElement('div');
      flagRow.className = 'prop-row';
      flagRow.innerHTML = `<label>Flag (optional)</label>`;
      const flagInput = document.createElement('input');
      flagInput.type = 'text';
      flagInput.placeholder = '-Name (leave blank for a bare value)';
      flagInput.value = action.cli.flag || '';
      flagInput.addEventListener('change', () => { action.cli.flag = flagInput.value; sync(); });
      flagRow.appendChild(flagInput);
      wrap.appendChild(flagRow);

      const useOwnRow = document.createElement('div');
      useOwnRow.className = 'prop-row';
      useOwnRow.innerHTML = `<label title="Instead of automatically reading this control's own property (Text/Value/etc), use a variable named $cliValue - set that variable yourself in this SAME action's own code above (e.g. $cliValue = $ThisControl.Text.ToUpper()) and this contribution will use whatever it computes, so you don't have to write the same logic twice.">Use $cliValue from this action's own code (advanced)</label>`;
      const useOwnCheck = document.createElement('input');
      useOwnCheck.type = 'checkbox';
      useOwnCheck.checked = !!action.cli.useOwnCode;
      useOwnCheck.addEventListener('change', () => { action.cli.useOwnCode = useOwnCheck.checked; sync(); });
      useOwnRow.appendChild(useOwnCheck);
      wrap.appendChild(useOwnRow);
    } else {
      // switch or parameter
      const flagRow = document.createElement('div');
      flagRow.className = 'prop-row';
      flagRow.innerHTML = `<label>Flag</label>`;
      const flagInput = document.createElement('input');
      flagInput.type = 'text';
      flagInput.placeholder = action.cli.kind === 'parameter' ? 'DisplayName (dash added automatically)' : 'Get-Service, tool.ps1, | Where-Object';
      flagInput.value = action.cli.flag || '';
      flagInput.addEventListener('change', () => {
        let v = flagInput.value.trim();
        if (action.cli.kind === 'parameter' && v && !v.startsWith('-')) v = '-' + v;
        action.cli.flag = v;
        flagInput.value = v;
        sync();
      });
      flagRow.appendChild(flagInput);
      wrap.appendChild(flagRow);
    }

    // Only When (optional, any Kind): gates this whole contribution
    // behind a SEPARATE control's own Checked state, independent of
    // whatever THIS control contributes - e.g. a general "enable
    // filtering" checkbox/radio button that some other, more specific
    // contribution (like a status CheckedListBox's List (OR'd) clause)
    // should only attach behind, without that other checkbox needing to
    // know or care what kind of filter it happens to be gating.
    const gateRow = document.createElement('div');
    gateRow.className = 'prop-row';
    gateRow.innerHTML = `<label title="Only add this contribution while the picked control is also Checked - leave unset to always contribute based purely on this control's own state. Toggling either control refreshes the preview.">Only When (optional)</label>`;
    const gateWrap = document.createElement('div');
    gateWrap.className = 'snippet-param-control';
    const gateDisplay = document.createElement('span');
    gateDisplay.className = 'snippet-param-control-name';
    gateDisplay.textContent = action.cli.gateControlName ? `$${action.cli.gateControlName}.Checked` : '(none)';
    const gatePickBtn = document.createElement('button');
    gatePickBtn.type = 'button';
    gatePickBtn.className = 'btn btn-ghost pick-control-btn';
    gatePickBtn.innerHTML = '\u2316 Select Control';
    gatePickBtn.title = 'Pick another control (a CheckBox or RadioButton) whose own Checked state must also be true for this contribution to apply.';
    gatePickBtn.addEventListener('click', () => {
      startControlPick((pickedCtrl) => {
        action.cli.gateControlName = pickedCtrl.name;
        sync();
        render();
      });
    });
    gateWrap.appendChild(gateDisplay);
    gateWrap.appendChild(gatePickBtn);
    if (action.cli.gateControlName) {
      const gateClearBtn = document.createElement('button');
      gateClearBtn.type = 'button';
      gateClearBtn.className = 'btn btn-ghost';
      gateClearBtn.textContent = 'Clear';
      gateClearBtn.addEventListener('click', () => { delete action.cli.gateControlName; sync(); render(); });
      gateWrap.appendChild(gateClearBtn);
    }
    gateRow.appendChild(gateWrap);
    wrap.appendChild(gateRow);
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

// Escapes text for embedding inside a DOUBLE-quoted PowerShell string
// literal (backtick-escapes backtick, double-quote, and $ so nothing
// interpolates and no literal quote character is ever left dangling
// against the string's own closing quote) - used everywhere a
// contributed fragment needs to stay LITERAL text rather than being
// interpreted or ambiguously parsed. Single-quote doubling (the more
// common PowerShell escaping approach) breaks specifically when a
// fragment's content ends in a literal quote character right up against
// the wrapper's own closing quote (three quote characters in a row parse
// as "still open", not "escaped quote then close") - exactly the shape
// of a template like "$_.Status -eq '{item}'", so double-quote/backtick
// escaping is used throughout instead.
function cliEscapePsDoubleQuoted(s) {
  return (s || '')
    .replace(/`/g, '``')
    .replace(/"/g, '`"')
    .replace(/\$/g, '`$');
}

// The PowerShell lines that keep one $script:<Preview>_Args entry in
// sync with a tagged control's current state for a single cli-tagged
// action. Always references the tagged control by its OWN explicit
// variable name ($<ctrl.name>), never $ThisControl - this same block of
// lines can be injected into either the tagged control's own event
// (the normal case) OR a separate gate control's event (when Only When
// is set, so toggling the gate alone also refreshes things), and only
// the tagged control's own name is guaranteed correct in both places.
// Switch sets/removes a bare flag based on Checked; Value sets/removes
// "flag value" (or just "value" when Flag is blank) based on whether
// the control's own value property is blank (numeric/date properties
// are never blank, so those are always included once the control
// exists); List (OR'd) - CheckedListBox only - rebuilds one self-
// contained clause from every currently-checked item. When Only When
// (cli.gateControlName) is set, the whole thing is additionally gated
// behind that other control's own Checked state.
function cliArgAssignmentLines(ctrl, cli, key, previewVar, evtName) {
  const ref = `$${ctrl.name}`;
  let bodyLines;
  if (cli.kind === 'switch' || cli.kind === 'parameter') {
    const escapedFlag = cliEscapePsDoubleQuoted(cli.flag);
    bodyLines = [
      `if (${ref}.Checked) {`,
      `    $script:${previewVar}_Args['${key}'] = "${escapedFlag}"`,
      `} else {`,
      `    $script:${previewVar}_Args.Remove('${key}')`,
      `}`,
    ];
  } else if (cli.kind === 'orList') {
    // {item} marks where each checked item's own text is spliced in -
    // split the template around it once, escape both literal halves and
    // concatenate with the item text at run time ("<before>" + $cliItem
    // + "<after>"). Double-quoted + backtick-escaped, not single-quoted:
    // a template like "$_.Status -eq '{item}'" ends its "before" half
    // right on a literal quote character, which single-quote doubling
    // can't close unambiguously against the wrapper's own closing quote
    // (three quote characters in a row don't parse as "escaped quote
    // then close" - PowerShell keeps reading past it). Backtick-escaping
    // has no such adjacency problem for any content.
    const template = cli.itemTemplate || '{item}';
    const idx = template.indexOf('{item}');
    const before = idx >= 0 ? template.slice(0, idx) : template;
    const after = idx >= 0 ? template.slice(idx + '{item}'.length) : '';
    const escBefore = cliEscapePsDoubleQuoted(before);
    const escAfter = cliEscapePsDoubleQuoted(after);
    const escPrefix = cliEscapePsDoubleQuoted(cli.prefix);
    const escJoiner = cliEscapePsDoubleQuoted(cli.joiner);
    const escSuffix = cliEscapePsDoubleQuoted(cli.suffix);
    if (evtName === 'ItemCheck') {
      // WinForms fires ItemCheck BEFORE the clicked item's own check
      // state actually updates, so ${ref}.CheckedItems here reflects
      // the state as of the PREVIOUS click, not including the one that
      // just fired - PERSISTENTLY (every future click reads stale state
      // at that same instant too, it never catches up), not just
      // momentarily. Fixed the same way the existing itemCheckedSetProp
      // snippet already does: compute the up-to-date state directly from
      // $e.Index/$e.NewValue for the just-toggled item, GetItemChecked
      // for every other item.
      bodyLines = [
        `$cliChecked = @()`,
        `for ($cliI = 0; $cliI -lt ${ref}.Items.Count; $cliI++) {`,
        `    $cliIsChecked = if ($cliI -eq $e.Index) { $e.NewValue -eq [System.Windows.Forms.CheckState]::Checked } else { ${ref}.GetItemChecked($cliI) }`,
        `    if ($cliIsChecked) { $cliChecked += ${ref}.Items[$cliI] }`,
        `}`,
        `if ($cliChecked.Count -gt 0) {`,
        `    $cliItems = @()`,
        `    foreach ($cliItem in $cliChecked) { $cliItems += ("${escBefore}" + $cliItem + "${escAfter}") }`,
        `    $script:${previewVar}_Args['${key}'] = "${escPrefix}" + ($cliItems -join "${escJoiner}") + "${escSuffix}"`,
        `} else {`,
        `    $script:${previewVar}_Args.Remove('${key}')`,
        `}`,
      ];
    } else {
      // Injected elsewhere (e.g. a gate control's CheckedChanged, via
      // Only When) - there's no pending click on THIS list to account
      // for here, so its own already-committed CheckedItems is accurate.
      bodyLines = [
        `if (${ref}.CheckedItems.Count -gt 0) {`,
        `    $cliItems = @()`,
        `    foreach ($cliItem in ${ref}.CheckedItems) { $cliItems += ("${escBefore}" + $cliItem + "${escAfter}") }`,
        `    $script:${previewVar}_Args['${key}'] = "${escPrefix}" + ($cliItems -join "${escJoiner}") + "${escSuffix}"`,
        `} else {`,
        `    $script:${previewVar}_Args.Remove('${key}')`,
        `}`,
      ];
    }
  } else {
    // Value kind
    const escapedFlag = cliEscapePsDoubleQuoted(cli.flag);
    const prefix = escapedFlag ? `"${escapedFlag} " + ` : '';
    if (cli.useOwnCode) {
      // Uses $cliValue, a variable the person's OWN code (typed into
      // this same action, above this injected block - see the
      // "purely additive... appended after" convention in CodeGen-
      // WinForms.js) is expected to set, instead of automatically
      // reading a fixed property off the tagged control. Avoids asking
      // for the same computation twice when they've already written it.
      bodyLines = [
        `if ([string]::IsNullOrWhiteSpace($cliValue)) {`,
        `    $script:${previewVar}_Args.Remove('${key}')`,
        `} else {`,
        `    $script:${previewVar}_Args['${key}'] = ${prefix}$cliValue`,
        `}`,
      ];
    } else {
      const prop = cliValuePropertyForType(ctrl.type);
      if (prop === 'Text') {
        bodyLines = [
          `if ([string]::IsNullOrWhiteSpace(${ref}.Text)) {`,
          `    $script:${previewVar}_Args.Remove('${key}')`,
          `} else {`,
          `    $script:${previewVar}_Args['${key}'] = ${prefix}${ref}.Text`,
          `}`,
        ];
      } else {
        bodyLines = [`$script:${previewVar}_Args['${key}'] = ${prefix}${ref}.${prop}`];
      }
    }
  }

  if (cli.gateControlName) {
    return [
      `if ($${cli.gateControlName}.Checked) {`,
      ...bodyLines.map(l => `    ${l}`),
      `} else {`,
      `    $script:${previewVar}_Args.Remove('${key}')`,
      `}`,
    ].join('\n');
  }
  return bodyLines.join('\n');
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
