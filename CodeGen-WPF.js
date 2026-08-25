/*
    CodeGen-WPF.js
    Written by: Johnathon Largent
    Version 1.1

    Revision:

    1. Full parity rewrite (was a first-pass scaffold). Nested containers
    now genuinely nest (Panel/GroupBox/TabControl pages wrap a Canvas so
    absolutely-positioned children work the same way they do on the
    design canvas; FlowLayoutPanel/TableLayoutPanel host children
    directly, matching WinForms CodeGen's own level of fidelity for
    those two). Added real event binding: the generated PS1 now loads
    the XAML via XamlReader, FindName's every control, and wires
    Add_<Event> handlers - with an explicit WPF_EVENT_OVERRIDES map for
    events that rename (SelectedIndexChanged -> SelectionChanged),
    dual-register (CheckedChanged -> Checked+Unchecked), or have no
    clean WPF equivalent (left as a commented-out TODO instead of
    silently generating a broken handler). Added previously-missing
    per-type cases (NumericUpDown, DateTimePicker, RichTextBox,
    CheckedListBox, MaskedTextBox, FlowLayoutPanel, TableLayoutPanel,
    StatusStrip, ToolStrip) that used to fall through to an empty
    self-closed tag. MenuStrip items now get x:Name + Add_Click wiring
    (mirrors CodeGen-WinForms.js's menu handling) and a $Form = $Window
    alias is emitted so preset menu action code written for WinForms'
    $Form convention (Open/Save/Exit/About) works unchanged here. Also
    added single-file (embedded here-string XAML) vs dual-file
    (external .xaml, loaded via Get-Content/$PSScriptRoot) output,
    driven by wpfFileMode/wpfXamlFileNameOverride module state (a
    Show Code modal view-only toggle - not part of saved project
    state), with setWpfFileMode/setWpfXamlFileName/isValidWpfXamlPath
    exposed for Engine.js to wire up. Depends on orderedControls
    (CodeGen.js) and helpBlockAsPs1Comment/helpBlockAsHtmlComment
    (Properties-Pane.js) - load before CodeGen.js.
*/

const CODEGEN_WPF_VERSION = '1.1';

/* =========================================================================
   Single/dual-file mode state (Show Code modal view-only toggle - does
   NOT persist as part of the saved project, matches John's spec that
   this lives in the modal, not the properties pane or a global setting)
   ========================================================================= */

let wpfFileMode = 'single'; // 'single' (embedded XAML) | 'dual' (external XAML file)
let wpfXamlFileNameOverride = null; // user-edited path; null = auto-derive from the form/window name

// Accepts a bare filename or a relative path ("ui.xaml", "./ui.xaml",
// "./otherfolder/ui.xaml") ending in .xaml.
const WPF_XAML_PATH_RE = /^(\.\/)?([A-Za-z0-9_\-]+\/)*[A-Za-z0-9_\-]+\.xaml$/i;

function defaultWpfXamlFileName() {
  const base = (state.form.text || '').replace(/[^A-Za-z0-9_\-]/g, '');
  return `${base || 'Window'}.xaml`;
}

function currentWpfXamlFileName() {
  return wpfXamlFileNameOverride || defaultWpfXamlFileName();
}

function getWpfFileMode() { return wpfFileMode; }

function setWpfFileMode(mode) {
  wpfFileMode = mode === 'dual' ? 'dual' : 'single';
}

function isValidWpfXamlPath(raw) {
  const trimmed = (raw || '').trim().replace(/\\/g, '/');
  return WPF_XAML_PATH_RE.test(trimmed);
}

// Returns { ok, value, error }. An empty entry clears the override back
// to the auto-derived default (ok: true).
function setWpfXamlFileName(raw) {
  const trimmed = (raw || '').trim().replace(/\\/g, '/');
  if (!trimmed) {
    wpfXamlFileNameOverride = null;
    return { ok: true, value: currentWpfXamlFileName() };
  }
  if (!WPF_XAML_PATH_RE.test(trimmed)) {
    return { ok: false, value: trimmed, error: 'Use a filename or relative path ending in .xaml, e.g. ui.xaml or ./sub/ui.xaml' };
  }
  wpfXamlFileNameOverride = trimmed;
  return { ok: true, value: trimmed };
}

/* =========================================================================
   Control type -> WPF element tag
   ========================================================================= */

const WPF_TAG = {
  Button: 'Button', Label: 'Label', TextBox: 'TextBox', CheckBox: 'CheckBox',
  RadioButton: 'RadioButton', ComboBox: 'ComboBox', ListBox: 'ListBox', Panel: 'Border',
  GroupBox: 'GroupBox', PictureBox: 'Image', ProgressBar: 'ProgressBar',
  TrackBar: 'Slider', NumericUpDown: 'TextBox', DateTimePicker: 'DatePicker',
  RichTextBox: 'TextBox', LinkLabel: 'TextBlock', CheckedListBox: 'ListBox',
  MaskedTextBox: 'TextBox', FlowLayoutPanel: 'WrapPanel', TableLayoutPanel: 'Grid',
  StatusStrip: 'StatusBar', ToolStrip: 'ToolBar',
};

/* =========================================================================
   Event name mapping - WinForms event name -> WPF equivalent, per control
   type. `null` means there's no clean WPF equivalent (handler is emitted
   commented-out with a note, never silently dropped or wired to a
   nonexistent event). A "DUAL:A,B" value means register the same handler
   body on both A and B (e.g. CheckedChanged has no single WPF match, but
   Checked+Unchecked together cover the same ground). Anything not listed
   here uses the same event name as WinForms - true for the common ones
   (Click, TextChanged, KeyDown, ValueChanged on Slider, etc).
   ========================================================================= */

const WPF_EVENT_OVERRIDES = {
  CheckBox: { CheckedChanged: 'DUAL:Checked,Unchecked' },
  RadioButton: { CheckedChanged: 'DUAL:Checked,Unchecked' },
  ComboBox: { SelectedIndexChanged: 'SelectionChanged', TextChanged: null },
  ListBox: { SelectedIndexChanged: 'SelectionChanged' },
  CheckedListBox: { ItemCheck: null },
  DateTimePicker: { ValueChanged: 'SelectedDateChanged' },
  TextBox: { Enter: 'GotFocus', Leave: 'LostFocus' },
  MaskedTextBox: { MaskInputRejected: null },
  NumericUpDown: { ValueChanged: 'TextChanged' },
  TrackBar: { Scroll: null },
  Label: { Click: 'MouseLeftButtonDown' },
  Panel: { Click: 'MouseLeftButtonDown' },
  PictureBox: { Click: 'MouseLeftButtonDown' },
  FlowLayoutPanel: { Click: 'MouseLeftButtonDown' },
  TableLayoutPanel: { Click: 'MouseLeftButtonDown' },
  LinkLabel: { LinkClicked: 'MouseLeftButtonDown' },
};

function wpfEventNameFor(controlType, evtName) {
  const overrides = WPF_EVENT_OVERRIDES[controlType];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, evtName)) return overrides[evtName];
  return evtName;
}

/* =========================================================================
   XAML element tree
   ========================================================================= */

function wpfChildrenXaml(parentId, tabPage) {
  const kids = orderedControls().filter(c => c.parentId === parentId && (tabPage === undefined || c.tabPage === tabPage));
  return kids.map(wpfElementXaml).join('\n');
}

// Canvas doesn't support WinForms-style Dock/Anchor - flagged inline
// rather than silently dropped, same honesty level as the WinForms
// generator's own "# TODO" comments for things it can't fully port.
function wpfLayoutNote(c) {
  const p = c.props;
  const notes = [];
  if (p.dock && p.dock !== 'None') notes.push(`Dock="${p.dock}"`);
  if (p.anchor && p.anchor !== 'Top, Left') notes.push(`Anchor="${p.anchor}"`);
  if (!notes.length) return '';
  return `<!-- NOTE: ${c.name} used WinForms ${notes.join(', ')} - WPF's Canvas has no direct equivalent; move this control into a DockPanel/Grid if that behavior matters. -->\n  `;
}

function wpfMenuXaml(c, common) {
  const menus = (c.props.menuItems || []).filter(m => m.enabled);
  const menuItemXaml = (m) => {
    const menuVar = `${c.name}_${m.id}`;
    const items = (m.items || []).filter(it => it.enabled);
    const children = items.length
      ? `\n      ${items.map(it => {
          if (it.label === '-') return `<Separator />`;
          const itemVar = `${menuVar}_${it.id.replace(new RegExp('^' + m.id + '_'), '')}`;
          return `<MenuItem x:Name="${itemVar}" Header="${escapeHtml(it.label)}" />`;
        }).join('\n      ')}\n    `
      : '';
    return `<MenuItem x:Name="${menuVar}" Header="${escapeHtml(m.label)}">${children}</MenuItem>`;
  };
  return `<Menu ${common}>\n    ${menus.map(menuItemXaml).join('\n    ')}\n  </Menu>`;
}

function wpfTabXaml(c, common) {
  const tabs = c.props.tabs || [];
  const items = tabs.map(tab => `<TabItem Header="${escapeHtml(tab.label)}">\n      <Canvas>\n        ${wpfChildrenXaml(c.id, tab.id)}\n      </Canvas>\n    </TabItem>`).join('\n    ');
  return `<TabControl ${common}>\n    ${items}\n  </TabControl>`;
}

function wpfElementCore(c) {
  const p = c.props;
  const tag = WPF_TAG[c.type];
  const common = `x:Name="${c.name}" Canvas.Left="${c.x}" Canvas.Top="${c.y}" Width="${c.w}" Height="${c.h}" Visibility="${p.visible === false ? 'Collapsed' : 'Visible'}" IsEnabled="${!!p.enabled}"`;
  switch (c.type) {
    case 'Button':
      return `<Button ${common} Content="${escapeHtml(p.text)}" Background="${p.backColor}" Foreground="${p.foreColor}" />`;
    case 'Label':
      return `<Label ${common} Content="${escapeHtml(p.text)}" Foreground="${p.foreColor}" />`;
    case 'TextBox':
      return `<TextBox ${common} Text="${escapeHtml(p.text)}" IsReadOnly="${!!p.readOnly}" Background="${p.backColor}" Foreground="${p.foreColor}" ${p.multiline ? 'AcceptsReturn="True" TextWrapping="Wrap"' : ''} />`;
    case 'RichTextBox':
      return `<TextBox ${common} Text="${escapeHtml(p.text)}" AcceptsReturn="True" TextWrapping="Wrap" Background="${p.backColor}" Foreground="${p.foreColor}" />`;
    case 'MaskedTextBox':
      return `<TextBox ${common} Text="${escapeHtml(p.text)}" Background="${p.backColor}" Foreground="${p.foreColor}" />`;
    case 'NumericUpDown':
      return `<TextBox ${common} Text="${escapeHtml(p.value)}" Background="${p.backColor}" Foreground="${p.foreColor}" />`;
    case 'CheckBox':
      return `<CheckBox ${common} Content="${escapeHtml(p.text)}" IsChecked="${!!p.checked}" Foreground="${p.foreColor}" />`;
    case 'RadioButton':
      return `<RadioButton ${common} Content="${escapeHtml(p.text)}" GroupName="${p.groupName}" IsChecked="${!!p.checked}" Foreground="${p.foreColor}" />`;
    case 'ComboBox':
      return `<ComboBox ${common} IsEditable="${p.dropDownStyle !== 'DropDownList'}" Background="${p.backColor}" Foreground="${p.foreColor}">\n${(p.items || '').split('\n').filter(Boolean).map(it => `      <ComboBoxItem>${escapeHtml(it)}</ComboBoxItem>`).join('\n')}\n    </ComboBox>`;
    case 'ListBox':
    case 'CheckedListBox':
      return `<ListBox ${common} Background="${p.backColor}" Foreground="${p.foreColor}">\n${(p.items || '').split('\n').filter(Boolean).map(it => `      <ListBoxItem>${escapeHtml(it)}</ListBoxItem>`).join('\n')}\n    </ListBox>`;
    case 'DateTimePicker':
      return `<DatePicker ${common} />`;
    case 'GroupBox':
      return `<GroupBox ${common} Header="${escapeHtml(p.text)}">\n    <Canvas>\n      ${wpfChildrenXaml(c.id)}\n    </Canvas>\n  </GroupBox>`;
    case 'Panel':
      return `<Border ${common} Background="${p.backColor}" BorderBrush="#444444" BorderThickness="1">\n    <Canvas>\n      ${wpfChildrenXaml(c.id)}\n    </Canvas>\n  </Border>`;
    case 'ProgressBar':
      return `<ProgressBar ${common} Minimum="${p.min}" Maximum="${p.max}" Value="${p.value}" />`;
    case 'TrackBar':
      return `<Slider ${common} Minimum="${p.min}" Maximum="${p.max}" Value="${p.value}" TickFrequency="${p.tickFrequency}" />`;
    case 'PictureBox':
      return `<Image ${common} Source="${escapeHtml(p.imageSource)}" Stretch="Uniform" />`;
    case 'LinkLabel':
      return `<TextBlock ${common} Text="${escapeHtml(p.text)}" Foreground="#2dd4bf" TextDecorations="Underline" Cursor="Hand" />`;
    case 'MenuStrip':
      return wpfMenuXaml(c, common);
    case 'TabControl':
      return wpfTabXaml(c, common);
    case 'FlowLayoutPanel': {
      const orientation = (p.flowDirection === 'TopDown' || p.flowDirection === 'BottomUp') ? 'Vertical' : 'Horizontal';
      return `<WrapPanel ${common} Orientation="${orientation}">\n    ${wpfChildrenXaml(c.id)}\n  </WrapPanel>`;
    }
    case 'TableLayoutPanel': {
      const cols = Array.from({ length: Math.max(1, p.columnCount || 1) }, () => `<ColumnDefinition />`).join('\n      ');
      const rows = Array.from({ length: Math.max(1, p.rowCount || 1) }, () => `<RowDefinition />`).join('\n      ');
      return `<Grid ${common}>\n    <Grid.ColumnDefinitions>\n      ${cols}\n    </Grid.ColumnDefinitions>\n    <Grid.RowDefinitions>\n      ${rows}\n    </Grid.RowDefinitions>\n    ${wpfChildrenXaml(c.id)}\n  </Grid>`;
    }
    case 'StatusStrip':
      return `<StatusBar ${common}>\n    <StatusBarItem>\n      <TextBlock Text="${escapeHtml(p.text)}" />\n    </StatusBarItem>\n  </StatusBar>`;
    case 'ToolStrip': {
      const items = p.items || [];
      const btns = items.map(it => `<Button Content="${escapeHtml(it.label)}" Margin="2,0" Padding="6,2" />`).join('\n      ');
      return `<ToolBar ${common}>\n      ${btns}\n    </ToolBar>`;
    }
    default:
      return `<${tag} ${common} />`;
  }
}

function wpfElementXaml(c) {
  return wpfLayoutNote(c) + wpfElementCore(c);
}

function wpfWindowXaml() {
  const f = state.form;
  const ctrls = orderedControls().filter(c => !c.parentId);
  return `<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="${escapeHtml(f.text)}" Width="${f.width}" Height="${f.height}" Background="${f.backColor}"
        ResizeMode="${(f.formBorderStyle === 'Sizable' || f.formBorderStyle === 'SizableToolWindow') ? 'CanResize' : 'NoResize'}" WindowStartupLocation="${f.startPosition === 'CenterScreen' ? 'CenterScreen' : 'Manual'}" Topmost="${f.topMost}">
  <Canvas>
    ${ctrls.map(wpfElementXaml).join('\n    ')}
  </Canvas>
</Window>`;
}

// Standalone .xaml file content (dual-file mode's second box) - includes
// the help-block header as an XML comment since this file stands on its
// own, unlike the embedded copy inside the PS1 here-string.
function generateWPFXaml() {
  return helpBlockAsHtmlComment() + wpfWindowXaml();
}

/* =========================================================================
   PS1 host script: FindName lookups, event wiring, menu wiring
   ========================================================================= */

function wpfEventLines(c) {
  const lines = [];
  Object.entries(c.events).forEach(([evtName, data]) => {
    if (!data) return;
    const body = data.ps1
      ? `. "${data.ps1}"; ${data.fn}`
      : (data.code || '# TODO: handler body').split('\n').join('\n    ');
    const realEvtName = evtName === 'ClickToClose' ? 'Click' : evtName;
    const closeExtra = evtName === 'ClickToClose' ? `\n    $Window.Close()` : '';
    const mapped = wpfEventNameFor(c.type, realEvtName);

    if (mapped === null) {
      lines.push(`# NOTE: "${evtName}" has no clean WPF equivalent for a ${c.type} (rendered as ${WPF_TAG[c.type]}) - left commented out, port manually if needed:`);
      lines.push(`# $${c.name}.Add_<Event>({`);
      lines.push(`#     param($sender, $e)`);
      `    ${body}${closeExtra}`.split('\n').forEach(l => lines.push(`#     ${l}`));
      lines.push(`# })`);
      return;
    }

    if (mapped.startsWith('DUAL:')) {
      mapped.slice(5).split(',').forEach(en => {
        lines.push(`$${c.name}.Add_${en}({\n    param($sender, $e)\n    ${body}${closeExtra}\n})`);
      });
      return;
    }

    lines.push(`$${c.name}.Add_${mapped}({\n    param($sender, $e)\n    ${body}${closeExtra}\n})`);
  });
  return lines;
}

// Runtime state that can't be expressed by just declaring the XAML
// (selections, checked indices) - set after FindName, mirrors what the
// WinForms generator does right after New-Object for the same controls.
function wpfPostLoadLines(c) {
  const p = c.props;
  const lines = [];
  if (c.type === 'ComboBox' && p.selectedIndex >= 0) {
    lines.push(`$${c.name}.SelectedIndex = ${p.selectedIndex}`);
  } else if (c.type === 'ListBox') {
    (p.selectedIndices || []).forEach(i => lines.push(`$${c.name}.SelectedItems.Add($${c.name}.Items[${i}])`));
  }
  return lines;
}

function wpfMenuFindNameLines(c) {
  const lines = [];
  const menus = (c.props.menuItems || []).filter(m => m.enabled);
  menus.forEach(m => {
    const menuVar = `${c.name}_${m.id}`;
    lines.push(`$${menuVar} = $Window.FindName("${menuVar}")`);
    (m.items || []).filter(it => it.enabled && it.label !== '-').forEach(it => {
      const itemVar = `${menuVar}_${it.id.replace(new RegExp('^' + m.id + '_'), '')}`;
      lines.push(`$${itemVar} = $Window.FindName("${itemVar}")`);
    });
  });
  return lines;
}

function wpfMenuEventLines(c) {
  const lines = [];
  const menus = (c.props.menuItems || []).filter(m => m.enabled);
  menus.forEach(m => {
    const menuVar = `${c.name}_${m.id}`;
    (m.items || []).filter(it => it.enabled && it.label !== '-').forEach(it => {
      const itemVar = `${menuVar}_${it.id.replace(new RegExp('^' + m.id + '_'), '')}`;
      const code = menuItemCodeFor(it, 'wpf');
      if (code && code.trim()) {
        lines.push(`$${itemVar}.Add_Click({\n    ${code.split('\n').join('\n    ')}\n})`);
      }
    });
  });
  return lines;
}

function generateWPF() {
  const mode = wpfFileMode;
  const ctrls = orderedControls();
  const menuStrips = state.controls.filter(c => c.type === 'MenuStrip');
  const lines = [];

  lines.push(`Add-Type -AssemblyName PresentationFramework`);
  lines.push(`Add-Type -AssemblyName PresentationCore`);
  lines.push(`Add-Type -AssemblyName WindowsBase`);
  lines.push(`Add-Type -AssemblyName System.Windows.Forms`); // preset menu actions (Open/Save dialogs, MessageBox) reuse the WinForms dialog classes
  lines.push(`Add-Type -AssemblyName System.Drawing`);
  lines.push('');

  if (mode === 'dual') {
    const rel = currentWpfXamlFileName().replace(/^\.\//, '');
    lines.push(`$XamlPath = Join-Path $PSScriptRoot "${rel}"`);
    lines.push(`[xml]$XamlData = Get-Content -Path $XamlPath -Raw`);
  } else {
    lines.push(`[xml]$XamlData = @'`);
    lines.push(wpfWindowXaml());
    lines.push(`'@`);
  }
  lines.push('');
  lines.push(`$Reader = New-Object System.Xml.XmlNodeReader $XamlData`);
  lines.push(`$Window = [Windows.Markup.XamlReader]::Load($Reader)`);
  lines.push(`$Form = $Window  # alias - lets preset menu action code (Open/Save/Exit/About, written for WinForms' $Form convention) run unchanged here`);
  lines.push('');

  lines.push(`# Named element lookups`);
  ctrls.forEach(c => lines.push(`$${c.name} = $Window.FindName("${c.name}")`));
  menuStrips.forEach(c => wpfMenuFindNameLines(c).forEach(l => lines.push(l)));
  lines.push('');

  const postLoad = [];
  ctrls.forEach(c => postLoad.push(...wpfPostLoadLines(c)));
  if (postLoad.length) {
    lines.push(`# Selection / checked-state restore`);
    lines.push(...postLoad);
    lines.push('');
  }

  ctrls.forEach(c => {
    const evtLines = wpfEventLines(c);
    if (evtLines.length) {
      lines.push(`# ${c.name} events`);
      lines.push(...evtLines);
      lines.push('');
    }
  });
  menuStrips.forEach(c => {
    const evtLines = wpfMenuEventLines(c);
    if (evtLines.length) {
      lines.push(`# ${c.name} menu actions`);
      lines.push(...evtLines);
      lines.push('');
    }
  });

  lines.push(`[void]$Window.ShowDialog()`);

  return helpBlockAsPs1Comment() + lines.join('\n');
}
