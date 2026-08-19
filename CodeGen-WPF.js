/*
    CodeGen-WPF.js
    Written by: Johnathon Largent
    Version 1.0

    Revision:

    1. Split out of codegen.js: wpfMenuXaml, wpfTabXaml, and generateWPF
    - the WPF/XAML output generator (partially implemented: first-pass
    scaffold, see FORMAT_STATUS.wpf in Engine.js). Also dropped
    xamlColorAttr(hex) - a dead identity function with no call sites
    anywhere in the codebase. Depends on orderedControls (CodeGen.js)
    and helpBlockAsHtmlComment (Properties-Pane.js) - load before
    CodeGen.js.
*/

const CODEGEN_WPF_VERSION = '1.0';

function wpfMenuXaml(c, common) {
  const menus = (c.props.menuItems || []).filter(m => m.enabled);
  const menuItem = (m) => {
    const items = (m.items || []).filter(it => it.enabled);
    const children = items.length
      ? `\n      ${items.map(it => it.label === '-' ? `<Separator />` : `<MenuItem Header="${escapeHtml(it.label)}" />`).join('\n      ')}\n    `
      : '';
    return `<MenuItem Header="${escapeHtml(m.label)}">${children}</MenuItem>`;
  };
  return `<Menu ${common}>\n    ${menus.map(menuItem).join('\n    ')}\n  </Menu>`;
}

function wpfTabXaml(c, common) {
  const tabs = c.props.tabs || [];
  const items = tabs.map(tab => `<TabItem Header="${escapeHtml(tab.label)}" />`).join('\n    ');
  return `<TabControl ${common}>\n    ${items}\n  </TabControl>`;
}

function generateWPF() {
  const f = state.form;
  const ctrls = orderedControls().filter(c => !c.parentId);

  const wpfTag = {
    Button: 'Button', Label: 'Label', TextBox: 'TextBox', CheckBox: 'CheckBox',
    RadioButton: 'RadioButton', ComboBox: 'ComboBox', ListBox: 'ListBox', Panel: 'Border',
    GroupBox: 'GroupBox', PictureBox: 'Image', ProgressBar: 'ProgressBar',
    TrackBar: 'Slider', NumericUpDown: 'TextBox', DateTimePicker: 'DatePicker',
    RichTextBox: 'TextBox', LinkLabel: 'TextBlock', CheckedListBox: 'ListBox',
    MaskedTextBox: 'TextBox', FlowLayoutPanel: 'WrapPanel', TableLayoutPanel: 'Grid',
    StatusStrip: 'StatusBar', ToolStrip: 'ToolBar',
  };

  const elFor = (c) => {
    const p = c.props;
    const tag = wpfTag[c.type];
    const common = `x:Name="${c.name}" Canvas.Left="${c.x}" Canvas.Top="${c.y}" Width="${c.w}" Height="${c.h}" Visibility="${p.visible === false ? 'Collapsed' : 'Visible'}" IsEnabled="${!!p.enabled}"`;
    switch (c.type) {
      case 'Button': return `<Button ${common} Content="${escapeHtml(p.text)}" Background="${p.backColor}" Foreground="${p.foreColor}" Click="${c.events.Click ? c.events.Click.fn : ''}" />`;
      case 'Label': return `<Label ${common} Content="${escapeHtml(p.text)}" Foreground="${p.foreColor}" />`;
      case 'TextBox': return `<TextBox ${common} Text="${escapeHtml(p.text)}" IsReadOnly="${!!p.readOnly}" />`;
      case 'CheckBox': return `<CheckBox ${common} Content="${escapeHtml(p.text)}" IsChecked="${!!p.checked}" />`;
      case 'RadioButton': return `<RadioButton ${common} Content="${escapeHtml(p.text)}" GroupName="${p.groupName}" IsChecked="${!!p.checked}" />`;
      case 'ComboBox': return `<ComboBox ${common}>\n${(p.items || '').split('\n').filter(Boolean).map(it => `      <ComboBoxItem>${escapeHtml(it)}</ComboBoxItem>`).join('\n')}\n    </ComboBox>`;
      case 'ListBox': return `<ListBox ${common}>\n${(p.items || '').split('\n').filter(Boolean).map(it => `      <ListBoxItem>${escapeHtml(it)}</ListBoxItem>`).join('\n')}\n    </ListBox>`;
      case 'GroupBox': return `<GroupBox ${common} Header="${escapeHtml(p.text)}" />`;
      case 'ProgressBar': return `<ProgressBar ${common} Minimum="${p.min}" Maximum="${p.max}" Value="${p.value}" />`;
      case 'TrackBar': return `<Slider ${common} Minimum="${p.min}" Maximum="${p.max}" Value="${p.value}" />`;
      case 'PictureBox': return `<Image ${common} Source="${escapeHtml(p.imageSource)}" Stretch="Uniform" />`;
      case 'LinkLabel': return `<TextBlock ${common} Text="${escapeHtml(p.text)}" Foreground="#2dd4bf" TextDecorations="Underline" />`;
      case 'MenuStrip': return wpfMenuXaml(c, common);
      case 'TabControl': return wpfTabXaml(c, common);
      default: return `<${tag} ${common} />`;
    }
  };

  const header = helpBlockAsHtmlComment();

  const xaml = `<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="${escapeHtml(f.text)}" Width="${f.width}" Height="${f.height}" Background="${f.backColor}"
        ResizeMode="${(f.formBorderStyle === 'Sizable' || f.formBorderStyle === 'SizableToolWindow') ? 'CanResize' : 'NoResize'}" WindowStartupLocation="${f.startPosition === 'CenterScreen' ? 'CenterScreen' : 'Manual'}" Topmost="${f.topMost}">
  <Canvas>
    ${ctrls.map(elFor).join('\n    ')}
  </Canvas>
</Window>`;

  return header + xaml;
}
