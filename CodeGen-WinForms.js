/*
    CodeGen-WinForms.js
    Written by: Johnathon Largent
    Version 1.19

    Revision:

    1. Precompute now also registers a CLI arg-sync injection against a
    gate control's own CheckedChanged event whenever a tagged action
    sets Only When (Cli-Preview-Builder.js 1.3), so toggling the gate
    alone (without touching the originally-tagged control) still
    refreshes the assembled command. The "which events need a synthetic
    empty entry so they're visited even if the person never authored
    anything there" check is now general (any event cliByControlEvent
    references for this control, not just the wizard gate's one specific
    event), and the call to cliArgAssignmentLines passes each entry's
    own sourceCtrl rather than always the current control, since that
    can now legitimately differ (c is the gate, sourceCtrl is the
    control that was actually tagged).
*/

const CODEGEN_WINFORMS_VERSION = '1.19';

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
  // ClientSize, not Size: .Size sets the OUTER window bounds (title bar
  // and border included), so with a title bar present the actual usable
  // client area ends up shorter than state.form.height by however tall
  // that title bar is - every child control's Y coordinate assumes a
  // client area of exactly this height/width (matching the designer,
  // which already grows the outer preview box by the title bar height on
  // top of this for display - see renderFormChrome in Engine.js), so
  // content anchored near the bottom (like a wizard's footer buttons)
  // would get clipped until the window was manually resized larger.
  // ClientSize tells WinForms to size the OUTER window however it needs
  // to, so the client area itself is guaranteed to be exactly this size.
  lines.push(`$Form.ClientSize = New-Object System.Drawing.Size(${f.width}, ${f.height})`);
  lines.push(`$Form.BackColor = ${psColor(f.backColor)}`);
  lines.push(`$Form.StartPosition = "${f.startPosition}"`);
  lines.push(`$Form.MinimizeBox = $${f.minimizeBox}`);
  lines.push(`$Form.MaximizeBox = $${f.maximizeBox}`);
  lines.push(`$Form.ControlBox = $${f.closeBox}`);
  lines.push(`$Form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::${f.formBorderStyle}`);
  lines.push(`$Form.TopMost = $${f.topMost}`);
  lines.push('');

  const tabPageVarFor = {}; // `${tabControlId}::${tabId}` -> generated $variable name
  const wizardPageVarFor = {}; // `${wizardId}::${pageId}` -> generated $variable name
  const wizardInitCalls = []; // wizard names needing a final `Show-<Name>Page 0` once every control exists

  // CLI Command Preview: precompute, once, every Preview control's
  // ordered contributor list (cliOrderedContributors, Cli-Preview-
  // Builder.js) and a reverse lookup by contributing control+event, so
  // each contributing control's own event handler (built further below)
  // can append its "update the Args dict" lines without re-deriving
  // order per-control - same reasoning as the Wizard's own ordered-name
  // precompute for its Summary log.
  const cliContributorsByPreview = {}; // previewCtrl.id -> ordered [{ctrl, evtName, actionIndex, action}]
  const cliByControlEvent = {}; // `${ctrlId}::${evtName}` -> [{ previewVar, key, cli, sourceCtrl }]
  const addCliInjection = (mapKey, entry) => {
    if (!cliByControlEvent[mapKey]) cliByControlEvent[mapKey] = [];
    cliByControlEvent[mapKey].push(entry);
  };
  ctrls.filter(c => c.type === 'CliPreview').forEach(cp => {
    const contributors = cliOrderedContributors(cp);
    cliContributorsByPreview[cp.id] = contributors;
    contributors.forEach(entry => {
      const key = `${entry.ctrl.name}_${entry.actionIndex}`;
      const injection = { previewVar: cp.name, key, cli: entry.action.cli, sourceCtrl: entry.ctrl };
      addCliInjection(`${entry.ctrl.id}::${entry.evtName}`, injection);
      // Only When (action.cli.gateControlName): this same key ALSO needs
      // refreshing whenever the gate control's own Checked state toggles
      // on its own, without the tagged control itself being touched -
      // e.g. flipping a general "enable filtering" checkbox should
      // immediately reflect in the assembled command even if the status
      // list underneath it isn't re-clicked. The gate is expected to be
      // a CheckBox/RadioButton-style control, so CheckedChanged is the
      // event that matters.
      if (entry.action.cli.gateControlName) {
        const gateCtrl = getControlByName(entry.action.cli.gateControlName);
        if (gateCtrl) addCliInjection(`${gateCtrl.id}::CheckedChanged`, injection);
      }
    });
  });

  ctrls.forEach(c => {
    const p = c.props;
    const wfType = {
      Button: 'Button', Label: 'Label', TextBox: 'TextBox', CheckBox: 'CheckBox',
      RadioButton: 'RadioButton', ComboBox: 'ComboBox', ListBox: 'ListBox', Panel: 'Panel',
      GroupBox: 'GroupBox', PictureBox: 'PictureBox', ProgressBar: 'ProgressBar',
      TrackBar: 'TrackBar', NumericUpDown: 'NumericUpDown', DateTimePicker: 'DateTimePicker',
      RichTextBox: 'RichTextBox', LinkLabel: 'LinkLabel', MenuStrip: 'MenuStrip', TabControl: 'TabControl',
      CheckedListBox: 'CheckedListBox', MaskedTextBox: 'MaskedTextBox',
      FlowLayoutPanel: 'FlowLayoutPanel', TableLayoutPanel: 'TableLayoutPanel',
      StatusStrip: 'StatusStrip', ToolStrip: 'ToolStrip',
      Wizard: 'Panel', // a Wizard is design-time only - it generates as a plain Panel holding one Panel per page
      CliPreview: 'Button', // a real Button whose Click is fully generated (see case 'CliPreview' below)
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
        lines.push(`$${c.name}.Text = "${(p.text || '').replace(/"/g, '""')}"`);
        // p.textAlign is already a literal ContentAlignment name (e.g.
        // "MiddleLeft") straight out of the 9-point picker
        // (contentAlignEditor, Properties-Pane.js) - no translation needed.
        if (c.type === 'Label' && p.textAlign) {
          lines.push(`$${c.name}.TextAlign = [System.Drawing.ContentAlignment]::${p.textAlign}`);
        }
        break;
      case 'TextBox': case 'RichTextBox':
        lines.push(`$${c.name}.Text = "${(p.text || '').replace(/"/g, '""')}"`);
        if (c.type === 'TextBox') {
          lines.push(`$${c.name}.Multiline = $${p.multiline}`);
          lines.push(`$${c.name}.ReadOnly = $${p.readOnly}`);
          if (p.passwordChar) lines.push(`$${c.name}.PasswordChar = '${p.passwordChar}'`);
          if (p.maxLength) lines.push(`$${c.name}.MaxLength = ${p.maxLength}`);
        } else if (c.type === 'RichTextBox') {
          lines.push(`$${c.name}.ReadOnly = $${p.readOnly}`);
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
          else if (p.dropDownStyle !== 'DropDownList' && p.text) lines.push(`$${c.name}.Text = "${p.text.replace(/"/g, '""')}"`);
        } else if (c.type === 'ListBox') {
          lines.push(`$${c.name}.SelectionMode = [System.Windows.Forms.SelectionMode]::${p.selectionMode}`);
          (p.selectedIndices || []).forEach(i => lines.push(`$${c.name}.SetSelected(${i}, $true)`));
        }
        break;
      }
      case 'CheckedListBox': {
        const items = (p.items || '').split('\n').filter(Boolean);
        items.forEach(it => lines.push(`$${c.name}.Items.Add("${it.replace(/"/g, '""')}") | Out-Null`));
        lines.push(`$${c.name}.CheckOnClick = $${p.checkOnClick}`);
        (p.checkedIndices || []).forEach(i => lines.push(`$${c.name}.SetItemChecked(${i}, $true)`));
        break;
      }
      case 'GroupBox':
        lines.push(`$${c.name}.Text = "${(p.text || '').replace(/"/g, '""')}"`); break;
      case 'MaskedTextBox':
        lines.push(`$${c.name}.Mask = "${(p.mask || '').replace(/"/g, '""')}"`);
        if (p.text) lines.push(`$${c.name}.Text = "${p.text.replace(/"/g, '""')}"`);
        break;
      case 'FlowLayoutPanel':
        lines.push(`$${c.name}.FlowDirection = [System.Windows.Forms.FlowDirection]::${p.flowDirection}`);
        lines.push(`$${c.name}.WrapContents = $${p.wrapContents}`);
        break;
      case 'TableLayoutPanel':
        lines.push(`$${c.name}.ColumnCount = ${p.columnCount}`);
        lines.push(`$${c.name}.RowCount = ${p.rowCount}`);
        break;
      case 'StatusStrip': {
        lines.push(`$${c.name}_Label = New-Object System.Windows.Forms.ToolStripStatusLabel`);
        lines.push(`$${c.name}_Label.Text = "${(p.text || '').replace(/"/g, '""')}"`);
        lines.push(`$${c.name}.Items.Add($${c.name}_Label) | Out-Null`);
        break;
      }
      case 'ToolStrip': {
        const items = p.items || [];
        items.forEach((it, i) => {
          lines.push(`$${c.name}_Btn${i} = New-Object System.Windows.Forms.ToolStripButton`);
          lines.push(`$${c.name}_Btn${i}.Text = "${it.label.replace(/"/g, '""')}"`);
          if (it.icon && it.icon !== 'none') lines.push(`# TODO: set $${c.name}_Btn${i}.Image to an actual icon resource (designer icon: "${it.icon}")`);
          lines.push(`$${c.name}.Items.Add($${c.name}_Btn${i}) | Out-Null`);
        });
        break;
      }
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
        if (p.format === 'Custom' && p.customFormat) lines.push(`$${c.name}.CustomFormat = "${p.customFormat.replace(/"/g, '""')}"`);
        break;
      case 'CliPreview': {
        lines.push(`$${c.name}.Text = "${(p.text || '').replace(/"/g, '""')}"`);
        // Args/ArgsOrder are this control's own $script:-scoped state -
        // ArgsOrder is baked in fixed at build time (same reasoning as
        // the Wizard Summary log's LogOrder: a PowerShell hashtable has
        // no reliable enumeration order of its own), Args itself starts
        // empty and is populated live as contributing controls fire
        // their own tagged events.
        const contributors = cliContributorsByPreview[c.id] || [];
        const orderKeys = contributors.map(e => `${e.ctrl.name}_${e.actionIndex}`);
        lines.push(`$script:${c.name}_Args = @{}`);
        lines.push(`$script:${c.name}_ArgsOrder = @(${orderKeys.map(k => `'${k}'`).join(', ')})`);
        break;
      }
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
      case 'TabControl': {
        (p.tabs || []).forEach(tab => {
          const pageVar = `${c.name}_${tab.id}`;
          lines.push(`$${pageVar} = New-Object System.Windows.Forms.TabPage`);
          lines.push(`$${pageVar}.Text = "${(tab.label || '').replace(/"/g, '""')}"`);
          lines.push(`$${c.name}.TabPages.Add($${pageVar})`);
          tabPageVarFor[`${c.id}::${tab.id}`] = pageVar;
        });
        break;
      }
      case 'Wizard': {
        const pages = p.pages || [];
        const pageVarNames = [];
        // The page content area is shrunk (and offset) to make room for
        // the optional Contents nav strip - same idea as the canvas
        // preview's wizardContentBounds()/.wizard-content-* CSS classes.
        const cb = wizardContentBounds(c);
        const pageX = p.contentsStyle === 'Vertical' ? WIZARD_VERTICAL_CONTENTS_WIDTH : 0;
        const pageY = p.contentsStyle === 'Horizontal' ? WIZARD_HORIZONTAL_CONTENTS_HEIGHT : 0;
        pages.forEach((page, i) => {
          const pageVar = `${c.name}_${page.id}`;
          lines.push(`$${pageVar} = New-Object System.Windows.Forms.Panel`);
          lines.push(`$${pageVar}.Location = New-Object System.Drawing.Point(${pageX}, ${pageY})`);
          lines.push(`$${pageVar}.Size = New-Object System.Drawing.Size(${cb.w}, ${cb.h})`);
          lines.push(`$${pageVar}.Visible = $${i === 0}`);
          lines.push(`$${c.name}.Controls.Add($${pageVar})`);
          wizardPageVarFor[`${c.id}::${page.id}`] = pageVar;
          pageVarNames.push(pageVar);
        });
        // The optional Contents nav strip (Horizontal/Vertical step list)
        // is chrome belonging to the wizard itself, not a page - generated
        // once here, independent of which page is currently showing.
        const nav = wizardContentsNavCodegenLines(c);
        lines.push(...nav.lines);
        // Footer Options extras (border divider / step counter) - same
        // "chrome belonging to the wizard, not any one page" idea as the
        // Contents nav strip above. Emitted before the footer buttons so
        // they sit visually behind them in z-order (matches AddRange call
        // order elsewhere - later Adds paint on top).
        const footerOpts = p.footerOptions || {};
        const footerTop = c.h - WIZARD_FOOTER_HEIGHT;
        const footerButtonY = footerTop + 10; // centered in the 45px strip, same as the real footer buttons
        let stepCounterVar = null;
        if (footerOpts.border) {
          const dividerVar = `${c.name}_FooterDivider`;
          lines.push(`$${dividerVar} = New-Object System.Windows.Forms.Panel`);
          lines.push(`$${dividerVar}.Location = New-Object System.Drawing.Point(0, ${footerTop})`);
          lines.push(`$${dividerVar}.Size = New-Object System.Drawing.Size(${c.w}, 1)`);
          lines.push(`$${dividerVar}.BackColor = [System.Drawing.SystemColors]::ControlDark`);
          lines.push(`$${dividerVar}.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right`);
          lines.push(`$${c.name}.Controls.Add($${dividerVar})`);
        }
        if (footerOpts.stepCounter) {
          stepCounterVar = `${c.name}_StepCounter`;
          lines.push(`$${stepCounterVar} = New-Object System.Windows.Forms.Label`);
          lines.push(`$${stepCounterVar}.Location = New-Object System.Drawing.Point(20, ${footerButtonY})`);
          lines.push(`$${stepCounterVar}.Size = New-Object System.Drawing.Size(150, 20)`);
          lines.push(`$${stepCounterVar}.Text = "Step 1 of ${pages.length}"`);
          lines.push(`$${stepCounterVar}.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Left`);
          lines.push(`$${c.name}.Controls.Add($${stepCounterVar})`);
        }
        // Show-<Name>Page and Test-<Name>PageRequirements only depend on
        // the page list and each child's own wizardRequired/validation
        // fields (all already known from state.controls at this point),
        // not on when those children get emitted by the main loop below.
        lines.push(...wizardNextEnabledFunctionLines(c));
        lines.push(...wizardShowFunctionLines(c, pageVarNames, nav.navVarNames, stepCounterVar));
        lines.push(...wizardTestFunctionLines(c));
        lines.push(...wizardUnmetMessageFunctionLines(c));
        // Summary of Tasks log: the shared dictionary/order is emitted if
        // EITHER a Summary or a summaryAfter RichTextBox exists to display
        // it (findWizardSummaryPageBox / findWizardSummaryAfterPageBox,
        // Wizard-Builder.js) - the entries themselves aren't tied to either
        // display. Each box that exists gets its OWN base-text variable
        // (its own authored Text, never the other page's) and its own
        // Update-<Name>...Log function; Show-<Name>Page (Wizard-Builder.js)
        // calls whichever one(s) apply when their page is reached.
        // summaryAfter has no dedicated console/log-file capture yet (a
        // separate, future feature) so for now it just mirrors the same
        // entries as a fallback - never Summary's own header text.
        const summaryBox = findWizardSummaryPageBox(c);
        const summaryAfterBox = findWizardSummaryAfterPageBox(c);
        if (summaryBox || summaryAfterBox) {
          const orderedNames = wizardLogTargetOrderedControlNames(c);
          lines.push(`$script:${c.name}_LogEntries = @{}`);
          lines.push(`$script:${c.name}_LogOrder = @(${orderedNames.map(n => `'${n}'`).join(', ')})`);
          if (summaryBox) {
            lines.push(`$script:${c.name}_LogBaseText = "${wizardEscapePsText(summaryBox.props.text)}"`);
            lines.push(...wizardSummaryLogFunctionLines(c, summaryBox));
          }
          if (summaryAfterBox) {
            lines.push(`$script:${c.name}_LogAfterBaseText = "${wizardEscapePsText(summaryAfterBox.props.text)}"`);
            lines.push(...wizardSummaryAfterLogFunctionLines(c, summaryAfterBox));
          }
        }
        lines.push(`$script:${c.name}_CurrentPage = 0`);
        wizardInitCalls.push(c.name);
        break;
      }
    }

    // events
    const wizardParent = c.parentId ? getControl(c.parentId) : null;
    const isWizardNavBtn = c.wizardRole && wizardParent && CONTROL_DEFS[wizardParent.type].isWizard;
    // A required control on a "Disable Next" page needs Update-<n>NextEnabled
    // wired into its own gate event (wizardGateEventForType - the SPECIFIC
    // state-change event for that control type, e.g. CheckedChanged, not a
    // generic catch-all) so the Next button's live Enabled state tracks
    // that page's unmet-requirements list the moment the person interacts -
    // not only when Test-<n>PageRequirements runs on Next's own Click.
    // Purely additive: appended after whatever the person authored on that
    // same event, never replacing it - same non-destructive spirit as the
    // rest of the wizard's codegen overrides.
    let wizardGateEvtName = null, wizardGateItems = null, wizardGatePage = null;
    if (!isWizardNavBtn && wizardParent && CONTROL_DEFS[wizardParent.type].isWizard && !c.wizardFooter) {
      const pages = wizardParent.props.pages || [];
      const page = pages.find(p => p.id === c.tabPage);
      if (page && page.nextMode === 'disable') {
        const evtName = wizardGateEventForType(c.type);
        if (evtName) {
          const items = wizardRequirementItemsForPage(wizardParent, page).filter(it => it.ctrl.id === c.id);
          if (items.length) {
            wizardGateEvtName = evtName;
            wizardGateItems = items;
            wizardGatePage = page;
          }
        }
      }
    }
    if (isWizardNavBtn) {
      // Back/Next/Cancel Click code is always generated fresh from the
      // wizard's live page list/validation rules, overriding whatever is
      // stored in events.Click.code - same convention as MenuStrip's
      // autoAbout items regenerating rather than trusting stored text.
      const body = wizardNavClickBody(c, wizardParent);
      lines.push(`$${c.name}.Add_Click({\n    param($sender, $e)\n    ${body}\n})`);
    } else if (c.type === 'CliPreview') {
      // Fully generated, same reasoning as isWizardNavBtn above - there
      // is no user-editable Click here (CliPreview has no entries in
      // CONTROL_DEFS.events), the assembled-command popout IS the click
      // behavior.
      lines.push(...cliPreviewClickHandlerLines(c));
    } else {
      // If this control needs the wizard gate wired in, or needs to run
      // CLI arg-sync lines (either its own tagged action's event, or -
      // when it's being used as another action's Only When gate -
      // CheckedChanged), but has no handler on that event at all yet,
      // synthesize an empty one so the loop below still visits it -
      // these must fire regardless of whether the person happened to
      // open that event themselves.
      const eventsForCodegen = { ...c.events };
      if (wizardGateEvtName && !eventsForCodegen[wizardGateEvtName]) eventsForCodegen[wizardGateEvtName] = { code: '' };
      Object.keys(cliByControlEvent).forEach(mapKey => {
        const [ctrlId, evtName] = mapKey.split('::');
        if (ctrlId === c.id && !eventsForCodegen[evtName]) eventsForCodegen[evtName] = { code: '' };
      });
      Object.entries(eventsForCodegen).forEach(([evtName, data]) => {
        if (!data) return;
        const isGateEvt = evtName === wizardGateEvtName;
        // Anything in eventsForCodegen that ISN'T in the control's own,
        // real c.events must have come from one of the synthesize steps
        // just above - covers the wizard gate and both CLI sync cases
        // uniformly, so there's nothing further to special-case here.
        const isSynthetic = !c.events[evtName];
        let body;
        if (data.ps1) body = `. "${data.ps1}"; ${data.fn}`;
        else if (data.code && data.code.trim()) body = data.code.split('\n').join('\n    ');
        else body = isSynthetic ? '' : '# TODO: handler body';
        if (isGateEvt) {
          const gateLines = wizardUnmetListUpdateLines(wizardParent, wizardGatePage, wizardGateItems).split('\n').join('\n    ');
          body = body ? `${body}\n    ${gateLines}` : gateLines;
        }
        // CLI Command Preview: purely additive, same non-destructive
        // convention as the gate injection just above - appended after
        // whatever the person authored on this same event, never
        // replacing it. A control can carry more than one tagged action
        // on the same event (e.g. two different CLI Preview controls, or
        // two separate flags), so every matching entry is applied. Each
        // entry's sourceCtrl is the ORIGINALLY tagged control, which may
        // differ from c when this event only exists here because c is
        // acting as that entry's Only When gate.
        const cliEntries = cliByControlEvent[`${c.id}::${evtName}`];
        if (cliEntries && cliEntries.length) {
          const cliLines = cliEntries
            .map(e => cliArgAssignmentLines(e.sourceCtrl, e.cli, e.key, e.previewVar))
            .join('\n')
            .split('\n').join('\n    ');
          body = body ? `${body}\n    ${cliLines}` : cliLines;
        }
        // ClickToClose is a designer-only convenience label, not a real
        // .NET event - it wires up to the actual Click event underneath.
        // PowerShell/.NET happily supports multiple Add_Click registrations
        // on the same control, so this coexists fine with a separate,
        // independent regular Click handler if one also exists.
        const realEvtName = evtName === 'ClickToClose' ? 'Click' : evtName;
        // param($sender, $e) is the standard PowerShell WinForms convention
        // for accessing an event's EventArgs (e.g. ItemCheck's $e.Index and
        // $e.NewValue) - always declared, harmless when a handler doesn't
        // use it, but means $e is always there for snippets that need it.
        // $ThisControl = $sender: every snippet that references $ThisControl
        // (readValue, mirrorChecked, mirrorUnchecked, ...) depends on this
        // being the control that raised the event. Previously this was
        // never assigned, so $ThisControl was $null at runtime -
        // $null.Checked is $null, and assigning $null to a WinForms
        // Boolean property (e.g. .Enabled) silently coerces to $false -
        // which is exactly why a "mirror Checked" handler looked like it
        // always disabled the target and never re-enabled it regardless of
        // check state: it was assigning the same wrong value every time.
        lines.push(`$${c.name}.Add_${realEvtName}({\n    param($sender, $e)\n    $ThisControl = $sender\n    ${body}\n})`);
      });
    }

    // Route into the right container: a TabPage for TabControl children,
    // a page Panel (or the wizard itself, for footer children) for Wizard
    // children, the parent control for other nested children, or the Form.
    let addTarget = 'Form';
    if (c.parentId) {
      const parentCtrl = getControl(c.parentId);
      if (parentCtrl && parentCtrl.type === 'TabControl' && c.tabPage) {
        addTarget = tabPageVarFor[`${parentCtrl.id}::${c.tabPage}`] || parentCtrl.name;
      } else if (parentCtrl && parentCtrl.type === 'Wizard') {
        addTarget = c.wizardFooter ? parentCtrl.name : (wizardPageVarFor[`${parentCtrl.id}::${c.tabPage}`] || parentCtrl.name);
      } else if (parentCtrl) {
        addTarget = parentCtrl.name;
      }
    }
    lines.push(`$${addTarget}.Controls.Add($${c.name})`);
    if (c.type === 'MenuStrip') lines.push(`$Form.MainMenuStrip = $${c.name}`);
    if (c.wizardFooter) {
      // A wizard's page panels are added to the SAME parent (the wizard
      // itself) earlier than footer children - and in WinForms, an
      // earlier-added control paints IN FRONT of one added later. Left
      // alone, a full-size page panel completely hides every footer
      // button behind it, no matter where they're positioned. BringToFront
      // forces footer children to the front regardless of add order.
      lines.push(`$${c.name}.BringToFront()`);
    }
    lines.push('');
  });

  // Set each wizard's initial page/labels only once every one of its
  // controls (including footer buttons) has actually been created above.
  wizardInitCalls.forEach(name => lines.push(`Show-${name}Page 0`));
  if (wizardInitCalls.length) lines.push('');

  lines.push(`[void]$Form.ShowDialog()`);

  return helpBlockAsPs1Comment() + lines.join('\n');
}
