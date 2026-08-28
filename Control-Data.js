/*
    Control-Data.js
    Written by: Johnathon Largent
    Version 1.9

    Revision:

    1. RichTextBox gained a Read Only property (matches TextBox's), off
    by default - needed so a RichTextBox used as an auto-populated log
    (e.g. a wizard Summary page, Wizard-Builder.js) can be locked against
    hand-typing. Wired into CodeGen-WinForms.js. Also added to
    SETTABLE_PROPS_BY_TYPE.RichTextBox so the "Set another control's
    property" event snippet can toggle it too.
*/

const CONTROL_DATA_VERSION = '1.9';

// Which properties make sense to SET on another control from event action
// code, per control type - used by the "Set another control's property"
// snippet so the Property dropdown only ever shows options that control
// type actually has (fixes picking e.g. SelectedIndex on a NumericUpDown,
// which has no such property and would error at runtime).
const SETTABLE_PROPS_BY_TYPE = {
  Button: ['Text', 'Enabled', 'Visible'],
  Label: ['Text', 'Enabled', 'Visible'],
  TextBox: ['Text', 'Enabled', 'Visible', 'ReadOnly'],
  MaskedTextBox: ['Text', 'Enabled', 'Visible'],
  CheckBox: ['Checked', 'Text', 'Enabled', 'Visible'],
  RadioButton: ['Checked', 'Text', 'Enabled', 'Visible'],
  ComboBox: ['SelectedIndex', 'Text', 'Enabled', 'Visible'],
  ListBox: ['SelectedIndex', 'Enabled', 'Visible'],
  CheckedListBox: ['Enabled', 'Visible'],
  Panel: ['Enabled', 'Visible'],
  GroupBox: ['Text', 'Enabled', 'Visible'],
  PictureBox: ['Enabled', 'Visible'],
  ProgressBar: ['Value', 'Enabled', 'Visible'],
  TrackBar: ['Value', 'Enabled', 'Visible'],
  NumericUpDown: ['Value', 'Enabled', 'Visible'],
  DateTimePicker: ['Value', 'Enabled', 'Visible'],
  RichTextBox: ['Text', 'Enabled', 'Visible', 'ReadOnly'],
  LinkLabel: ['Text', 'Enabled', 'Visible'],
};
const DEFAULT_SETTABLE_PROPS = ['Enabled', 'Visible'];

function getSettableProps(type) {
  return SETTABLE_PROPS_BY_TYPE[type] || DEFAULT_SETTABLE_PROPS;
}

// What kind of widget the Value field should be, given the target
// control's type and which property was picked - e.g. a real date input
// for DateTimePicker.Value, a dropdown of the target's own item labels
// for ComboBox/ListBox.SelectedIndex, a toggle for boolean properties.
function resolveValueWidgetKind(targetType, property) {
  if (property === 'Checked' || property === 'Enabled' || property === 'Visible' || property === 'ReadOnly') return 'boolean';
  if (property === 'Value' && targetType === 'DateTimePicker') return 'date';
  if (property === 'Value' && (targetType === 'NumericUpDown' || targetType === 'TrackBar' || targetType === 'ProgressBar')) return 'number';
  if (property === 'SelectedIndex' && (targetType === 'ComboBox' || targetType === 'ListBox')) return 'targetItemIndex';
  return 'text';
}

// Small starter icon library for ToolStrip buttons - a real icon system
// (browsable library, custom uploads) is a bigger future feature; this is
// just enough to make New/Open/Save look like actual toolbar buttons
// instead of plain text. 16x16 line-art, same style as the toolbox icons.
const TOOLSTRIP_ICONS = {
  none: '',
  new: '<path d="M4 1.5h5l3 3v10h-8v-13z"/><path d="M9 1.5v3h3"/>',
  open: '<path d="M1.5 4.5v9a1 1 0 001 1h11a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5H2.5a1 1 0 00-1 1z"/>',
  save: '<rect x="2" y="2" width="12" height="12" rx="1"/><rect x="4.7" y="2" width="4.6" height="3.8"/><rect x="4.2" y="9" width="7.6" height="5"/>',
};

function toolStripIconSvg(key) {
  const inner = TOOLSTRIP_ICONS[key] || '';
  return `<svg class="tool-icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const DEFAULT_TOOLSTRIP_ITEMS = [
  { id: 'new', label: 'New', icon: 'new' },
  { id: 'open', label: 'Open', icon: 'open' },
  { id: 'save', label: 'Save', icon: 'save' },
];

// Property field shorthand: [key, label, type, default, extra]
// type: text | number | px | checkbox | color | select | textarea
const COMMON_APPEARANCE_PROPS = [
  ['backColor', 'Back Color', 'color', '#F0F0F0'],
  ['foreColor', 'Fore Color', 'color', '#000000'],
  ['fontFamily', 'Font Family', 'select', 'Segoe UI', { options: ['Segoe UI', 'Arial', 'Tahoma', 'Consolas', 'Verdana', 'Times New Roman'] }],
  ['fontSize', 'Font Size', 'px', 9],
  ['fontBold', 'Bold', 'checkbox', false],
  ['fontItalic', 'Italic', 'checkbox', false],
  ['borderStyle', 'Border Style', 'select', 'FixedSingle', { options: ['None', 'FixedSingle', 'Fixed3D'] }],
];

const COMMON_BEHAVIOR_PROPS = [
  ['visible', 'Visible', 'checkbox', true],
  ['enabled', 'Enabled', 'checkbox', true],
  ['tabIndex', 'Tab Index', 'number', 0],
  ['toolTip', 'Tool Tip', 'text', ''],
  ['dock', 'Dock', 'select', 'None', { options: ['None', 'Top', 'Bottom', 'Left', 'Right', 'Fill', 'TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'] }],
  ['anchor', 'Anchor', 'anchorEditor', 'Top, Left'],
  ['cursor', 'Cursor', 'select', 'Default', { options: ['Default', 'Hand', 'IBeam', 'Wait', 'Cross', 'SizeAll'] }],
];

// System-color-ish defaults per control type, applied on top of the common
// grey (#F0F0F0) default so text-entry surfaces read as white like a real
// Windows install rather than every control sharing one flat grey.
const TYPE_BACKCOLOR_OVERRIDES = {
  TextBox: '#FFFFFF', ComboBox: '#FFFFFF', ListBox: '#FFFFFF',
  RichTextBox: '#FFFFFF', NumericUpDown: '#FFFFFF', DateTimePicker: '#FFFFFF',
};

// Default MenuStrip content: preset top-level menus (checkbox-enabled), each
// with its own preset sub-items (also checkbox-enabled) plus room for the
// user to add fully custom top-level menus and custom sub-items. Every
// non-separator item ships with real default code (editable per-item),
// not just a label - so File > Exit, Help > About, etc. actually do
// something out of the box instead of being empty stubs.
const PRESET_MENU_DEFAULT = [
  {
    id: 'file', label: 'File', enabled: true, preset: true,
    items: [
      { id: 'file_new', label: 'New', enabled: true, preset: true, code: '# TODO: reset the form/document to a blank state' },
      { id: 'file_open', label: 'Open...', enabled: true, preset: true, code: '$dlg = New-Object System.Windows.Forms.OpenFileDialog\nif ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {\n    # TODO: load $($dlg.FileName)\n}' },
      { id: 'file_save', label: 'Save', enabled: true, preset: true, code: '$dlg = New-Object System.Windows.Forms.SaveFileDialog\nif ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {\n    # TODO: save to $($dlg.FileName)\n}' },
      { id: 'file_sep1', label: '-', enabled: true, preset: true, code: '' },
      { id: 'file_exit', label: 'Exit', enabled: true, preset: true, code: '$Form.Close()' },
    ],
  },
  {
    id: 'view', label: 'View', enabled: true, preset: true,
    items: [
      { id: 'view_zoomin', label: 'Zoom In', enabled: true, preset: true, code: '$script:ZoomLevel = [Math]::Min(200, $script:ZoomLevel + 10)\n[System.Windows.Forms.MessageBox]::Show("Zoom: $script:ZoomLevel%")' },
      { id: 'view_zoomout', label: 'Zoom Out', enabled: true, preset: true, code: '$script:ZoomLevel = [Math]::Max(50, $script:ZoomLevel - 10)\n[System.Windows.Forms.MessageBox]::Show("Zoom: $script:ZoomLevel%")' },
      { id: 'view_reset', label: 'Reset Zoom', enabled: true, preset: true, code: '$script:ZoomLevel = 100\n[System.Windows.Forms.MessageBox]::Show("Zoom: $script:ZoomLevel%")' },
    ],
  },
  {
    id: 'help', label: 'Help', enabled: true, preset: true,
    items: [
      { id: 'help_docs', label: 'Documentation', enabled: true, preset: true, code: 'Start-Process "https://example.com/docs"' },
      { id: 'help_about', label: 'About', enabled: true, preset: true, code: '', autoAbout: true },
    ],
  },
];

// Default TabControl content: two starter tab pages. Each tab page holds
// its own separate set of children (tracked via each child's `tabPage`
// field), so controls placed on Tab1 don't show up on Tab2.
const DEFAULT_TABS = [
  { id: 'tab1', label: 'Tab1' },
  { id: 'tab2', label: 'Tab2' },
];

// Fallback page set for a Wizard control - only used if one is ever
// created outside the guided setup modal (e.g. programmatically). Real
// instances get their pages array overwritten by createWizardFromSetup()
// in Wizard-Builder.js, which also populates each page's template content
// and the Back/Next/Cancel footer buttons.
const DEFAULT_WIZARD_PAGES = [
  { id: 'PageWelcome', label: 'Welcome', template: 'welcome', requirements: [] },
  { id: 'PageOptions', label: 'Options', template: 'options', requirements: [] },
  { id: 'PageSummary', label: 'Summary', template: 'summary', requirements: [] },
];

const CONTROL_DEFS = {
  Button: {
    label: 'Button', glyph: 'Bt', defaultW: 90, defaultH: 26,
    props: [['text', 'Text', 'text', 'Button']],
    events: ['Click', 'ClickToClose'],
  },
  Label: {
    label: 'Label', glyph: 'Ab', defaultW: 90, defaultH: 20,
    props: [
      ['text', 'Text', 'text', 'Label'],
      ['textAlign', 'Text Align', 'select', 'Left', { options: ['Left', 'Center', 'Right'] }],
    ],
    events: ['Click'],
  },
  TextBox: {
    label: 'TextBox', glyph: 'Tb', defaultW: 120, defaultH: 22,
    props: [
      ['text', 'Text', 'text', ''],
      ['multiline', 'Multiline', 'checkbox', false],
      ['readOnly', 'Read Only', 'checkbox', false],
      ['passwordChar', 'Password Char', 'text', ''],
      ['maxLength', 'Max Length', 'number', 0],
    ],
    events: ['TextChanged', 'Enter', 'Leave', 'KeyDown'],
  },
  CheckBox: {
    label: 'CheckBox', glyph: 'Ck', defaultW: 110, defaultH: 22,
    props: [
      ['text', 'Text', 'text', 'CheckBox'],
      ['checked', 'Checked', 'checkbox', false],
    ],
    events: ['CheckedChanged', 'Click'],
  },
  RadioButton: {
    label: 'Radio Button', glyph: 'Rb', defaultW: 110, defaultH: 22,
    props: [
      ['text', 'Text', 'text', 'RadioButton'],
      ['checked', 'Checked', 'checkbox', false],
      ['groupName', 'Group Name', 'text', 'group1'],
    ],
    events: ['CheckedChanged', 'Click'],
  },
  ComboBox: {
    label: 'ComboBox', glyph: 'Cb', defaultW: 130, defaultH: 22,
    props: [
      ['items', 'Items', 'itemsListEditor', 'Item 1\nItem 2\nItem 3'],
      ['selectedIndex', 'Selected Index', 'number', -1],
      ['dropDownStyle', 'DropDown Style', 'select', 'DropDown', { options: ['DropDown', 'DropDownList', 'Simple'] }],
      ['text', 'Text (design-time)', 'hidden', ''],
    ],
    events: ['SelectedIndexChanged', 'TextChanged'],
  },
  ListBox: {
    label: 'ListBox', glyph: 'Lb', defaultW: 130, defaultH: 90,
    props: [
      ['items', 'Items', 'itemsListEditor', 'Item 1\nItem 2\nItem 3'],
      ['selectionMode', 'Selection Mode', 'select', 'One', { options: ['None', 'One', 'MultiSimple', 'MultiExtended'] }],
      ['selectedIndices', 'Selected Indices (design-time)', 'hidden', []],
    ],
    events: ['SelectedIndexChanged'],
  },
  CheckedListBox: {
    label: 'CheckedListBox', glyph: 'Cl', defaultW: 140, defaultH: 100,
    props: [
      ['items', 'Items', 'itemsListEditor', 'Item 1\nItem 2\nItem 3'],
      ['checkOnClick', 'Check On Click', 'checkbox', true],
      ['checkedIndices', 'Checked Indices (design-time)', 'hidden', []],
    ],
    events: ['ItemCheck'],
  },
  Panel: {
    label: 'Panel', glyph: 'Pn', defaultW: 200, defaultH: 140,
    props: [], events: ['Click'], isContainer: true,
  },
  GroupBox: {
    label: 'GroupBox', glyph: 'Gb', defaultW: 200, defaultH: 140,
    props: [['text', 'Text', 'text', 'GroupBox']],
    events: [], isContainer: true,
  },
  PictureBox: {
    label: 'PictureBox', glyph: 'Px', defaultW: 100, defaultH: 100,
    props: [
      ['imageSource', 'Image Source', 'text', ''],
      ['sizeMode', 'Size Mode', 'select', 'Zoom', { options: ['Normal', 'StretchImage', 'AutoSize', 'CenterImage', 'Zoom'] }],
    ],
    events: ['Click'],
  },
  ProgressBar: {
    label: 'ProgressBar', glyph: '%%', defaultW: 150, defaultH: 20,
    props: [
      ['min', 'Min', 'number', 0],
      ['max', 'Max', 'number', 100],
      ['value', 'Value', 'number', 40],
    ],
    events: [],
  },
  TrackBar: {
    label: 'TrackBar', glyph: '/\\', defaultW: 150, defaultH: 30,
    props: [
      ['min', 'Min', 'number', 0],
      ['max', 'Max', 'number', 10],
      ['value', 'Value', 'number', 5],
      ['tickFrequency', 'Tick Frequency', 'number', 1],
    ],
    events: ['ValueChanged', 'Scroll'],
  },
  NumericUpDown: {
    label: 'NumericUpDown', glyph: '#u', defaultW: 80, defaultH: 22,
    props: [
      ['min', 'Min', 'number', 0],
      ['max', 'Max', 'number', 100],
      ['value', 'Value', 'number', 0],
      ['increment', 'Increment', 'number', 1],
      ['decimalPlaces', 'Decimal Places', 'number', 0],
    ],
    events: ['ValueChanged'],
  },
  DateTimePicker: {
    label: 'DateTimePicker', glyph: 'Dt', defaultW: 130, defaultH: 22,
    props: [
      ['format', 'Format', 'select', 'Custom', { options: ['Custom', 'Long', 'Short', 'Time'] }],
      ['customFormat', 'Custom Format', 'text', 'dd MMM yyyy'],
      ['value', 'Value', 'text', ''],
    ],
    events: ['ValueChanged'],
  },
  RichTextBox: {
    label: 'RichTextBox', glyph: 'Rt', defaultW: 180, defaultH: 100,
    props: [
      ['text', 'Text', 'textarea', ''],
      ['readOnly', 'Read Only', 'checkbox', false],
    ],
    events: ['TextChanged'],
  },
  LinkLabel: {
    label: 'LinkLabel', glyph: 'Ln', defaultW: 100, defaultH: 20,
    props: [
      ['text', 'Text', 'text', 'link'],
      ['url', 'URL', 'text', 'https://'],
    ],
    events: ['LinkClicked'],
  },
  MenuStrip: {
    label: 'MenuStrip', glyph: 'Mn', defaultW: 400, defaultH: 26,
    props: [
      ['menuItems', 'Menu Items', 'menuEditor', PRESET_MENU_DEFAULT],
    ],
    events: [],
    isMenuStrip: true,
  },
  TabControl: {
    label: 'TabControl', glyph: 'Tc', defaultW: 320, defaultH: 220,
    props: [
      ['tabs', 'Tabs', 'tabEditor', DEFAULT_TABS],
    ],
    events: [],
    isContainer: true,
    isTabControl: true,
  },
  MaskedTextBox: {
    label: 'MaskedTextBox', glyph: 'Mt', defaultW: 130, defaultH: 22,
    props: [
      ['mask', 'Mask', 'text', '(000) 000-0000'],
      ['text', 'Text', 'text', ''],
    ],
    events: ['TextChanged', 'MaskInputRejected'],
  },
  FlowLayoutPanel: {
    label: 'FlowLayoutPanel', glyph: 'Fl', defaultW: 220, defaultH: 140,
    props: [
      ['flowDirection', 'Flow Direction', 'select', 'LeftToRight', { options: ['LeftToRight', 'TopDown', 'RightToLeft', 'BottomUp'] }],
      ['wrapContents', 'Wrap Contents', 'checkbox', true],
    ],
    events: ['Click'],
    isContainer: true,
  },
  TableLayoutPanel: {
    label: 'TableLayoutPanel', glyph: 'Tl', defaultW: 220, defaultH: 140,
    props: [
      ['columnCount', 'Columns', 'number', 2],
      ['rowCount', 'Rows', 'number', 2],
    ],
    events: ['Click'],
    isContainer: true,
  },
  StatusStrip: {
    label: 'StatusStrip', glyph: 'Ss', defaultW: 400, defaultH: 24,
    props: [
      ['text', 'Text', 'text', 'Ready'],
    ],
    events: [],
  },
  ToolStrip: {
    label: 'ToolStrip', glyph: 'Ts', defaultW: 300, defaultH: 26,
    props: [
      ['items', 'Items', 'toolStripItemsEditor', DEFAULT_TOOLSTRIP_ITEMS],
    ],
    events: [],
  },
  Wizard: {
    label: 'Multipage Wizard', glyph: 'Wz', defaultW: 460, defaultH: 320,
    props: [
      ['contentsStyle', 'Contents', 'select', 'None', { options: ['None', 'Horizontal', 'Horizontal Flat', 'Vertical', 'Vertical Flat'] }],
      ['pages', 'Pages', 'wizardPagesEditor', DEFAULT_WIZARD_PAGES],
    ],
    events: [],
    isContainer: true,
    isWizard: true,
  },
};

// Real vector icons for the toolbox, one per control type - replaces the
// old two-letter glyph abbreviations (Bt/Tb/Ck/etc). Each entry is just
// the inner SVG markup; toolIconSvg() wraps it in a shared 16x16 <svg>
// using currentColor so it follows the theme automatically.
const TOOL_ICONS = {
  Button: `<rect x="1.5" y="4.5" width="13" height="7" rx="1.5"/>`,
  Label: `<path d="M2 4.5h7M2 8h10M2 11.5h5"/>`,
  TextBox: `<rect x="1.5" y="4" width="13" height="8" rx="1"/><path d="M4.2 6.2v3.6"/>`,
  CheckBox: `<rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M5.2 8.2l2 2 3.6-4.2"/>`,
  RadioButton: `<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>`,
  ComboBox: `<rect x="1.5" y="4" width="13" height="8" rx="1"/><path d="M10.3 6.7l1.4 1.5 1.4-1.5"/>`,
  ListBox: `<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M4 5.5h8M4 8h8M4 10.5h5"/>`,
  CheckedListBox: `<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><rect x="3.3" y="4.3" width="2.6" height="2.6" rx="0.4"/><path d="M3.7 5.6l0.6 0.6 1.2-1.3"/><path d="M7.3 5.6h5.2"/><rect x="3.3" y="9" width="2.6" height="2.6" rx="0.4"/><path d="M7.3 10.3h5.2"/>`,
  Panel: `<rect x="1.5" y="1.5" width="13" height="13" rx="1"/>`,
  GroupBox: `<path d="M1.5 4.6V13.5h13V4.6H8.3M1.5 4.6h2.3M6.3 4.6c0-1.15.9-2.1 2-2.1s2 .95 2 2.1"/>`,
  PictureBox: `<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><circle cx="5.3" cy="6" r="1.2"/><path d="M2 12l3.7-3.8 2.5 2.3L12 6.8l2 2.4"/>`,
  ProgressBar: `<rect x="1.5" y="6" width="13" height="4" rx="1"/><rect x="2.3" y="6.8" width="6.5" height="2.4" fill="currentColor" stroke="none"/>`,
  TrackBar: `<path d="M1.5 8h13"/><circle cx="9.5" cy="8" r="2.1" fill="currentColor" stroke="none"/>`,
  NumericUpDown: `<rect x="1.5" y="4" width="9" height="8" rx="1"/><path d="M12.3 6.3l1.2-1.3 1.2 1.3M12.3 9.7l1.2 1.3 1.2-1.3"/>`,
  DateTimePicker: `<rect x="1.5" y="3.3" width="13" height="10.7" rx="1"/><path d="M1.5 6.4h13M4.7 1.8v2.9M11.3 1.8v2.9M4 9h1.3M7.4 9h1.3M10.7 9h1.3M4 11.3h1.3"/>`,
  RichTextBox: `<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M4 5.5h8M4 8h8M4 10.5h6"/>`,
  LinkLabel: `<path d="M6.6 9.4l2.8-2.8"/><path d="M5.3 8.3a1.9 1.9 0 010-2.7l1.3-1.3a1.9 1.9 0 012.7 2.7l-.6.6"/><path d="M10.7 7.7a1.9 1.9 0 010 2.7l-1.3 1.3a1.9 1.9 0 01-2.7-2.7l.6-.6"/>`,
  MenuStrip: `<rect x="1.5" y="3.3" width="13" height="3.4" rx="0.7"/><path d="M5.3 3.3v3.4M9.5 3.3v3.4"/><path d="M2 10.2h12M2 12.7h8"/>`,
  TabControl: `<path d="M1.5 5.3V4a1 1 0 011-1h4l1.3 1.6h6.2a1 1 0 011 1v.7"/><rect x="1.5" y="5.3" width="13" height="8.2" rx="1"/><path d="M5.8 5.3v8.2"/>`,
  MaskedTextBox: `<rect x="1.5" y="4" width="13" height="8" rx="1"/><path d="M4 6.5h1.4M6.4 6.5h1.4M8.8 6.5h1.4M4 9.2h6.2"/>`,
  FlowLayoutPanel: `<rect x="1.5" y="1.5" width="13" height="13" rx="1"/><rect x="3" y="3" width="4" height="3.2" rx="0.5"/><rect x="8" y="3" width="4" height="3.2" rx="0.5"/><rect x="3" y="7.2" width="4" height="3.2" rx="0.5"/>`,
  TableLayoutPanel: `<rect x="1.5" y="1.5" width="13" height="13" rx="1"/><path d="M8 1.5v13M1.5 8h13"/>`,
  StatusStrip: `<rect x="1.5" y="10.5" width="13" height="4" rx="0.7"/><path d="M4 12.5h4"/>`,
  ToolStrip: `<rect x="1.5" y="3.3" width="13" height="4.4" rx="0.7"/><rect x="3" y="4.3" width="2.2" height="2.4" rx="0.4"/><rect x="6.2" y="4.3" width="2.2" height="2.4" rx="0.4"/><rect x="9.4" y="4.3" width="2.2" height="2.4" rx="0.4"/>`,
  Wizard: `<rect x="1.5" y="2" width="13" height="9" rx="1"/><path d="M4 5.7h5M4 8h3.3"/><path d="M2 13.5h12M9.8 11l2.2 2-2.2 2" transform="translate(0,-1.2)"/>`,
};

function toolIconSvg(type) {
  const inner = TOOL_ICONS[type] || '';
  return `<svg class="tool-icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// Short usage description shown as a tooltip on each toolbox item -
// what the control is for, in plain terms, since the icon/label alone
// doesn't explain behavior for less-common controls.
const TOOL_DESCRIPTIONS = {
  Button: 'A clickable button. Wire its Click event to run code when pressed.',
  Label: 'Static, read-only text. Not interactive - use for captions and headings.',
  TextBox: 'A single- or multi-line field the user can type into.',
  CheckBox: 'An independent on/off toggle. Multiple can be checked at once.',
  RadioButton: 'A mutually-exclusive choice. Give matching Group Name to radio buttons that should only allow one selection.',
  ComboBox: 'A dropdown the user can pick from (or type into, depending on DropDown Style). Enter choices in Items, one per line.',
  ListBox: 'A scrollable list of choices, optionally multi-select. Enter choices in Items, one per line.',
  CheckedListBox: 'Like ListBox, but every item gets its own checkbox - always a visible list, NOT a dropdown. Good for "pick any of these" scenarios where you want every option visible at once, not collapsed.',
  Panel: 'A plain, unlabeled container for grouping other controls. Drag controls onto it to make them children.',
  GroupBox: 'A labeled, bordered container for grouping related controls - the border and title make the grouping visible to the user.',
  PictureBox: 'Displays an image. Set Image Source to a file path or URL.',
  ProgressBar: 'Shows progress toward completion. Set Min/Max to the range, and Value to the current position - the fill on screen is (Value-Min)/(Max-Min).',
  TrackBar: 'A draggable slider for picking a numeric value within Min/Max, in steps of Tick Frequency.',
  NumericUpDown: 'A number field with up/down spinner arrows, constrained to Min/Max in steps of Increment.',
  DateTimePicker: 'Lets the user pick a date (or time, if Format is Time). The Format property controls how it displays.',
  RichTextBox: 'A multi-line text area for longer content than a TextBox is meant for.',
  LinkLabel: 'Text styled and behaving like a hyperlink. Set URL to where it should navigate.',
  MenuStrip: 'A top menu bar (File/Edit/View/etc). Comes with preset File/View/Help menus you can check on/off, edit, or add custom ones to - each item can have its own click code.',
  MaskedTextBox: 'A TextBox that enforces a fixed input pattern (Mask), like a phone number or date field - the user can only type where the mask allows it.',
  FlowLayoutPanel: 'A container that auto-arranges its children in a row or column, wrapping to the next line when it runs out of space - like text wrapping, but for controls.',
  TableLayoutPanel: 'A container that arranges its children in a grid of rows and columns, each cell sized to fit its content.',
  StatusStrip: 'A thin bar (usually docked to the bottom) showing status text - "Ready", progress, or similar.',
  ToolStrip: 'A horizontal bar of buttons (usually docked to the top) for quick-access actions - New/Open/Save style toolbars.',
  TabControl: 'A container with multiple named tab pages. Click a tab header on the canvas to switch which page you\'re placing controls onto - each page keeps its own separate set of children.',
  Wizard: 'A multi-page installer-style wizard. Dropping this opens a setup dialog to choose your pages (with optional Welcome/Options/Summary starter content); Back/Next/Cancel buttons are added automatically. Use the Pages editor to add/rename/reorder/remove pages afterward.',
};

const TOOLBOX_GROUPS = [
  { heading: 'Common', types: ['Button', 'Label', 'TextBox', 'MaskedTextBox', 'CheckBox', 'RadioButton', 'LinkLabel'] },
  { heading: 'Lists & Selection', types: ['ComboBox', 'ListBox', 'CheckedListBox', 'NumericUpDown', 'DateTimePicker', 'TrackBar'] },
  { heading: 'Containers', types: ['Panel', 'GroupBox', 'TabControl', 'FlowLayoutPanel', 'TableLayoutPanel'] },
  { heading: 'Display', types: ['PictureBox', 'ProgressBar', 'RichTextBox'] },
  { heading: 'Menus & Bars', types: ['MenuStrip', 'ToolStrip', 'StatusStrip'] },
];
// Wizard is intentionally NOT in the toolbox above - it doesn't behave
// like a draggable-to-a-spot control (it fills its host, opens a setup
// modal, etc.), so it gets its own dedicated toolbar button + picker
// modal instead (see the Wizards toolbar button, Wizard-Builder.js).
const WIZARD_TYPES = [
  { type: 'Wizard', label: 'Multipage Wizard', description: 'An installer-style wizard with a guided page setup, Back/Next/Cancel navigation, and per-page requirements.' },
];
