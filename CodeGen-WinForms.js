/*
    CodeGen-WinForms.js
    Written by: Johnathon Largent
    Version 1.3

    Revision:

    1. Fixed a real bug: wizard footer buttons (Back/Next/Cancel) never
    showed up at runtime no matter where they were positioned. Cause: a
    wizard's full-size page Panel is added to the wizard's Controls
    BEFORE its footer buttons, and in WinForms an earlier-added control
    paints IN FRONT of one added later - so the page panel completely
    covered the buttons behind it. Every wizardFooter child now calls
    BringToFront() right after being added.

    2. Added generated mouse-drag borderless-resize code (MouseDown/
    MouseMove/MouseUp on the Form) when Form Border Style is None and
    the new "Resizable (borderless)" toggle (Properties-Pane.js) is on -
    a real None-bordered form has no OS resize grips otherwise.
*/

const CODEGEN_WINFORMS_VERSION = '1.3';

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
  lines.push(`$Form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::${f.formBorderStyle}`);
  lines.push(`$Form.TopMost = $${f.topMost}`);
  lines.push('');

  if (f.formBorderStyle === 'None' && f.borderlessResizable) {
    // FormBorderStyle=None has no OS resize grips at all, so this adds a
    // manual mouse-drag substitute: mousedown near any edge starts a
    // resize, mousemove while resizing adjusts Bounds directly, mouseup
    // ends it. Kept to plain WinForms events (no P/Invoke/WM_NCHITTEST)
    // so it's easy to read/adjust, at the cost of being a little less
    // snappy than a native OS-level resize border.
    lines.push(`# Borderless resize support - FormBorderStyle=None has no OS resize`);
    lines.push(`# grips, so drag within BorderlessResizeMargin pixels of any edge to resize.`);
    lines.push(`$script:BorderlessResizeMargin = 6`);
    lines.push(`$script:BorderlessResizing = $false`);
    lines.push(`$script:BorderlessResizeMode = ''`);
    lines.push(`$Form.Add_MouseDown({`);
    lines.push(`    param($sender, $e)`);
    lines.push(`    $m = $script:BorderlessResizeMargin`);
    lines.push(`    $onRight = ($sender.ClientSize.Width - $e.X) -le $m`);
    lines.push(`    $onBottom = ($sender.ClientSize.Height - $e.Y) -le $m`);
    lines.push(`    $onLeft = $e.X -le $m`);
    lines.push(`    $onTop = $e.Y -le $m`);
    lines.push(`    if ($onRight -or $onBottom -or $onLeft -or $onTop) {`);
    lines.push(`        $script:BorderlessResizing = $true`);
    lines.push(`        $mode = ''`);
    lines.push(`        if ($onTop) { $mode += 'T' } elseif ($onBottom) { $mode += 'B' }`);
    lines.push(`        if ($onLeft) { $mode += 'L' } elseif ($onRight) { $mode += 'R' }`);
    lines.push(`        $script:BorderlessResizeMode = $mode`);
    lines.push(`    }`);
    lines.push(`})`);
    lines.push(`$Form.Add_MouseMove({`);
    lines.push(`    param($sender, $e)`);
    lines.push(`    if (-not $script:BorderlessResizing) { return }`);
    lines.push(`    $b = $sender.Bounds`);
    lines.push(`    if ($script:BorderlessResizeMode -match 'R') { $b.Width = [Math]::Max(200, $e.X) }`);
    lines.push(`    if ($script:BorderlessResizeMode -match 'B') { $b.Height = [Math]::Max(150, $e.Y) }`);
    lines.push(`    if ($script:BorderlessResizeMode -match 'L') { $dx = $e.X; $b.X += $dx; $b.Width -= $dx }`);
    lines.push(`    if ($script:BorderlessResizeMode -match 'T') { $dy = $e.Y; $b.Y += $dy; $b.Height -= $dy }`);
    lines.push(`    $sender.Bounds = $b`);
    lines.push(`})`);
    lines.push(`$Form.Add_MouseUp({ $script:BorderlessResizing = $false })`);
    lines.push('');
  }

  const tabPageVarFor = {}; // `${tabControlId}::${tabId}` -> generated $variable name
  const wizardPageVarFor = {}; // `${wizardId}::${pageId}` -> generated $variable name
  const wizardInitCalls = []; // wizard names needing a final `Show-<Name>Page 0` once every control exists

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
        // Show-<Name>Page and Test-<Name>PageRequirements only depend on
        // the page list and each child's own wizardRequired/validation
        // fields (all already known from state.controls at this point),
        // not on when those children get emitted by the main loop below.
        lines.push(...wizardShowFunctionLines(c, pageVarNames, nav.navVarNames));
        lines.push(...wizardTestFunctionLines(c));
        lines.push(`$script:${c.name}_CurrentPage = 0`);
        wizardInitCalls.push(c.name);
        break;
      }
    }

    // events
    const wizardParent = c.parentId ? getControl(c.parentId) : null;
    const isWizardNavBtn = c.wizardRole && wizardParent && CONTROL_DEFS[wizardParent.type].isWizard;
    if (isWizardNavBtn) {
      // Back/Next/Cancel Click code is always generated fresh from the
      // wizard's live page list/validation rules, overriding whatever is
      // stored in events.Click.code - same convention as MenuStrip's
      // autoAbout items regenerating rather than trusting stored text.
      const body = wizardNavClickBody(c, wizardParent);
      lines.push(`$${c.name}.Add_Click({\n    param($sender, $e)\n    ${body}\n})`);
    } else {
      Object.entries(c.events).forEach(([evtName, data]) => {
        if (!data) return;
        const body = data.ps1
          ? `. "${data.ps1}"; ${data.fn}`
          : (data.code || '# TODO: handler body').split('\n').join('\n    ');
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
        lines.push(`$${c.name}.Add_${realEvtName}({\n    param($sender, $e)\n    ${body}\n})`);
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
