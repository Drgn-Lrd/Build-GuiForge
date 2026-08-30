/*
    Properties-Pane.js
    Written by: Johnathon Largent
    Version 1.15

    Revision:

    1. One-way Name -> Text sync (Control-Data.js TEXT_SYNCS_WITH_NAME_
    TYPES, Engine.js ctrl.textAutoSynced): renaming a control keeps its
    Text matching until Text is edited directly, which breaks the sync
    permanently for that control.
*/

const PROPERTIES_PANE_VERSION = '1.15';

const EVENT_SNIPPETS = [
  { id: 'none', label: '-- Insert snippet --', template: '', help: '', params: [] },
  {
    id: 'msgbox', label: 'Show message box',
    template: `[System.Windows.Forms.MessageBox]::Show("{message}", "{title}", [System.Windows.Forms.MessageBoxButtons]::{buttons}, [System.Windows.Forms.MessageBoxIcon]::{icon})`,
    help: 'Pops up a small dialog with a message. Buttons controls which button(s) are shown (OK, Yes/No, etc); Icon controls the symbol shown next to the message (info, warning, error, question, or none).',
    params: [
      { key: 'message', label: 'Message', type: 'text', default: 'Message text' },
      { key: 'title', label: 'Title', type: 'text', default: 'Title' },
      { key: 'buttons', label: 'Buttons', type: 'select', options: ['OK', 'OKCancel', 'YesNo', 'YesNoCancel', 'RetryCancel', 'AbortRetryIgnore'], default: 'OK' },
      { key: 'icon', label: 'Icon', type: 'select', options: ['None', 'Information', 'Warning', 'Error', 'Question'], default: 'Information' },
    ],
  },
  {
    id: 'setTargetProp', label: 'Set another control\'s property',
    template: `{target}.{property} = {value}`,
    help: 'The general-purpose way to change something on another control. Pick the target first - Property and Value then adjust to match what that control type actually supports, so you can\'t accidentally pick a property it doesn\'t have (e.g. a NumericUpDown has no SelectedIndex). A DateTimePicker target gives you a real date field; a ComboBox/ListBox target with SelectedIndex lets you pick from its own item names instead of a raw number.',
    params: [
      { key: 'target', label: 'Target Control', type: 'control' },
      { key: 'property', label: 'Property', type: 'targetProperty' },
      { key: 'value', label: 'New Value', type: 'targetValue' },
    ],
  },
  {
    id: 'readValue', label: 'Read this control\'s value',
    template: `$value = $ThisControl.Text`,
    help: 'Grabs the current value out of THIS control (the one whose event you\'re editing) into a variable named $value, for use in the rest of this action. Uses Text for TextBox/ComboBox/Label; for CheckBox/TrackBar/etc, edit the property name after inserting (Checked, Value, ...).',
    params: [],
  },
  {
    id: 'mirrorChecked', label: 'Enable another control while this one is checked',
    template: `{target}.Enabled = $ThisControl.Checked`,
    help: 'Bidirectional on purpose: enables the target while THIS checkbox is checked, and automatically disables it again the instant it\'s unchecked - no separate "undo" handler needed, since it just reads this checkbox\'s own current state every time it fires.',
    onlyFor: ['CheckedChanged'],
    params: [
      { key: 'target', label: 'Target Control', type: 'control' },
    ],
  },
  {
    id: 'mirrorUnchecked', label: 'Disable another control while this one is checked',
    template: `{target}.Enabled = -not $ThisControl.Checked`,
    help: 'The inverse of "Enable another control while checked": disables the target while THIS checkbox is checked, and re-enables it the instant it\'s unchecked. Same bidirectional, no-separate-undo-needed design, just flipped - useful for something that should only be touched BEFORE a box is checked (e.g. lock a field once "I agree" is ticked).',
    onlyFor: ['CheckedChanged'],
    params: [
      { key: 'target', label: 'Target Control', type: 'control' },
    ],
  },
  {
    id: 'increaseValue', label: 'Increase another control\'s value',
    template: `{target}.Value = [Math]::Min({target}.Maximum, {target}.Value + {amount})`,
    help: 'Bumps a NumericUpDown/TrackBar/ProgressBar\'s Value up, clamped so it never exceeds that control\'s own Maximum. Usually wired to a button press, not a checkbox.',
    params: [
      { key: 'target', label: 'Target Control', type: 'control' },
      { key: 'amount', label: 'Amount', type: 'text', default: '1' },
    ],
  },
  {
    id: 'decreaseValue', label: 'Decrease another control\'s value',
    template: `{target}.Value = [Math]::Max({target}.Minimum, {target}.Value - {amount})`,
    help: 'Same idea as Increase, but downward and clamped to the target\'s Minimum instead.',
    params: [
      { key: 'target', label: 'Target Control', type: 'control' },
      { key: 'amount', label: 'Amount', type: 'text', default: '1' },
    ],
  },
  {
    id: 'itemCheckedSetProp', label: 'When item is checked, set another control\'s property',
    template: `if ($e.Index -eq {itemIndex} -and $e.NewValue -eq [System.Windows.Forms.CheckState]::Checked) {\n    {target}.{property} = {value}\n}`,
    help: 'Ties ONE specific checkbox item to an action on another control - each item can drive something different. Example: checking "Turbo Mode" (item 0) sets ComboBox1 to its "High" option, while checking "Eco Mode" (item 1) sets it to "Low" - just add one of these per item you want wired up.',
    onlyFor: ['ItemCheck'],
    params: [
      { key: 'itemIndex', label: 'When Item', type: 'itemIndex' },
      { key: 'target', label: 'Target Control', type: 'control' },
      { key: 'property', label: 'Property', type: 'targetProperty' },
      { key: 'value', label: 'New Value', type: 'targetValue' },
    ],
  },
  {
    id: 'summaryLogAdd', label: 'Add to Summary of Tasks log',
    template: `$script:{wizardName}_LogEntries['{ownerName}'] = "{message}"`,
    help: 'Sets this control\'s own line in the wizard\'s Summary of Tasks log. Firing this again just replaces the same line - it can\'t pile up duplicates. The RichTextBox itself isn\'t touched here at all: the whole log is rebuilt fresh, in a fixed page-order sequence, the moment the person actually reaches the Summary page. For a CheckBox\'s CheckedChanged, use "Add/remove from Summary of Tasks log" instead, which also removes the line when unchecked.',
    params: [
      { key: 'message', label: 'Log Message', type: 'text', default: 'This will install the selected feature.' },
    ],
  },
  {
    id: 'summaryLogToggle', label: 'Add/remove from Summary of Tasks log',
    template: `if ($ThisControl.Checked) {\n    $script:{wizardName}_LogEntries['{ownerName}'] = "{message}"\n} else {\n    $script:{wizardName}_LogEntries.Remove('{ownerName}')\n}`,
    help: 'Sets this control\'s own line in the wizard\'s Summary of Tasks log while checked, and removes it the instant it\'s unchecked - toggling back and forth just flips one entry on and off, so it can never pile up duplicates. The RichTextBox itself isn\'t touched here: the whole log is rebuilt fresh, in a fixed page-order sequence, only when the person actually reaches the Summary page. Only makes sense on CheckedChanged, since it needs a checked/unchecked state to react to.',
    onlyFor: ['CheckedChanged'],
    params: [
      { key: 'message', label: 'Log Message', type: 'text', default: 'This will install the selected feature.' },
    ],
  },
];

// Fills a snippet's template with current parameter values - 'control'
// params become a $VariableName reference, 'boolean' becomes $true/$false,
// 'targetProperty'/'targetValue' resolve based on the CURRENTLY picked
// target control's real type (see resolveValueWidgetKind in
// Control-Data.js), 'itemIndex'/'select' insert their raw value, 'text'
// is inserted as-is (the template itself supplies any quotes).
function computeSnippetCode(snippet, params, ctrl) {
  let code = snippet.template;
  const targetCtrl = params.target ? getControlByName(params.target) : null;
  const targetType = targetCtrl ? targetCtrl.type : null;
  snippet.params.forEach(p => {
    const val = params[p.key];
    let sub;
    if (p.type === 'control') sub = val ? ('$' + val) : '$\u2026'; // ellipsis placeholder until picked
    else if (p.type === 'boolean') sub = val ? '$true' : '$false';
    else if (p.type === 'targetProperty') sub = val || 'Text';
    else if (p.type === 'targetValue') {
      const kind = resolveValueWidgetKind(targetType, params.property);
      if (kind === 'boolean') sub = val ? '$true' : '$false';
      else if (kind === 'number' || kind === 'targetItemIndex') sub = (val != null && val !== '') ? String(val) : '0';
      else if (kind === 'date') sub = val ? `[DateTime]::Parse("${val}")` : '[DateTime]::Now';
      else sub = `"${(val != null ? String(val) : '').replace(/"/g, '`"')}"`;
    }
    else sub = val != null ? String(val) : '';
    code = code.split('{' + p.key + '}').join(sub);
  });
  // {ownerName}/{wizardName}: used only by the summary-log snippets
  // (summaryLogAdd/summaryLogToggle) - never a user-editable param, since
  // there's nothing to pick: a wizard has exactly one Summary log, and the
  // "owner" is always whichever control's event this action lives on.
  // Filled in automatically from ctrl (the control whose event is being
  // edited), which every call site already has in scope.
  if (ctrl) {
    code = code.split('{ownerName}').join(ctrl.name);
    if (code.includes('{wizardName}')) {
      const wiz = findAncestorWizard(ctrl);
      code = code.split('{wizardName}').join(wiz ? wiz.name : 'Wizard');
    }
  }
  return code;
}

// Per-event-NAME guidance - event names are shared across control types
// (every control's Click means roughly the same thing), so one entry
// each covers the whole app rather than needing one per control type.
const EVENT_HELP = {
  Click: 'Fires when the control is clicked (or activated via Enter/Space on a focused button). The most common event - use it for "do something when this is pressed."',
  CheckedChanged: 'Fires the moment a CheckBox/RadioButton\'s checked state changes, whether the user clicked it or code set .Checked directly.',
  SelectedIndexChanged: 'Fires when the selected item in a ComboBox/ListBox changes, whether by user pick or by code setting .SelectedIndex.',
  TextChanged: 'Fires on every edit to a TextBox/ComboBox\'s text - including every keystroke while typing, not just when focus leaves the field.',
  ValueChanged: 'Fires whenever a TrackBar/NumericUpDown/DateTimePicker\'s value changes, whether by user drag/click/typing or by code.',
  ItemCheck: 'Fires when an item\'s checkbox is toggled in a CheckedListBox - fires BEFORE the visual check state updates, so it reflects the state it\'s about to become, not what just happened.',
  LinkClicked: 'Fires when a LinkLabel is clicked.',
  Load: 'Fires once, right when the form first opens - the standard place to initialize starting values, populate lists, or set up anything the form needs before the user sees it.',
  ClickToClose: 'A dedicated, pre-filled "close the window when clicked" handler - only offered on Button, kept separate from the regular Click event on purpose. Closing the form used to be an ordinary snippet you could insert into any event on any control, including ones that fire constantly (like TextChanged on every keystroke) - which could close the window by accident. This is safer: it only exists as its own deliberate toggle on a Button.',
};

// Definitions for individual dropdown VALUES, not just the field itself -
// rendered as a small legend under the dropdown so every option's meaning
// is visible without guessing. Keyed by property key, then option value.
const OPTION_DEFINITIONS = {
  dock: {
    None: 'Not docked - stays exactly where you place it.',
    Top: 'Hugs the top edge and stretches to the full available width.',
    Bottom: 'Hugs the bottom edge and stretches to the full available width.',
    Left: 'Hugs the left edge and stretches to the full available height.',
    Right: 'Hugs the right edge and stretches to the full available height.',
    Fill: 'Takes up whatever space is left after every other docked control has claimed its edge.',
    TopLeft: 'Pins to the top-left corner without stretching - keeps its own width/height, so other controls can share the top edge with it.',
    TopRight: 'Pins to the top-right corner without stretching.',
    BottomLeft: 'Pins to the bottom-left corner without stretching.',
    BottomRight: 'Pins to the bottom-right corner without stretching.',
  },
  borderStyle: {
    None: 'No visible border at all.',
    FixedSingle: 'A thin, flat 1px line border.',
    Fixed3D: 'A sunken, inset-look border (classic Windows "recessed" field appearance).',
  },
  dropDownStyle: {
    DropDown: 'A text box with a dropdown arrow - the user can type a custom value OR pick from the list.',
    DropDownList: 'Dropdown only, no typing - the user must pick one of the listed items.',
    Simple: 'The list is shown inline (not collapsed into a dropdown) alongside an editable text box.',
  },
  selectionMode: {
    None: 'Nothing can be selected.',
    One: 'Exactly one item can be selected at a time.',
    MultiSimple: 'Click any item to toggle it in/out of the selection - no Ctrl key needed, multiple items build up as you click.',
    MultiExtended: 'Click selects one item; Ctrl+click toggles individual items; Shift+click selects a range - same as most Windows file pickers.',
  },
  sizeMode: {
    Normal: 'Image shown at its actual size, anchored to the top-left; gets cropped if the box is smaller.',
    StretchImage: 'Image is stretched to exactly fill the box, ignoring its original aspect ratio.',
    AutoSize: 'The box resizes itself to match the image\'s actual size.',
    CenterImage: 'Image is centered at its actual size; cropped if the box is smaller.',
    Zoom: 'Image is scaled as large as possible while preserving its aspect ratio, and centered.',
  },
  format: {
    Long: 'Full written-out date, e.g. "Saturday, August 15, 2026".',
    Short: 'Compact numeric date, e.g. "8/15/2026".',
    Time: 'Time only, e.g. "3:45 PM" - switches the picker itself to a time input.',
    Custom: 'Uses the Custom Format field below (.NET date tokens: dd/MMM/yyyy/HH/mm/etc). Default is "dd MMM yyyy", e.g. "15 Aug 2026".',
  },
  textAlign: {
    Left: 'Text is left-aligned within the control.',
    Center: 'Text is centered within the control.',
    Right: 'Text is right-aligned within the control.',
  },
  cursor: {
    Default: 'The normal system arrow pointer.',
    Hand: 'A pointing hand - signals the control is clickable, like a link.',
    IBeam: 'A text-insertion cursor - typically used for editable text fields.',
    Wait: 'A busy/loading indicator.',
    Cross: 'A crosshair - often used for precise selection.',
    SizeAll: 'A four-way move cursor - signals the control can be dragged.',
  },
  startPosition: {
    CenterScreen: 'Opens centered on the screen.',
    Manual: 'Opens at whatever Location is set in code - not centered anywhere automatically.',
    CenterParent: 'Opens centered over its parent/owner window.',
    WindowsDefaultLocation: 'Opens wherever Windows decides to cascade it, with the size you set.',
    WindowsDefaultBounds: 'Opens wherever Windows decides, AND lets Windows pick the size too (ignoring your Width/Height).',
  },
  formBorderStyle: {
    None: 'No border and no title bar at all.',
    FixedSingle: 'Thin fixed border, not resizable by dragging the edges.',
    Fixed3D: 'Sunken-look fixed border, not resizable.',
    FixedDialog: 'Thicker fixed border typical of dialog boxes, not resizable.',
    Sizable: 'Standard resizable window border - the normal default.',
    FixedToolWindow: 'Thin fixed border with a small tool-window-style title bar (no minimize/maximize buttons), not resizable.',
    SizableToolWindow: 'Same small tool-window title bar as FixedToolWindow, but resizable.',
  },
};

function showInfoModal(title, key, options) {
  const overlay = document.getElementById('infoModalOverlay');
  document.getElementById('infoModalTitle').textContent = title;
  const body = document.getElementById('infoModalBody');
  body.innerHTML = '';
  const defs = OPTION_DEFINITIONS[key] || {};
  options.forEach(o => {
    if (!defs[o]) return;
    const line = document.createElement('div');
    line.className = 'option-legend-line';
    line.innerHTML = `<span class="option-legend-value">${escapeHtml(o)}</span><span class="option-legend-text">${escapeHtml(defs[o])}</span>`;
    body.appendChild(line);
  });
  overlay.classList.add('open');
}

function buildOptionInfoButton(key, label, options) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'option-info-btn';
  btn.textContent = 'i';
  btn.title = `What do the ${label} options mean?`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    showInfoModal(label, key, options);
  });
  return btn;
}

const TOOLTIPS = {
  name: 'Variable/element name used to reference this control in generated code.',
  x: 'Horizontal position (pixels) from the left edge of its parent.',
  y: 'Vertical position (pixels) from the top edge of its parent.',
  w: 'Width in pixels.',
  h: 'Height in pixels.',
  z: 'Z-Index: stacking order. Higher values render on top of lower ones when controls overlap.',
  visible: 'Whether the control is shown at runtime. Hidden controls still exist and can be shown later from code.',
  enabled: 'Whether the control accepts input at runtime. Disabled controls are usually greyed out.',
  tabIndex: 'Keyboard tab order. Lower numbers are reached first when pressing Tab.',
  toolTip: 'Text shown in a small popup when the mouse hovers over this control at runtime.',
  dock: 'Dock: hugs and stretches along the chosen edge of the parent - like a taskbar or menu bar. Always flush, always full-length on that edge, no matter how the parent resizes. Overrides Anchor while active.',
  anchor: 'Anchor: keeps this control the same PERCENTAGE distance from each checked edge as the parent resizes (not a fixed pixel margin). Check one edge to reposition proportionally along that axis; check both edges on an axis to scale/stretch proportionally along it. Check all four to keep the control scaling while staying exactly as centered, relative to the parent, as it started. Ignored while Dock is set to anything other than None.',
  cursor: 'Mouse pointer shown when hovering over this control at runtime.',
  backColor: 'Background/fill color of the control.',
  foreColor: 'Text/foreground color of the control.',
  fontFamily: 'Font used for this control\'s text (this control only, not a shared/global font).',
  fontSize: 'Font size in points for this control\'s text.',
  fontBold: 'Renders this control\'s text in bold.',
  fontItalic: 'Renders this control\'s text in italics.',
  borderStyle: 'Border drawn around the control: None, a flat single line, or a 3D sunken/raised edge.',
  text: 'The main text/caption/content shown on this control.',
  textAlign: 'Horizontal alignment of the text within the control.',
  multiline: 'Allows the text box to wrap and hold multiple lines instead of a single line.',
  readOnly: 'Prevents the user from editing the text at runtime (still selectable/copyable).',
  passwordChar: 'Character shown in place of typed text (e.g. *) to mask input like a password field.',
  maxLength: 'Maximum number of characters the user can type. 0 = unlimited.',
  checked: 'Whether this box/radio starts checked/selected.',
  groupName: 'Radio buttons sharing the same Group Name are mutually exclusive (only one can be checked at a time).',
  items: 'The list of selectable entries, one per line.',
  selectedIndex: 'Index (0-based) of the item selected by default. -1 means nothing selected.',
  dropDownStyle: 'Whether the user can type a custom value, must pick from the list, or sees the list inline.',
  selectionMode: 'How many items the user can select at once: none, exactly one, or multiple.',
  imageSource: 'File path or URL of the image to display.',
  sizeMode: 'How the image is scaled/positioned to fit the control\'s bounds.',
  min: 'Minimum value allowed.',
  max: 'Maximum value allowed.',
  value: 'Current/starting value.',
  tickFrequency: 'How often (in value units) a tick mark is drawn along the slider.',
  increment: 'Amount the value changes per step (e.g. each click of the up/down arrows).',
  decimalPlaces: 'Number of digits shown after the decimal point.',
  format: 'How the date/time value is displayed.',
  customFormat: '.NET date format tokens, used when Format is set to Custom. dd=day (05), MMM=month abbreviated (Aug), MMMM=month full (August), yyyy=4-digit year, yy=2-digit year, HH/mm/ss=24hr time, tt=AM/PM. Default "dd MMM yyyy" gives "15 Aug 2026".',
  url: 'The web address this link opens when clicked.',
  menuItems: 'Configure this menu bar: check a top-level menu to include it, check individual entries to include them, edit labels, or add your own custom menus and items.',
  tabs: 'The tab pages on this control. Rename, add, or remove pages here; click "Show" on a page to switch the canvas to it before placing controls - each page keeps its own separate set of children.',
  pages: 'The pages in this wizard. Add, rename, reorder, or remove pages here; click "Show" on a page to switch the canvas to it before placing controls. Each page can also have an optional custom validation expression checked before Next is allowed to proceed.',
  contentsStyle: 'Optional step-list navigation, modeled on real installer wizards: None (no visible list, just Back/Next), Horizontal (a tab-like strip of page names across the top), or Vertical (a sidebar of page names down the left, like the classic Windows installer). Clicking a page name jumps straight to it while designing.',
};

function tt(key) { return TOOLTIPS[key] || ''; }

// Detailed, per-type guidance with a concrete example - shown as its own
// "Help" node in the properties pane for every control, not just the ones
// that seemed confusing. This is the reference a person reaches for when
// they're not sure what a property does or how a control is meant to be
// wired up.
const CONTROL_HELP = {
  Button: 'A clickable push-button. Text is the caption shown on the button. Wire the Click event (Events section below) to run code when it\'s pressed. Example: Text="Save", then in Click write code that writes your form\'s field values to a file.',
  Label: 'Static, read-only text - the user can\'t type into or click it (it has no events). Use it for captions, headings, and instructions next to other controls. Example: a Label reading "Customer Name:" placed just above or beside a TextBox.',
  TextBox: 'A field the user can type into. Text holds the current/starting value. Multiline allows multiple lines (renders as a resizable text area), ReadOnly makes it display-only, PasswordChar masks input (e.g. "*"), MaxLength caps the character count. Example: PasswordChar="*", MaxLength=50 for a password field.',
  CheckBox: 'An independent on/off toggle - unlike RadioButton, any number of CheckBoxes can be checked at once. Checked sets whether it starts ticked. Wire CheckedChanged to react when the user toggles it. Example: a "Remember me" setting, Checked=false by default.',
  RadioButton: 'A mutually-exclusive choice - only one RadioButton per Group Name can be checked at a time. Give every radio button that should behave as one group the SAME Group Name; different Group Names create independent groups. Example: three radio buttons with Group Name="ShippingSpeed" - Standard/Express/Overnight - only one selectable at once.',
  ComboBox: 'A dropdown list. Enter the choices in Items, one per line. Selected Index sets which item is picked by default (0 = first item, -1 = none). Drop Down Style controls whether the user can type a custom value, must pick from the list, or sees it inline. Example: Items="Small\nMedium\nLarge", Selected Index=1 starts on "Medium".',
  ListBox: 'A scrollable list of choices, always visible (not a dropdown). Enter choices in Items, one per line. Selection Mode controls whether the user can pick none/one/multiple items at once. Example: Items="Red\nGreen\nBlue", Selection Mode="MultiExtended" lets the user Ctrl/Shift-click multiple colors.',
  CheckedListBox: 'A real WinForms control that\'s often confused for a dropdown, but it isn\'t one - it\'s always-visible, like ListBox, except every item has its own checkbox so multiple can be picked without needing Ctrl/Shift. Check On Click controls whether a single click toggles the box (true, the common choice) or requires clicking exactly on the checkbox glyph (false). Example: a permissions list where several boxes should be checkable at a glance.',
  Panel: 'A plain, unlabeled container for grouping other controls - drag controls from the toolbox onto it, or use a control\'s Parent dropdown (Layout section) to move it in without dragging. Has no border/title of its own; use GroupBox instead if you want a visible boundary and caption. Example: group a set of address fields inside a Panel so you can reposition or hide them as one unit.',
  GroupBox: 'A bordered, titled container - like Panel, but draws a visible border and caption (Text) so the grouping is obvious to the user. Example: Text="Shipping Address" around a set of address TextBoxes.',
  PictureBox: 'Displays an image. Image Source is a file path or URL. Size Mode controls how the image fits the box - e.g. StretchImage fills it (ignoring aspect ratio), Zoom fits within it (preserving aspect ratio). Example: Image Source="logo.png", Size Mode="Zoom".',
  ProgressBar: 'Shows progress toward completion as a filled bar. Min/Max define the range you\'re measuring (commonly 0-100); Value is where the fill currently sits. In the designer this is just a static preview - there\'s no automatic link to a running command. To show REAL progress at runtime, update Value from your own script as the work happens, e.g.: for ($i=0; $i -le 100; $i+=10) { $ProgressBar1.Value = $i; $Form.Refresh(); Start-Sleep -Milliseconds 200 }',
  TrackBar: 'A draggable slider for picking a numeric value within Min/Max. Value is the starting position; Tick Frequency controls how often a tick mark is drawn along the track. Wire ValueChanged to react as the user drags it. Example: Min=0, Max=100, Value=50, Tick Frequency=10 for a volume-style slider.',
  NumericUpDown: 'A number field with up/down spinner arrows. Min/Max constrain the range, Value is the starting number, Increment is how much each spinner click changes it, Decimal Places sets digits after the decimal point. Example: Min=0, Max=10, Value=1, Increment=1 for a quantity selector.',
  DateTimePicker: 'Lets the user pick a date (or a time, if Format="Time"). Format controls how the value is DISPLAYED (Long/Short/Time/Custom) - it doesn\'t change what\'s stored, only how it looks. Value holds the actual date/time. Example: Format="Short" shows "8/15/2026"; Format="Long" shows "Saturday, August 15, 2026".',
  RichTextBox: 'A multi-line text area for longer content than a TextBox is meant for (notes, logs, formatted text). Text holds the current content. Example: a scrollable output/log panel your script appends status messages to at runtime.',
  LinkLabel: 'Text styled and behaving like a hyperlink. Text is the label shown; URL is where it navigates when clicked (wire LinkClicked to run custom code instead of, or in addition to, navigating). Example: Text="Visit our site", URL="https://example.com".',
  MenuStrip: 'A top menu bar (File/Edit/View/Help, etc). Comes with preset File/View/Help menus you can check on/off, rename, or add custom menus/items to via the Menu Items editor below. Each item can have its own click code - presets like File > Exit and Help > About already come with working defaults. Example: uncheck "Zoom In/Out" if you don\'t need them, or add a custom "Tools > Settings" entry with your own code.',
  TabControl: 'A container with multiple named tab pages, each holding its own separate set of child controls. Use the Tabs editor below to add/rename/remove pages; click "Show" on a page (or click its header on the canvas) to switch which page you\'re placing controls onto. Example: an "Options" dialog with "General", "Advanced", and "About" tabs, each with different controls on it.',
  Form: 'The main window itself - everything else sits inside it. Title is the text shown in the title bar. Form Border Style controls the window\'s chrome and whether it can be resized. Comment-Based Help below becomes the PowerShell help block at the top of every generated file.',
  MaskedTextBox: 'A TextBox that enforces a fixed input pattern instead of free text. Mask uses WinForms mask characters: 0 = required digit, 9 = optional digit, L = required letter, > = force uppercase, < = force lowercase. Example: Mask="000-00-0000" for a Social Security Number field.',
  FlowLayoutPanel: 'A container that automatically arranges its children in a line, wrapping to the next row/column when it runs out of room - similar to how text wraps. Flow Direction sets which way it flows; Wrap Contents controls whether it wraps at all or just keeps going off the edge. Example: a toolbar of buttons that should reflow as the window resizes.',
  TableLayoutPanel: 'A container that arranges its children into a grid - set Columns and Rows to the grid size you want, then place children into specific cells. Example: a 2-column form layout with a Label in each left cell and its matching input in the right cell.',
  StatusStrip: 'A thin status bar, almost always docked to the bottom of the form. Text is the message shown - commonly updated from code as the app does things, e.g. $StatusStrip1.Text = "Saved.".',
  ToolStrip: 'A horizontal bar of quick-action buttons, almost always docked to the top. Add button labels in Items, one per line. Example: Items="New\\nOpen\\nSave" for a classic file toolbar.',
  Wizard: 'A multi-page installer-style container. Dropping this from the toolbox opens a setup dialog to choose pages (with optional Welcome/Options/Summary starter content); Back/Next/Cancel buttons are added automatically as real, movable Button controls with built-in navigation. Use the Pages editor below to add/rename/reorder/remove pages afterward, and each page can require specific child controls (or a custom expression) be satisfied before Next proceeds. Example: a 3-page install wizard - Welcome, Options (with a Required checkbox), Summary - where Next becomes "Finish" on the last page.',
};

function buildUsageHintBlock(text) {
  const div = document.createElement('div');
  div.className = 'usage-hint';
  div.textContent = text;
  return div;
}

function showInfoModalText(title, text) {
  const overlay = document.getElementById('infoModalOverlay');
  document.getElementById('infoModalTitle').textContent = title;
  const body = document.getElementById('infoModalBody');
  body.innerHTML = '';
  const p = document.createElement('div');
  p.className = 'option-legend-text info-modal-freetext';
  p.textContent = text;
  body.appendChild(p);
  overlay.classList.add('open');
}

function buildSelHeaderInfoBtn(title, text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'option-info-btn sel-info-btn';
  btn.textContent = 'i';
  btn.title = `What is a ${title}?`;
  btn.addEventListener('click', () => showInfoModalText(title.toUpperCase(), text));
  return btn;
}

function renderProps() {
  const pane = document.getElementById('propsBody');
  const header = document.getElementById('propsHeader');
  pane.innerHTML = '';
  header.innerHTML = '';

  const ctrl = getControl(state.selectedId);
  if (!ctrl) {
    const typeRow = document.createElement('div');
    typeRow.className = 'sel-header-row';
    if (CONTROL_HELP.Form) typeRow.appendChild(buildSelHeaderInfoBtn('Form', CONTROL_HELP.Form));
    const typeLabel = document.createElement('div');
    typeLabel.className = 'sel-type';
    typeLabel.textContent = 'FORM';
    typeRow.appendChild(typeLabel);
    const nameLabel = document.createElement('div');
    nameLabel.className = 'sel-name';
    nameLabel.textContent = state.form.text;
    const wrap = document.createElement('div');
    wrap.appendChild(typeRow);
    wrap.appendChild(nameLabel);
    header.appendChild(wrap);
    pane.appendChild(buildFormProps());
    return;
  }

  const typeRow = document.createElement('div');
  typeRow.className = 'sel-header-row';
  if (CONTROL_HELP[ctrl.type]) typeRow.appendChild(buildSelHeaderInfoBtn(ctrl.type, CONTROL_HELP[ctrl.type]));
  const typeLabel = document.createElement('div');
  typeLabel.className = 'sel-type';
  typeLabel.textContent = ctrl.type.toUpperCase();
  typeRow.appendChild(typeLabel);
  const nameLabel = document.createElement('div');
  nameLabel.className = 'sel-name';
  nameLabel.textContent = ctrl.name;
  const wrap = document.createElement('div');
  wrap.appendChild(typeRow);
  wrap.appendChild(nameLabel);
  header.appendChild(wrap);

  // Interact is never collapsible and never buried in an accordion — it's a
  // fixed control right under the header so it's always reachable in one
  // click, since it's the one you need in a hurry to test a dropdown/checkbox.
  pane.appendChild(buildInteractFixedBlock(ctrl));

  pane.appendChild(section('Layout', buildLayoutRows(ctrl), true));
  pane.appendChild(section('Nudge', buildNudgeSection(ctrl), true));
  pane.appendChild(section('Behavior', buildPropRows(ctrl, COMMON_BEHAVIOR_PROPS), false));

  const parentForWizard = ctrl.parentId ? getControl(ctrl.parentId) : null;
  if (parentForWizard && CONTROL_DEFS[parentForWizard.type].isWizard) {
    pane.appendChild(section('Wizard Page', buildWizardChildRows(ctrl, parentForWizard), true));
  }

  pane.appendChild(section('Appearance', buildPropRows(ctrl, COMMON_APPEARANCE_PROPS), false));

  const def = CONTROL_DEFS[ctrl.type];
  if (def.props.length) {
    pane.appendChild(section(ctrl.type + '-specific', buildPropRows(ctrl, def.props), false));
  }

  if (def.events.length) {
    pane.appendChild(section('Events', buildEventsSection(ctrl), false));
  }
}

function section(title, bodyEl, startOpen) {
  // Sections with only a single row of content aren't worth collapsing —
  // there's nothing to hide, so render them flat with a static (non-
  // clickable) label instead of a toggle header.
  const rowCount = bodyEl.children.length;
  const singleRow = rowCount <= 1;

  const wrap = document.createElement('div');
  const head = document.createElement('div');

  if (singleRow) {
    wrap.className = 'prop-section single-row';
    head.className = 'prop-section-title static';
    head.innerHTML = `<span>${title}</span>`;
  } else {
    if (!(title in state.sectionOpen)) state.sectionOpen[title] = !!startOpen;
    const isOpen = state.sectionOpen[title];
    wrap.className = 'prop-section' + (isOpen ? '' : ' collapsed');
    head.className = 'prop-section-title';
    head.innerHTML = `<span>${title}</span><span>${isOpen ? '\u2212' : '+'}</span>`;
    head.addEventListener('click', () => {
      wrap.classList.toggle('collapsed');
      const nowOpen = !wrap.classList.contains('collapsed');
      state.sectionOpen[title] = nowOpen;
      head.querySelector('span:last-child').textContent = nowOpen ? '\u2212' : '+';
    });
  }

  const body = document.createElement('div');
  body.className = 'prop-section-body';
  body.appendChild(bodyEl);
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

function pixelStepperRow(label, value, onChange, opts) {
  opts = opts || {};
  const min = opts.min != null ? opts.min : 0;
  const row = document.createElement('div');
  row.className = 'prop-row px-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  if (opts.tooltip) labelEl.title = opts.tooltip;
  const controls = document.createElement('div');
  controls.className = 'px-controls';

  const input = document.createElement('input');
  input.type = 'number';
  input.value = value;
  input.className = 'px-input';

  const steps = document.createElement('div');
  steps.className = 'px-steps';

  function commit(v) {
    v = Math.max(min, v);
    input.value = v;
    onChange(v);
  }

  [-10, -5, -1, 1, 5, 10].forEach(delta => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'px-step-btn';
    b.textContent = (delta > 0 ? '+' : '') + delta;
    b.addEventListener('click', () => commit((Number(input.value) || 0) + delta));
    steps.appendChild(b);
  });

  input.addEventListener('change', () => commit(Number(input.value) || 0));

  controls.appendChild(input);
  controls.appendChild(steps);
  row.appendChild(labelEl);
  row.appendChild(controls);
  return row;
}

function parentBounds(ctrl) {
  const parent = ctrl.parentId ? getControl(ctrl.parentId) : null;
  return parent ? { w: parent.w, h: parent.h } : { w: state.form.width, h: state.form.height };
}

function centerControl(ctrl, axis) {
  const b = parentBounds(ctrl);
  if (axis === 'x' || axis === 'both') ctrl.x = snap((b.w - ctrl.w) / 2);
  if (axis === 'y' || axis === 'both') ctrl.y = snap((b.h - ctrl.h) / 2);
  render();
}

function xyQuickRow(ctrl, axis, label) {
  const row = document.createElement('div');
  row.className = 'prop-row xy-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.title = tt(axis);

  const wrap = document.createElement('div');
  wrap.className = 'xy-controls';

  const input = document.createElement('input');
  input.type = 'number';
  input.value = ctrl[axis];
  input.step = 1;
  input.className = 'px-input';
  input.addEventListener('change', () => { ctrl[axis] = Number(input.value) || 0; render(); });

  const btnRow = document.createElement('div');
  btnRow.className = 'xy-quick-btns';
  const mk = (text, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'xy-quick-btn';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  btnRow.appendChild(mk('0', axis === 'x' ? 'Pin to far left' : 'Pin to far top', () => { ctrl[axis] = 0; render(); }));
  btnRow.appendChild(mk('Center', 'Center within parent', () => centerControl(ctrl, axis)));
  btnRow.appendChild(mk('Max', axis === 'x' ? 'Pin to far right (edge of parent)' : 'Pin to far bottom (edge of parent)', () => {
    const b = parentBounds(ctrl);
    ctrl[axis] = axis === 'x' ? b.w - ctrl.w : b.h - ctrl.h;
    render();
  }));

  wrap.appendChild(input);
  wrap.appendChild(btnRow);
  row.appendChild(labelEl);
  row.appendChild(wrap);
  return row;
}

function whQuickRow(ctrl, dim, label, growSymbol) {
  const row = document.createElement('div');
  row.className = 'prop-row xy-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.title = tt(dim);

  const wrap = document.createElement('div');
  wrap.className = 'xy-controls';

  const input = document.createElement('input');
  input.type = 'number';
  input.value = ctrl[dim];
  input.step = 1;
  input.className = 'px-input';
  input.addEventListener('change', () => { ctrl[dim] = Math.max(12, Number(input.value) || 12); render(); });

  const btnRow = document.createElement('div');
  btnRow.className = 'xy-quick-btns';
  const mk = (text, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'xy-quick-btn';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  const step = state.nudgeStep;
  btnRow.appendChild(mk('\u2212', `Shrink ${step}px (uses the Nudge section's step size)`, () => { ctrl[dim] = Math.max(12, ctrl[dim] - step); render(); }));
  btnRow.appendChild(mk(growSymbol, `Grow ${step}px (uses the Nudge section's step size)`, () => { ctrl[dim] = ctrl[dim] + step; render(); }));
  btnRow.appendChild(mk('Max', dim === 'w' ? "Fit parent's width" : "Fit parent's height", () => {
    const b = parentBounds(ctrl);
    ctrl[dim] = dim === 'w' ? b.w : b.h;
    render();
  }));

  wrap.appendChild(input);
  wrap.appendChild(btnRow);
  row.appendChild(labelEl);
  row.appendChild(wrap);
  return row;
}

function absolutePosition(ctrl) {
  let x = ctrl.x, y = ctrl.y;
  let p = ctrl.parentId ? getControl(ctrl.parentId) : null;
  while (p) {
    x += p.x;
    y += p.y;
    if (CONTROL_DEFS[p.type].isTabControl) y += TAB_HEADER_HEIGHT;
    p = p.parentId ? getControl(p.parentId) : null;
  }
  return { x, y };
}

function isDescendantOf(candidate, ctrl) {
  let p = candidate;
  while (p) {
    if (p.id === ctrl.id) return true;
    p = p.parentId ? getControl(p.parentId) : null;
  }
  return false;
}

// Moves a control to a new parent (or back to the main window) while
// keeping it visually where it was - so picking a new Parent from the
// dropdown doesn't make the control jump somewhere unexpected, the way a
// drag-and-drop reparent wouldn't either.
function reparentControl(ctrl, newParentId) {
  const abs = absolutePosition(ctrl);
  ctrl.parentId = newParentId || null;
  ctrl.tabPage = null;
  // Wizard-only flags don't carry meaning under a different (or no)
  // parent - reset them, same as tabPage above; they can be re-set from
  // the Wizard Page section if the control ends up under a Wizard again.
  delete ctrl.wizardFooter;
  delete ctrl.wizardRole;
  delete ctrl.wizardRequired;

  if (newParentId) {
    const newParent = getControl(newParentId);
    let offsetX = newParent.x, offsetY = newParent.y;
    let pp = newParent.parentId ? getControl(newParent.parentId) : null;
    while (pp) {
      offsetX += pp.x; offsetY += pp.y;
      if (CONTROL_DEFS[pp.type].isTabControl) offsetY += TAB_HEADER_HEIGHT;
      pp = pp.parentId ? getControl(pp.parentId) : null;
    }
    if (CONTROL_DEFS[newParent.type].isTabControl) {
      ctrl.tabPage = newParent.activeTabId;
      offsetY += TAB_HEADER_HEIGHT;
    } else if (CONTROL_DEFS[newParent.type].isWizard) {
      // No header strip to offset for - a wizard page occupies the full
      // control bounds, same as a plain container.
      ctrl.tabPage = newParent.activeTabId;
    }
    ctrl.x = Math.max(0, snap(abs.x - offsetX));
    ctrl.y = Math.max(0, snap(abs.y - offsetY));
  } else {
    ctrl.x = Math.max(0, snap(abs.x));
    ctrl.y = Math.max(0, snap(abs.y));
  }
}

function buildParentDropdownRow(ctrl) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const label = document.createElement('label');
  label.textContent = 'Parent';
  label.title = 'Which container this control belongs to. Change it to move the control into a different Panel/GroupBox/TabControl - or back to the main window - without dragging. The list fills in automatically as you add containers.';

  const select = document.createElement('select');
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(none \u2014 main window)';
  select.appendChild(noneOpt);

  state.controls
    .filter(c => c.id !== ctrl.id && CONTROL_DEFS[c.type].isContainer && !isDescendantOf(c, ctrl))
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.type})`;
      select.appendChild(opt);
    });

  select.value = ctrl.parentId || '';

  select.addEventListener('change', (e) => {
    reparentControl(ctrl, e.target.value || null);
    render();
  });

  row.appendChild(label);
  row.appendChild(select);
  return row;
}

// Related-control families, for the "Convert To" dropdown - lets a control
// switch to a close relative in place (keeping position/size/name/parent)
// instead of deleting and rebuilding it from scratch.
const CONTROL_FAMILIES = {
  ListBox: ['ComboBox', 'CheckedListBox'],
  ComboBox: ['ListBox', 'CheckedListBox'],
  CheckedListBox: ['ListBox', 'ComboBox'],
  TextBox: ['RichTextBox'],
  RichTextBox: ['TextBox'],
  CheckBox: ['RadioButton'],
  RadioButton: ['CheckBox'],
  Panel: ['GroupBox'],
  GroupBox: ['Panel'],
};

function convertControlType(ctrl, newType) {
  const oldType = ctrl.type;
  const oldProps = ctrl.props;
  const oldEvents = ctrl.events;
  const newDef = CONTROL_DEFS[newType];

  const cloneDefault = (v) => (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  const newProps = {};
  newDef.props.forEach(([key, , , def0]) => { newProps[key] = cloneDefault(def0); });
  COMMON_APPEARANCE_PROPS.forEach(([key, , , def0]) => { newProps[key] = cloneDefault(def0); });
  COMMON_BEHAVIOR_PROPS.forEach(([key, , , def0]) => { newProps[key] = cloneDefault(def0); });
  // Best-effort carry-over: any prop key that exists on both old and new
  // types keeps its value (e.g. Items survives ListBox -> ComboBox).
  Object.keys(newProps).forEach(key => { if (key in oldProps) newProps[key] = oldProps[key]; });

  const newEvents = {};
  newDef.events.forEach(evt => { newEvents[evt] = oldEvents[evt] || null; });

  // If the name still matches the auto-generated pattern for the old type
  // (e.g. "ListBox1"), rename it to match the new type; a custom name is
  // left alone.
  if (ctrl.name.startsWith(oldType)) {
    ctrl.name = newType + ctrl.name.slice(oldType.length);
  }

  ctrl.type = newType;
  ctrl.props = newProps;
  ctrl.events = newEvents;
  if (CONTROL_DEFS[newType].isTabControl && !ctrl.activeTabId) {
    ctrl.activeTabId = (newProps.tabs && newProps.tabs[0] && newProps.tabs[0].id) || null;
  }
}

function buildConvertToRow(ctrl) {
  const family = CONTROL_FAMILIES[ctrl.type];
  if (!family || !family.length) return null;

  const row = document.createElement('div');
  row.className = 'prop-row';
  const label = document.createElement('label');
  label.textContent = 'Convert To';
  label.title = 'Switch this control to a closely related type, keeping its position, size, name, and parent - only type-specific properties reset to defaults.';
  const select = document.createElement('select');
  const keepOpt = document.createElement('option');
  keepOpt.value = '';
  keepOpt.textContent = `(keep as ${ctrl.type})`;
  select.appendChild(keepOpt);
  family.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  });
  select.addEventListener('change', (e) => {
    if (!e.target.value) return;
    convertControlType(ctrl, e.target.value);
    state.selectedId = ctrl.id;
    render();
  });
  row.appendChild(label);
  row.appendChild(select);
  return row;
}

function buildLayoutRows(ctrl) {
  const frag = document.createElement('div');
  const nameRow = document.createElement('div');
  nameRow.className = 'prop-row';
  nameRow.innerHTML = `<label title="${escapeHtml(tt('name'))}">Name</label><input type="text" value="${escapeHtml(ctrl.name)}">`;
  nameRow.querySelector('input').addEventListener('change', (e) => {
    const newName = e.target.value.trim() || ctrl.name;
    ctrl.name = newName;
    // One-way sync (Control-Data.js TEXT_SYNCS_WITH_NAME_TYPES,
    // Engine.js createControl): only while the person hasn't yet
    // customized Text themselves, so a caption-style control's Text
    // starts out matching its Name without extra typing, but never
    // clobbers wording they've already gone and changed.
    if (ctrl.textAutoSynced && ctrl.props.text !== undefined) ctrl.props.text = newName;
    render();
  });
  frag.appendChild(nameRow);
  frag.appendChild(buildParentDropdownRow(ctrl));
  const convertRow = buildConvertToRow(ctrl);
  if (convertRow) frag.appendChild(convertRow);

  frag.appendChild(xyQuickRow(ctrl, 'x', 'X'));
  frag.appendChild(xyQuickRow(ctrl, 'y', 'Y'));
  frag.appendChild(whQuickRow(ctrl, 'w', 'Width', '\u2194'));
  frag.appendChild(whQuickRow(ctrl, 'h', 'Height', '\u2195'));

  const zRow = document.createElement('div');
  zRow.className = 'prop-row';
  zRow.innerHTML = `<label title="${escapeHtml(tt('z'))}">Z-Index</label><input type="number" value="${ctrl.z}">`;
  zRow.querySelector('input').addEventListener('change', (e) => { ctrl.z = Number(e.target.value) || 0; render(); });
  frag.appendChild(zRow);

  return frag;
}

function buildNudgeSection(ctrl) {
  const frag = document.createElement('div');
  const wrap = document.createElement('div');
  wrap.className = 'nudge-wrap';

  const dpad = document.createElement('div');
  dpad.className = 'dpad';
  dpad.innerHTML = `
    <button class="d-up" title="Up">\u2191</button>
    <button class="d-left" title="Left">\u2190</button>
    <button class="d-center" title="Center within parent (both axes)">\u2316</button>
    <button class="d-right" title="Right">\u2192</button>
    <button class="d-down" title="Down">\u2193</button>`;
  dpad.querySelector('.d-up').addEventListener('click', () => nudge('up'));
  dpad.querySelector('.d-down').addEventListener('click', () => nudge('down'));
  dpad.querySelector('.d-left').addEventListener('click', () => nudge('left'));
  dpad.querySelector('.d-right').addEventListener('click', () => nudge('right'));
  dpad.querySelector('.d-center').addEventListener('click', () => centerControl(ctrl, 'both'));

  const steps = document.createElement('div');
  steps.className = 'step-options';
  // Two columns: [1,5,10] alongside [25,50,100] - paired up so default
  // row-major grid flow (CSS) lands each pair on the same row.
  [[1, 25], [5, 50], [10, 100]].forEach(pair => {
    pair.forEach(step => {
      const label = document.createElement('label');
      label.innerHTML = `<input type="radio" name="nudgeStep" value="${step}" ${state.nudgeStep === step ? 'checked' : ''}> ${step}px`;
      label.querySelector('input').addEventListener('change', () => { state.nudgeStep = step; });
      steps.appendChild(label);
    });
  });

  wrap.appendChild(dpad);
  wrap.appendChild(steps);
  frag.appendChild(wrap);

  const snapRow = document.createElement('div');
  snapRow.className = 'snap-row';
  snapRow.innerHTML = `<input type="checkbox" id="snapToggle" ${state.snapEnabled ? 'checked' : ''}><label for="snapToggle">Snap to grid (${state.gridSize}px)</label>`;
  snapRow.querySelector('input').addEventListener('change', (e) => { state.snapEnabled = e.target.checked; renderStatus(); });
  frag.appendChild(snapRow);

  return frag;
}

function buildAnchorEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'prop-row anchor-editor-row';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.title = tt(key);

  const grid = document.createElement('div');
  grid.className = 'anchor-editor-grid';

  const current = ctrl.props[key] || 'Top, Left';
  const flags = current === 'None' ? [] : current.split(',').map(s => s.trim());
  const order = ['Top', 'Bottom', 'Left', 'Right'];

  order.forEach(edge => {
    const chip = document.createElement('label');
    chip.className = 'anchor-editor-chip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = flags.includes(edge);
    cb.addEventListener('change', () => {
      const set = new Set(flags);
      if (cb.checked) set.add(edge); else set.delete(edge);
      flags.length = 0;
      order.filter(o => set.has(o)).forEach(o => flags.push(o));
      ctrl.props[key] = flags.length ? flags.join(', ') : 'None';
      // No immediate positional effect - Anchor is forward-looking, its
      // percentages get captured fresh the next time the parent resizes.
      render();
    });
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(edge));
    grid.appendChild(chip);
  });

  wrap.appendChild(labelEl);
  wrap.appendChild(grid);
  return wrap;
}

// The 9 ContentAlignment points, in reading order (top row left-to-right,
// then middle, then bottom) - drives both the picker grid below and the
// literal enum name CodeGen-WinForms.js emits for Label.TextAlign.
const CONTENT_ALIGN_POINTS = [
  'TopLeft', 'TopCenter', 'TopRight',
  'MiddleLeft', 'MiddleCenter', 'MiddleRight',
  'BottomLeft', 'BottomCenter', 'BottomRight',
];

function buildContentAlignEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'prop-row content-align-editor-row';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.title = tt(key);

  const grid = document.createElement('div');
  grid.className = 'content-align-editor-grid';

  const current = ctrl.props[key] || 'MiddleLeft';
  // Nine discrete points (Top/Middle/Bottom x Left/Center/Right), laid out
  // in reading order to match their real on-screen position - unlike
  // Anchor's independent per-edge flags, only one of these can be active
  // at a time.
  CONTENT_ALIGN_POINTS.forEach(point => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'content-align-editor-cell' + (point === current ? ' active' : '');
    cell.title = point.replace(/([A-Z])/g, ' $1').trim();
    cell.addEventListener('click', () => { ctrl.props[key] = point; render(); });
    grid.appendChild(cell);
  });

  wrap.appendChild(labelEl);
  wrap.appendChild(grid);
  return wrap;
}

function buildItemsListEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'items-list-editor';

  const heading = document.createElement('div');
  heading.className = 'items-list-heading';
  heading.title = 'The selectable entries in this control. Add, remove, or edit them below - order matters (item 0 is first).';
  heading.textContent = label;
  wrap.appendChild(heading);

  const arr = (ctrl.props[key] || '').split('\n').filter((s, i, a) => !(s === '' && i === a.length - 1));
  const sync = () => { ctrl.props[key] = arr.join('\n'); render(); };

  arr.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'items-list-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = item;
    input.addEventListener('change', () => { arr[i] = input.value; sync(); });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
    delBtn.textContent = '\u2715';
    delBtn.title = 'Remove this item.';
    delBtn.addEventListener('click', () => { arr.splice(i, 1); sync(); });
    row.appendChild(input);
    row.appendChild(delBtn);
    wrap.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost menu-add-btn';
  addBtn.textContent = '+ Add item';
  addBtn.addEventListener('click', () => { arr.push('New Item'); sync(); });
  wrap.appendChild(addBtn);

  return wrap;
}

function buildToolStripIconPicker(item, sync) {
  const wrap = document.createElement('div');
  wrap.className = 'icon-picker';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-picker-btn';
  btn.innerHTML = toolStripIconSvg(item.icon);
  btn.title = 'Choose an icon';

  const popover = document.createElement('div');
  popover.className = 'icon-picker-popover';
  Object.keys(TOOLSTRIP_ICONS).forEach(k => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'icon-picker-option' + (item.icon === k ? ' active' : '');
    opt.innerHTML = k === 'none' ? '<span class="icon-picker-none">\u2014</span>' : toolStripIconSvg(k);
    opt.title = k === 'none' ? '(no icon)' : k[0].toUpperCase() + k.slice(1);
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      item.icon = k;
      popover.classList.remove('open');
      sync();
    });
    popover.appendChild(opt);
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.icon-picker-popover.open').forEach(p => { if (p !== popover) p.classList.remove('open'); });
    popover.classList.toggle('open');
  });

  wrap.appendChild(btn);
  wrap.appendChild(popover);
  return wrap;
}

function buildToolStripItemsEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'items-list-editor toolstrip-items-editor';

  const heading = document.createElement('div');
  heading.className = 'items-list-heading';
  heading.title = 'Each button gets an icon and a label. More icons can be added to the library later - for now: New, Open, Save, or none.';
  heading.textContent = label;
  wrap.appendChild(heading);

  const arr = ctrl.props[key];
  const sync = () => { render(); };

  arr.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'toolstrip-item-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.label;
    input.addEventListener('change', () => { item.label = input.value; sync(); });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
    delBtn.textContent = '\u2715';
    delBtn.title = 'Remove this button.';
    delBtn.addEventListener('click', () => { arr.splice(i, 1); sync(); });

    row.appendChild(buildToolStripIconPicker(item, sync));
    row.appendChild(input);
    row.appendChild(delBtn);
    wrap.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost menu-add-btn';
  addBtn.textContent = '+ Add item';
  addBtn.addEventListener('click', () => {
    arr.push({ id: 'item' + Math.random().toString(36).slice(2, 8), label: 'New Item', icon: 'none' });
    sync();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function buildPropRows(ctrl, propDefs) {
  const frag = document.createElement('div');
  propDefs.forEach(([key, label, type, , extra]) => {
    const tipAttr = escapeHtml(tt(key));

    if (type === 'hidden') return; // tracked in props for codegen/undo, but not user-editable as a raw row
    if (type === 'menuEditor') {
      frag.appendChild(buildMenuEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'tabEditor') {
      frag.appendChild(buildTabEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'wizardPagesEditor') {
      frag.appendChild(buildWizardPagesEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'wizardFooterOptionsEditor') {
      frag.appendChild(buildWizardFooterOptionsEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'anchorEditor') {
      frag.appendChild(buildAnchorEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'contentAlignEditor') {
      frag.appendChild(buildContentAlignEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'itemsListEditor') {
      frag.appendChild(buildItemsListEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'toolStripItemsEditor') {
      frag.appendChild(buildToolStripItemsEditorRow(ctrl, key, label));
      return;
    }
    if (type === 'px') {
      frag.appendChild(pixelStepperRow(label, ctrl.props[key], (v) => { ctrl.props[key] = v; render(); }, { min: 1, tooltip: tt(key) }));
      return;
    }
    const row = document.createElement('div');
    row.className = 'prop-row' + (extra && extra.itemsEditor ? ' items-editor' : '');
    const val = ctrl.props[key];

    if (type === 'textarea') {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><textarea>${escapeHtml(val)}</textarea>`;
      const ta = row.querySelector('textarea');
      ta.addEventListener('change', () => { ctrl.props[key] = ta.value; render(); });
      if (extra && extra.itemsEditor) {
        const hint = document.createElement('div');
        hint.className = 'items-hint';
        hint.textContent = 'One item per line';
        row.appendChild(hint);
      }
    } else if (type === 'checkbox') {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><input type="checkbox" ${val ? 'checked' : ''}>`;
      row.querySelector('input').addEventListener('change', (e) => { ctrl.props[key] = e.target.checked; render(); });
    } else if (type === 'color') {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><input type="color" value="${val}">`;
      row.querySelector('input').addEventListener('input', (e) => { ctrl.props[key] = e.target.value; render(); });
    } else if (type === 'select') {
      const opts = extra.options.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('');
      row.innerHTML = `<label title="${tipAttr}">${label}</label><select>${opts}</select>`;
      row.querySelector('select').addEventListener('change', (e) => {
        const newVal = e.target.value;
        if (key === 'dock') {
          if (newVal !== 'None' && (ctrl.props.dock || 'None') === 'None') ctrl.dockOrder = ++state.dockOrderSeq;
          if (newVal === 'None') ctrl.dockOrder = null;
        }
        ctrl.props[key] = newVal;
        render(); // docking (if this was Dock) is recomputed centrally at the top of render()
      });
      if (OPTION_DEFINITIONS[key]) row.querySelector('label').appendChild(buildOptionInfoButton(key, label, extra.options));
      frag.appendChild(row);
      if (key === 'dock') {
        const isDocked = val && val !== 'None';
        const dockOrderRow = document.createElement('div');
        dockOrderRow.className = 'prop-row';
        dockOrderRow.innerHTML = `<label title="Docking priority among siblings docked to the same edge - lower numbers claim their space first. Set automatically when Dock is turned on (MenuStrip/ToolStrip/StatusStrip always order themselves sensibly), but you can override it here. Only matters while Dock isn't None.">Dock Index</label><input type="number" value="${ctrl.dockOrder != null ? ctrl.dockOrder : ''}" placeholder="${isDocked ? '0' : 'not docked'}" ${isDocked ? '' : 'disabled'}>`;
        dockOrderRow.querySelector('input').addEventListener('change', (e) => {
          const v = e.target.value.trim();
          ctrl.dockOrder = v === '' ? null : Number(v);
          render();
        });
        frag.appendChild(dockOrderRow);
      }
      return;
    } else if (type === 'number') {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><input type="number" value="${val}">`;
      row.querySelector('input').addEventListener('change', (e) => { ctrl.props[key] = Number(e.target.value) || 0; render(); });
    } else {
      row.innerHTML = `<label title="${tipAttr}">${label}</label><input type="text" value="${escapeHtml(val)}">`;
      row.querySelector('input').addEventListener('change', (e) => {
        ctrl.props[key] = e.target.value;
        // Editing Text directly breaks the one-way Name -> Text sync
        // permanently (TEXT_SYNCS_WITH_NAME_TYPES, Control-Data.js) -
        // never re-synced afterward, even if Name changes again later.
        if (key === 'text') ctrl.textAutoSynced = false;
        render();
      });
    }
    frag.appendChild(row);
  });
  return frag;
}

/* =========================================================================
   MenuStrip editor: checkbox-enabled preset menus + custom menu/item support
   ========================================================================= */

/* =========================================================================
   TabControl editor: add/rename/remove tab pages
   ========================================================================= */

function buildTabEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'tab-editor';

  const heading = document.createElement('div');
  heading.className = 'tab-editor-heading';
  heading.title = tt(key);
  heading.textContent = label;
  wrap.appendChild(heading);

  const tabs = ctrl.props[key];
  tabs.forEach((tab, ti) => {
    wrap.appendChild(buildTabEditorItem(ctrl, tabs, tab, ti));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost tab-add-btn';
  addBtn.textContent = '+ Add tab';
  addBtn.title = 'Add a new tab page.';
  addBtn.addEventListener('click', () => {
    const newId = 'tab' + Math.random().toString(36).slice(2, 8);
    tabs.push({ id: newId, label: 'Tab' + (tabs.length + 1) });
    render();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function buildTabEditorItem(ctrl, tabs, tab, ti) {
  const row = document.createElement('div');
  row.className = 'tab-editor-item' + (tab.id === ctrl.activeTabId ? ' active' : '');

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'menu-editor-label-input';
  nameInput.value = tab.label;
  nameInput.addEventListener('change', (e) => { tab.label = e.target.value.trim() || tab.label; render(); });

  const selectBtn = document.createElement('button');
  selectBtn.type = 'button';
  selectBtn.className = 'btn btn-ghost tab-select-btn';
  selectBtn.textContent = tab.id === ctrl.activeTabId ? 'Active' : 'Show';
  selectBtn.title = 'Switch the canvas to this tab page so you can place controls on it.';
  selectBtn.addEventListener('click', () => { ctrl.activeTabId = tab.id; render(); });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this tab page and everything placed on it.';
  delBtn.addEventListener('click', () => {
    if (tabs.length <= 1) return; // a TabControl needs at least one tab
    state.controls = state.controls.filter(c => !(c.parentId === ctrl.id && c.tabPage === tab.id));
    tabs.splice(ti, 1);
    if (ctrl.activeTabId === tab.id) ctrl.activeTabId = tabs[0].id;
    render();
  });

  row.appendChild(nameInput);
  row.appendChild(selectBtn);
  row.appendChild(delBtn);
  return row;
}

function buildMenuEditorRow(ctrl, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-editor';

  const heading = document.createElement('div');
  heading.className = 'menu-editor-heading';
  heading.title = tt(key);
  heading.textContent = label;
  wrap.appendChild(heading);

  const menus = ctrl.props[key];

  menus.forEach((menu, mi) => {
    wrap.appendChild(buildMenuTopItem(ctrl, key, menus, menu, mi));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost menu-add-btn';
  addBtn.textContent = '+ Add custom menu';
  addBtn.title = 'Add a new top-level menu (fully custom, not a preset).';
  addBtn.addEventListener('click', () => {
    menus.push({ id: 'menu' + Math.random().toString(36).slice(2, 8), label: 'NewMenu', enabled: true, preset: false, items: [] });
    render();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function buildMenuTopItem(ctrl, key, menus, menu, mi) {
  const box = document.createElement('div');
  box.className = 'menu-editor-item';

  const head = document.createElement('div');
  head.className = 'menu-editor-item-head';

  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = !!menu.enabled;
  chk.title = 'Include this menu in the generated code.';
  chk.addEventListener('change', (e) => { menu.enabled = e.target.checked; render(); });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'menu-editor-label-input';
  nameInput.value = menu.label;
  nameInput.addEventListener('change', (e) => { menu.label = e.target.value.trim() || menu.label; render(); });

  const tag = document.createElement('span');
  tag.className = 'menu-editor-tag';
  tag.textContent = menu.preset ? 'preset' : 'custom';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this menu entirely.';
  delBtn.addEventListener('click', () => { menus.splice(mi, 1); render(); });

  head.appendChild(chk);
  head.appendChild(nameInput);
  head.appendChild(tag);
  head.appendChild(delBtn);
  box.appendChild(head);

  const itemsWrap = document.createElement('div');
  itemsWrap.className = 'menu-editor-subitems';
  menu.items.forEach((it, ii) => {
    itemsWrap.appendChild(buildMenuSubItem(menu, it, ii));
  });

  const addItemBtn = document.createElement('button');
  addItemBtn.type = 'button';
  addItemBtn.className = 'btn btn-ghost menu-add-item-btn';
  addItemBtn.textContent = '+ Add item';
  addItemBtn.title = 'Add a custom entry under this menu.';
  addItemBtn.addEventListener('click', () => {
    menu.items.push({ id: 'item' + Math.random().toString(36).slice(2, 8), label: 'New Item', enabled: true, preset: false, code: '' });
    render();
  });
  itemsWrap.appendChild(addItemBtn);

  box.appendChild(itemsWrap);
  return box;
}

function buildMenuSubItem(menu, it, ii) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-editor-subitem-wrap';

  const row = document.createElement('div');
  row.className = 'menu-editor-subitem-row';

  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = !!it.enabled;
  chk.title = 'Include this entry in the generated menu.';
  chk.addEventListener('change', (e) => { it.enabled = e.target.checked; render(); });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'menu-editor-label-input';
  nameInput.value = it.label;
  nameInput.title = it.label === '-' ? 'A single dash renders as a separator line.' : '';
  nameInput.addEventListener('change', (e) => { it.label = e.target.value.trim() || it.label; render(); });

  const tag = document.createElement('span');
  tag.className = 'menu-editor-tag';
  tag.textContent = it.preset ? 'preset' : 'custom';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this entry.';
  delBtn.addEventListener('click', () => { menu.items.splice(ii, 1); render(); });

  row.appendChild(chk);
  row.appendChild(nameInput);
  row.appendChild(tag);
  row.appendChild(delBtn);
  wrap.appendChild(row);

  const isSeparator = it.label === '-';
  if (!isSeparator) {
    const codeRow = document.createElement('div');
    codeRow.className = 'menu-editor-code-row';
    const codeLabel = document.createElement('label');
    codeLabel.textContent = it.autoAbout ? 'Code (auto-generated from Comment-Based Help)' : 'Code (PowerShell / JS, runs on click)';
    codeLabel.title = it.autoAbout
      ? 'This item shows your .SYNOPSIS/.DESCRIPTION text in a message box automatically. Start typing below to override it with custom code.'
      : 'Handler that runs when this menu item is clicked.';
    const codeTa = document.createElement('textarea');
    codeTa.className = 'menu-editor-code';
    codeTa.value = it.autoAbout ? '' : (it.code || '');
    codeTa.placeholder = it.autoAbout ? '(auto) shows .SYNOPSIS / .DESCRIPTION in a message box' : '';
    codeTa.addEventListener('change', () => {
      it.code = codeTa.value;
      if (codeTa.value.trim()) it.autoAbout = false;
      render();
    });
    codeRow.appendChild(codeLabel);
    codeRow.appendChild(codeTa);
    wrap.appendChild(codeRow);
  }

  return wrap;
}

function buildInteractFixedBlock(ctrl) {
  const wrap = document.createElement('div');
  wrap.className = 'interact-fixed';
  const row = document.createElement('div');
  row.className = 'toggle-row';
  row.title = 'When on, clicks/keys go to the real control (e.g. open a dropdown or check a box) instead of selecting/dragging it in the designer.';
  row.innerHTML = `
    <span class="toggle-label">Pause editing &amp; interact with control</span>
    <label class="switch"><input type="checkbox" ${ctrl.interact ? 'checked' : ''}><span class="track"></span></label>`;
  row.querySelector('input').addEventListener('change', (e) => { ctrl.interact = e.target.checked; render(); });
  wrap.appendChild(row);
  return wrap;
}

function buildSnippetParamRow(ctrl, snippet, action, param, sync) {
  const row = document.createElement('div');
  row.className = 'snippet-param-row';
  const label = document.createElement('label');
  label.textContent = param.label;
  row.appendChild(label);

  if (param.type === 'control') {
    const wrap = document.createElement('div');
    wrap.className = 'snippet-param-control';
    const display = document.createElement('span');
    display.className = 'snippet-param-control-name';
    display.textContent = action.params[param.key] ? action.params[param.key] : '(not set)';
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'btn btn-ghost pick-control-btn';
    pickBtn.innerHTML = '\u2316 Select Control';
    pickBtn.title = 'Click, then click any control on the canvas (or "Or pick from list" for one on an inactive tab) to set this.';
    pickBtn.addEventListener('click', () => {
      startControlPick((pickedCtrl) => {
        action.params[param.key] = pickedCtrl.name;
        if (param.key === 'target') {
          // A property valid for the old target might not exist on the
          // new one - reset both so there's no stale/invalid carryover.
          delete action.params.property;
          delete action.params.value;
        }
        action.code = computeSnippetCode(snippet, action.params, ctrl);
        sync();
        render();
      });
    });
    wrap.appendChild(display);
    wrap.appendChild(pickBtn);
    row.appendChild(wrap);
  } else if (param.type === 'boolean') {
    const sw = document.createElement('label');
    sw.className = 'switch';
    sw.innerHTML = `<input type="checkbox" ${action.params[param.key] ? 'checked' : ''}><span class="track"></span>`;
    sw.querySelector('input').addEventListener('change', (e) => {
      action.params[param.key] = e.target.checked;
      action.code = computeSnippetCode(snippet, action.params, ctrl);
      sync();
      render();
    });
    row.appendChild(sw);
  } else if (param.type === 'select') {
    const sel = document.createElement('select');
    param.options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      if (action.params[param.key] === o) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', (e) => {
      action.params[param.key] = e.target.value;
      action.code = computeSnippetCode(snippet, action.params, ctrl);
      sync();
      render();
    });
    row.appendChild(sel);
  } else if (param.type === 'itemIndex') {
    // Only makes sense scoped to THIS control's own Items list (e.g. a
    // CheckedListBox's ItemCheck event referencing one of its own items).
    const sel = document.createElement('select');
    const items = (ctrl.props.items || '').split('\n').filter(Boolean);
    if (!items.length) {
      const opt = document.createElement('option');
      opt.textContent = '(no items - add some in ' + ctrl.type + '-specific > Items)';
      sel.appendChild(opt);
    }
    items.forEach((it, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = `${idx}: ${it}`;
      if (String(action.params[param.key]) === String(idx)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', (e) => {
      action.params[param.key] = e.target.value;
      action.code = computeSnippetCode(snippet, action.params, ctrl);
      sync();
      render();
    });
    row.appendChild(sel);
  } else if (param.type === 'targetProperty') {
    // Options depend entirely on which control was picked as the target -
    // this is what actually prevents picking a property that control
    // doesn't have (e.g. SelectedIndex on a NumericUpDown).
    const targetCtrl = action.params.target ? getControlByName(action.params.target) : null;
    const sel = document.createElement('select');
    if (!targetCtrl) {
      const opt = document.createElement('option');
      opt.textContent = '(pick a Target Control first)';
      sel.appendChild(opt);
      sel.disabled = true;
    } else {
      getSettableProps(targetCtrl.type).forEach(propName => {
        const opt = document.createElement('option');
        opt.value = propName;
        opt.textContent = propName;
        if (action.params[param.key] === propName) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', (e) => {
        action.params[param.key] = e.target.value;
        delete action.params.value; // widget kind for Value depends on Property
        action.code = computeSnippetCode(snippet, action.params, ctrl);
        sync();
        render();
      });
    }
    row.appendChild(sel);
  } else if (param.type === 'targetValue') {
    const targetCtrl = action.params.target ? getControlByName(action.params.target) : null;
    const kind = targetCtrl ? resolveValueWidgetKind(targetCtrl.type, action.params.property) : 'text';
    if (!targetCtrl) {
      const hint = document.createElement('span');
      hint.className = 'snippet-param-control-name';
      hint.textContent = '(pick a Target Control first)';
      row.appendChild(hint);
    } else if (kind === 'boolean') {
      const sw = document.createElement('label');
      sw.className = 'switch';
      sw.innerHTML = `<input type="checkbox" ${action.params[param.key] ? 'checked' : ''}><span class="track"></span>`;
      sw.querySelector('input').addEventListener('change', (e) => {
        action.params[param.key] = e.target.checked;
        action.code = computeSnippetCode(snippet, action.params, ctrl);
        sync();
        render();
      });
      row.appendChild(sw);
    } else if (kind === 'date') {
      const input = document.createElement('input');
      input.type = 'date';
      input.value = action.params[param.key] || '';
      input.addEventListener('change', (e) => {
        action.params[param.key] = e.target.value;
        action.code = computeSnippetCode(snippet, action.params, ctrl);
        sync();
        render();
      });
      row.appendChild(input);
    } else if (kind === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = action.params[param.key] != null ? action.params[param.key] : '';
      input.addEventListener('change', (e) => {
        action.params[param.key] = e.target.value;
        action.code = computeSnippetCode(snippet, action.params, ctrl);
        sync();
        render();
      });
      row.appendChild(input);
    } else if (kind === 'targetItemIndex') {
      // The whole point: show the TARGET's own item labels, not raw
      // index numbers you'd otherwise have to count by hand.
      const sel = document.createElement('select');
      const items = (targetCtrl.props.items || '').split('\n').filter(Boolean);
      if (!items.length) {
        const opt = document.createElement('option');
        opt.textContent = `(${targetCtrl.name} has no items yet)`;
        sel.appendChild(opt);
      }
      items.forEach((it, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = `${idx}: ${it}`;
        if (String(action.params[param.key]) === String(idx)) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', (e) => {
        action.params[param.key] = e.target.value;
        action.code = computeSnippetCode(snippet, action.params, ctrl);
        sync();
        render();
      });
      row.appendChild(sel);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = action.params[param.key] != null ? action.params[param.key] : '';
      input.addEventListener('change', (e) => {
        action.params[param.key] = e.target.value;
        action.code = computeSnippetCode(snippet, action.params, ctrl);
        sync();
        render();
      });
      row.appendChild(input);
    }
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = action.params[param.key] != null ? action.params[param.key] : '';
    input.addEventListener('change', (e) => {
      action.params[param.key] = e.target.value;
      action.code = computeSnippetCode(snippet, action.params, ctrl);
      sync();
      render();
    });
    row.appendChild(input);
  }

  return row;
}

function buildActionBlock(ctrl, evtName, actions, i, sync) {
  const action = actions[i];
  const card = document.createElement('div');
  card.className = 'action-block';

  const head = document.createElement('div');
  head.className = 'action-block-head';
  const label = document.createElement('span');
  label.textContent = `Action ${i + 1}`;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-danger menu-del-btn';
  delBtn.textContent = '\u2715';
  delBtn.title = 'Remove this action.';
  delBtn.addEventListener('click', () => {
    actions.splice(i, 1);
    if (!actions.length) actions.push({ code: '', snippetId: null, params: {} });
    sync();
    render();
  });
  head.appendChild(label);
  head.appendChild(delBtn);
  card.appendChild(head);

  const boundSnippet = action.snippetId ? EVENT_SNIPPETS.find(s => s.id === action.snippetId) : null;

  if (boundSnippet) {
    // Structured mode: real fields per parameter, code is fully derived -
    // nothing here is hand-typed, so there's no way to end up with mangled
    // syntax from stacking snippets or guessing where to paste a name.
    const boundHead = document.createElement('div');
    boundHead.className = 'snippet-bound-head';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = boundSnippet.label;
    const infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.className = 'option-info-btn';
    infoBtn.textContent = 'i';
    infoBtn.title = 'What does this snippet do?';
    infoBtn.addEventListener('click', () => showInfoModalText(boundSnippet.label.toUpperCase(), boundSnippet.help));
    const unbindBtn = document.createElement('button');
    unbindBtn.type = 'button';
    unbindBtn.className = 'btn btn-ghost';
    unbindBtn.textContent = 'Edit as raw code';
    unbindBtn.title = 'Detach from this snippet template and hand-edit the code directly.';
    unbindBtn.addEventListener('click', () => { action.snippetId = null; render(); });
    boundHead.appendChild(nameSpan);
    boundHead.appendChild(infoBtn);
    boundHead.appendChild(unbindBtn);
    card.appendChild(boundHead);

    if (!action.params) action.params = {};
    boundSnippet.params.forEach(p => card.appendChild(buildSnippetParamRow(ctrl, boundSnippet, action, p, sync)));

    const preview = document.createElement('pre');
    preview.className = 'snippet-code-preview';
    preview.textContent = action.code;
    card.appendChild(preview);

    card.appendChild(buildCliActionTagEditor(ctrl, action, sync));

    return card;
  }

  // Raw/freeform mode: pick a snippet to bind (replaces this action's
  // content, doesn't append), or type/paste code directly.
  const snippetRow = document.createElement('div');
  snippetRow.className = 'snippet-row';
  const sel = document.createElement('select');
  EVENT_SNIPPETS
    .filter(s => !s.onlyFor || s.onlyFor.includes(evtName))
    .forEach(s => {
      const o = document.createElement('option');
      o.textContent = s.label;
      o.dataset.id = s.id;
      o.dataset.help = s.help;
      sel.appendChild(o);
    });
  const infoBtn = document.createElement('button');
  infoBtn.type = 'button';
  infoBtn.className = 'option-info-btn';
  infoBtn.textContent = 'i';
  infoBtn.title = 'What does this snippet do?';
  infoBtn.addEventListener('click', () => {
    const opt = sel.selectedOptions[0];
    showInfoModalText(opt.textContent.toUpperCase(), opt.dataset.help || 'No description yet.');
  });
  const insertBtn = document.createElement('button');
  insertBtn.type = 'button';
  insertBtn.className = 'btn btn-ghost';
  insertBtn.textContent = 'Insert';
  snippetRow.appendChild(sel);
  snippetRow.appendChild(infoBtn);
  snippetRow.appendChild(insertBtn);
  card.appendChild(snippetRow);

  const ta = document.createElement('textarea');
  ta.className = 'action-code';
  ta.placeholder = 'PowerShell / JS for this action';
  ta.value = action.code;
  ta.addEventListener('change', () => { action.code = ta.value; sync(); });
  card.appendChild(ta);

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'btn btn-ghost pick-control-btn';
  pickBtn.innerHTML = '\u2316 Select Control';
  pickBtn.title = 'Click, then click any control on the canvas to insert its name at the cursor - for hand-editing raw code. Pick a "Set another control\'s text"-style snippet instead for a fully guided flow.';
  pickBtn.addEventListener('click', () => {
    startControlPick((pickedCtrl) => {
      const varRef = '$' + pickedCtrl.name;
      const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
      const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
      ta.value = ta.value.slice(0, start) + varRef + ta.value.slice(end);
      action.code = ta.value;
      sync();
      render();
    });
  });
  card.appendChild(pickBtn);
  card.appendChild(buildCliActionTagEditor(ctrl, action, sync));

  insertBtn.addEventListener('click', () => {
    const id = sel.selectedOptions[0].dataset.id;
    const snippet = EVENT_SNIPPETS.find(s => s.id === id);
    if (!snippet || !snippet.id || snippet.id === 'none') return;
    // Binding REPLACES this action's content - it never appends onto
    // whatever was already here, which is what used to produce mangled
    // multi-snippet code. Use "+ Add action" for a second, independent one.
    action.snippetId = snippet.id;
    action.params = {};
    snippet.params.forEach(p => { action.params[p.key] = p.default !== undefined ? p.default : (p.type === 'boolean' ? false : ''); });
    action.code = computeSnippetCode(snippet, action.params, ctrl);
    sync();
    render();
  });

  return card;
}

function buildActionsEditor(ctrl, evtName, data) {
  const wrap = document.createElement('div');
  wrap.className = 'actions-editor';

  const heading = document.createElement('div');
  heading.className = 'items-list-heading';
  heading.title = 'Each action runs in order when this event fires. Add as many as you need - e.g. update a label, AND enable another control, AND show a message, all from one event.';
  heading.textContent = 'Actions';
  wrap.appendChild(heading);

  // data.actions is the real source of truth (structured: code + optional
  // snippet binding + params). data.code is kept as a plain joined string
  // in sync with it at all times, purely so CodeGen.js never has to change
  // - it just keeps reading data.code exactly as before. If data.actions
  // doesn't exist yet (an event created before this feature, or hand-typed
  // raw code), it's derived once from data.code as freeform actions.
  if (!data.actions) {
    data.actions = (data.code ? data.code.split('\n\n') : ['']).map(code => ({ code, snippetId: null, params: {} }));
  }
  const actions = data.actions;
  const sync = () => {
    data.code = actions.map(a => a.code).join('\n\n');
    ctrl.events[evtName] = data;
  };

  actions.forEach((action, i) => wrap.appendChild(buildActionBlock(ctrl, evtName, actions, i, sync)));

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost menu-add-btn';
  addBtn.textContent = '+ Add action';
  addBtn.title = 'Add another, independent action to run when this event fires, alongside the ones above.';
  addBtn.addEventListener('click', () => { actions.push({ code: '', snippetId: null, params: {} }); sync(); render(); });
  wrap.appendChild(addBtn);

  // "+ Add log" - a shortcut onto the same actions list, pre-bound to a
  // summary-log snippet (summaryLogAdd/summaryLogToggle) so all that's
  // left to fill in is the message text - there's no Target Control to
  // pick anymore, since a wizard has one shared entries dictionary and
  // the snippet resolves it automatically (via {wizardName} in the
  // template, computeSnippetCode) from whichever wizard this control
  // lives inside (findAncestorWizard, Wizard-Builder.js). On
  // CheckedChanged this binds the toggle variant (adds while checked,
  // removes again when unchecked) rather than the plain always-set one,
  // since a checkbox is a state a person can flip back. Only appears
  // (enabled) when ctrl is inside a wizard that has a Summary and/or
  // summaryAfter page with a RichTextBox to display the entries on
  // (findWizardAnyLogDisplayBox, Wizard-Builder.js) - summaryAfter
  // counts too, as a fallback display, even without a Summary page.
  const wizardCtrl = findAncestorWizard(ctrl);
  const logTarget = wizardCtrl ? findWizardAnyLogDisplayBox(wizardCtrl) : null;
  const logSnippetId = evtName === 'CheckedChanged' ? 'summaryLogToggle' : 'summaryLogAdd';
  const logBtn = document.createElement('button');
  logBtn.type = 'button';
  logBtn.className = 'btn btn-ghost menu-add-btn';
  logBtn.textContent = '+ Add log';
  logBtn.disabled = !logTarget;
  logBtn.title = logTarget
    ? `Add a line to the wizard's Summary of Tasks log when this event fires - just write the message.${evtName === 'CheckedChanged' ? ' Removes the line again if unchecked, so toggling doesn\'t duplicate it.' : ''}`
    : 'This control isn\'t inside a wizard with a Summary or summaryAfter page to show a log on yet.';
  logBtn.addEventListener('click', () => {
    if (!logTarget) return;
    const snippet = EVENT_SNIPPETS.find(s => s.id === logSnippetId);
    const action = { code: '', snippetId: snippet.id, params: {} };
    snippet.params.forEach(p => {
      // The message defaults to this control's own Text (e.g. "Option A")
      // when it has one, rather than the generic placeholder sentence -
      // short and specific beats a one-size-fits-all default, and it's
      // still just a starting point the person can edit either way.
      let val = p.default !== undefined ? p.default : '';
      if (p.key === 'message' && ctrl.props && ctrl.props.text) val = ctrl.props.text;
      action.params[p.key] = val;
    });
    action.code = computeSnippetCode(snippet, action.params, ctrl);
    actions.push(action);
    sync();
    render();
  });
  wrap.appendChild(logBtn);

  return wrap;
}

function buildEventsSection(ctrl) {
  const def = CONTROL_DEFS[ctrl.type];
  const frag = document.createElement('div');

  def.events.forEach(evtName => {
    const existing = ctrl.events[evtName];
    const block = document.createElement('div');
    block.className = 'event-block' + (existing ? ' open' : '');
    const head = document.createElement('div');
    head.className = 'event-block-head';
    const headLeft = document.createElement('span');
    headLeft.className = 'event-block-head-left';
    if (EVENT_HELP[evtName]) {
      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'option-info-btn';
      infoBtn.textContent = 'i';
      infoBtn.title = `What is ${evtName}?`;
      infoBtn.addEventListener('click', (ev) => { ev.stopPropagation(); showInfoModalText(evtName.toUpperCase(), EVENT_HELP[evtName]); });
      headLeft.appendChild(infoBtn);
    }
    headLeft.appendChild(document.createTextNode(evtName));
    const headRight = document.createElement('span');
    headRight.textContent = existing ? '\u2212 remove (dbl-click)' : '+ add handler';
    head.appendChild(headLeft);
    head.appendChild(headRight);

    const body = document.createElement('div');
    body.className = 'event-block-body';

    const data = existing || { fn: `${ctrl.name}_${evtName}`, code: evtName === 'ClickToClose' ? '$Form.Close()' : '', ps1: '' };

    const fnRow = document.createElement('div');
    fnRow.className = 'prop-row';
    fnRow.innerHTML = `<label title="Name of the function/handler that runs when ${evtName} fires.">Function</label><input type="text" value="${escapeHtml(data.fn)}">`;
    fnRow.querySelector('input').addEventListener('change', (e) => { data.fn = e.target.value; ctrl.events[evtName] = data; });

    const ps1Row = document.createElement('div');
    ps1Row.className = 'prop-row';
    ps1Row.innerHTML = `<label title="Path to an external .ps1 script to dot-source and call instead of inline code.">Or .ps1 file</label><input type="text" placeholder="handlers\\${ctrl.name}_${evtName}.ps1" value="${escapeHtml(data.ps1)}">`;
    ps1Row.querySelector('input').addEventListener('change', (e) => { data.ps1 = e.target.value; ctrl.events[evtName] = data; });

    body.appendChild(fnRow);
    body.appendChild(buildActionsEditor(ctrl, evtName, data));
    body.appendChild(ps1Row);

    head.addEventListener('click', () => {
      if (!ctrl.events[evtName]) {
        ctrl.events[evtName] = data;
        render();
      } else {
        block.classList.toggle('open');
      }
    });

    // separate explicit remove affordance via double-click on header label
    head.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      ctrl.events[evtName] = null;
      renderProps();
    });

    block.appendChild(head);
    block.appendChild(body);
    frag.appendChild(block);
  });

  const hint = document.createElement('div');
  hint.className = 'items-hint';
  hint.textContent = 'Click an event to add/expand a handler. Double-click header to remove.';
  frag.appendChild(hint);

  return frag;
}

function buildFormProps() {
  const frag = document.createElement('div');

  const titleRow = document.createElement('div');
  titleRow.className = 'prop-row';
  titleRow.innerHTML = `<label title="Text shown in the window's title bar.">Title</label><input type="text" value="${escapeHtml(state.form.text)}">`;
  titleRow.querySelector('input').addEventListener('change', (e) => { state.form.text = e.target.value; render(); });
  frag.appendChild(titleRow);

  frag.appendChild(pixelStepperRow('Width', state.form.width, (v) => { state.form.width = v; render(); }, { min: 200 }));
  frag.appendChild(pixelStepperRow('Height', state.form.height, (v) => { state.form.height = v; render(); }, { min: 150 }));

  const colorRow = document.createElement('div');
  colorRow.className = 'prop-row';
  colorRow.innerHTML = `<label title="Background fill color of the form's client area.">Back Color</label><input type="color" value="${state.form.backColor}">`;
  colorRow.querySelector('input').addEventListener('input', (e) => { state.form.backColor = e.target.value; render(); });
  frag.appendChild(colorRow);

  frag.appendChild(section('Title Bar', buildFormChromeRows(), true));

  const hint = document.createElement('div');
  hint.className = 'items-hint';
  hint.style.marginTop = '8px';
  hint.textContent = 'Select a control on the canvas to edit its properties. Nothing selected \u2192 editing the form itself.';
  frag.appendChild(hint);

  frag.appendChild(section('Comment-Based Help', buildHelpBlockEditor(), false));

  return frag;
}

function buildFormChromeRows() {
  const frag = document.createElement('div');

  const chromeTips = {
    minimizeBox: 'Shows the minimize (_) button in the title bar.',
    maximizeBox: 'Shows the maximize (\u25a1) button in the title bar.',
    closeBox: 'Shows the close (\u00d7) button in the title bar.',
    topMost: 'Keeps the window above all other windows.',
  };
  [['minimizeBox', 'Minimize Button'], ['maximizeBox', 'Maximize Button'], ['closeBox', 'Close Button'], ['topMost', 'Always On Top (TopMost)']].forEach(([key, label]) => {
    const row = document.createElement('div');
    row.className = 'toggle-row';
    row.title = chromeTips[key];
    row.innerHTML = `<span class="toggle-label">${label}</span><label class="switch"><input type="checkbox" ${state.form[key] ? 'checked' : ''}><span class="track"></span></label>`;
    row.querySelector('input').addEventListener('change', (e) => { state.form[key] = e.target.checked; render(); });
    frag.appendChild(row);
  });

  // FormBorderStyle is a real multi-value WinForms enum (not a plain
  // true/false), so it's a dropdown - not a toggle - with every option
  // explained, since "Sizable" vs "FixedToolWindow" isn't self-evident.
  const fbsRow = document.createElement('div');
  fbsRow.className = 'prop-row';
  const fbsOpts = ['None', 'FixedSingle', 'Fixed3D', 'FixedDialog', 'Sizable', 'FixedToolWindow', 'SizableToolWindow'];
  fbsRow.innerHTML = `<label title="Controls the window's border/title-bar style AND whether it can be resized - a real WinForms enum, not a simple on/off.">Form Border Style</label><select>${fbsOpts.map(o => `<option ${o === state.form.formBorderStyle ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  fbsRow.querySelector('select').addEventListener('change', (e) => { state.form.formBorderStyle = e.target.value; render(); });
  fbsRow.querySelector('label').appendChild(buildOptionInfoButton('formBorderStyle', 'Form Border Style', fbsOpts));
  frag.appendChild(fbsRow);

  const startRow = document.createElement('div');
  startRow.className = 'prop-row';
  const opts = ['CenterScreen', 'Manual', 'CenterParent', 'WindowsDefaultLocation', 'WindowsDefaultBounds'];
  startRow.innerHTML = `<label title="Where the window appears on screen the first time it opens.">Start Position</label><select>${opts.map(o => `<option ${o === state.form.startPosition ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  startRow.querySelector('select').addEventListener('change', (e) => { state.form.startPosition = e.target.value; });
  startRow.querySelector('label').appendChild(buildOptionInfoButton('startPosition', 'Start Position', opts));
  frag.appendChild(startRow);

  return frag;
}

/* ---- Comment-based help builder (PowerShell-style .SYNOPSIS/.DESCRIPTION/etc.) ---- */

const HELP_PLACEHOLDERS = {
  synopsis: 'Displays a customer intake form with validation.',
  description: 'Collects customer name, email, and order details, validates required fields, then saves the record to CSV on submit.',
  paramName: 'CustomerId',
  paramText: 'The unique ID of the customer to pre-fill the form for, if editing an existing record.',
  example: 'Opens the form pre-filled for customer 4021.\nPS C:\\> .\\CustomerForm.ps1 -CustomerId 4021',
  author: 'Name',
  get filename() { return (state.form.text.replace(/[^a-zA-Z0-9]/g, '') || 'Form') + '.ps1'; },
  notes: 'Requires PowerShell 5.1+ and the .NET Windows Forms assembly.',
};

// Scans every control's events (buttons, menu items, the form itself) for
// a wired-up "Or .ps1 file" and returns each unique one in the exact
// dot-source notation the generated code actually uses, so .NOTES stays
// truthful about what the script calls out to. We can't see INSIDE those
// files (if a called script calls another script, that's invisible to us)
// so this only reports the direct, one-level call graph from this form.
function collectCalledScripts() {
  const found = new Set();

  function scanEvents(events) {
    if (!events) return;
    Object.values(events).forEach(data => {
      if (data && data.ps1 && data.ps1.trim()) found.add(data.ps1.trim());
    });
  }

  scanEvents(state.form.events);
  state.controls.forEach(c => {
    scanEvents(c.events);
    if (c.type === 'MenuStrip') {
      (c.props.menuItems || []).forEach(m => {
        (m.items || []).forEach(it => {
          // Menu items don't have a separate .ps1 field today (inline code
          // or autoAbout only), but this stays future-proof if that's added.
          if (it.ps1 && it.ps1.trim()) found.add(it.ps1.trim());
        });
      });
    }
  });

  return Array.from(found).sort();
}

function helpCheckboxTextRow(label, item, key, placeholder, multiline, tooltip) {
  const row = document.createElement('div');
  row.className = 'prop-row help-row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = item.enabled;
  const field = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) field.type = 'text';
  field.placeholder = placeholder;
  field.value = item[key] || '';
  field.addEventListener('change', () => { item[key] = field.value; });
  cb.addEventListener('change', () => { item.enabled = cb.checked; });

  const labelWrap = document.createElement('label');
  labelWrap.className = 'help-item-label';
  if (tooltip) labelWrap.title = tooltip;
  labelWrap.appendChild(cb);
  const span = document.createElement('span');
  span.textContent = label;
  labelWrap.appendChild(span);

  row.appendChild(labelWrap);
  row.appendChild(field);
  return row;
}

function buildHelpBlockEditor() {
  const h = state.form.help;
  const frag = document.createElement('div');

  frag.appendChild(buildUsageHintBlock(
    'This becomes a standard PowerShell comment-based help block at the top of every generated file - the same format Get-Help reads, and what MenuStrip\'s Help > About uses to build its message box. Only checked fields are included. Example .SYNOPSIS: "Displays a customer intake form with validation."'
  ));

  frag.appendChild(helpCheckboxTextRow('.SYNOPSIS', h.synopsis, 'text', HELP_PLACEHOLDERS.synopsis, true,
    'A one-line summary of what this script/form does. This is what Help > About shows if you haven\'t written custom code for it.'));
  frag.appendChild(helpCheckboxTextRow('.DESCRIPTION', h.description, 'text', HELP_PLACEHOLDERS.description, true,
    'A longer explanation of what the script does and why. Also included in the auto-generated Help > About message.'));

  const paramWrap = document.createElement('div');
  paramWrap.className = 'help-list';
  const paramTitle = document.createElement('div');
  paramTitle.className = 'items-hint';
  paramTitle.title = 'One entry per script parameter, e.g. if your .ps1 accepts -CustomerId, document it here.';
  paramTitle.textContent = '.PARAMETER entries';
  paramWrap.appendChild(paramTitle);
  h.parameters.forEach((p, idx) => paramWrap.appendChild(buildParamRow(p, idx)));
  const addParamBtn = document.createElement('button');
  addParamBtn.className = 'btn btn-ghost';
  addParamBtn.textContent = '+ Add parameter';
  addParamBtn.addEventListener('click', () => { h.parameters.push({ enabled: true, name: '', text: '' }); renderProps(); });
  paramWrap.appendChild(addParamBtn);
  frag.appendChild(paramWrap);

  const exWrap = document.createElement('div');
  exWrap.className = 'help-list';
  const exTitle = document.createElement('div');
  exTitle.className = 'items-hint';
  exTitle.textContent = '.EXAMPLE entries';
  exWrap.appendChild(exTitle);
  h.examples.forEach((ex, idx) => exWrap.appendChild(helpCheckboxTextRow('Example ' + (idx + 1), ex, 'text', HELP_PLACEHOLDERS.example, true)));
  const addExBtn = document.createElement('button');
  addExBtn.className = 'btn btn-ghost';
  addExBtn.textContent = '+ Add example';
  addExBtn.addEventListener('click', () => { h.examples.push({ enabled: true, text: '' }); renderProps(); });
  exWrap.appendChild(addExBtn);
  frag.appendChild(exWrap);

  const notesWrap = document.createElement('div');
  notesWrap.className = 'help-list';
  const notesHead = document.createElement('label');
  notesHead.className = 'help-item-label';
  const notesCb = document.createElement('input');
  notesCb.type = 'checkbox';
  notesCb.checked = h.notes.enabled;
  notesCb.addEventListener('change', () => { h.notes.enabled = notesCb.checked; });
  notesHead.appendChild(notesCb);
  const notesSpan = document.createElement('span');
  notesSpan.textContent = '.NOTES';
  notesHead.appendChild(notesSpan);
  notesWrap.appendChild(notesHead);

  const authorRow = document.createElement('div');
  authorRow.className = 'prop-row';
  authorRow.innerHTML = `<label>Author</label><input type="text" placeholder="${HELP_PLACEHOLDERS.author}" value="${escapeHtml(h.notes.author)}">`;
  authorRow.querySelector('input').addEventListener('change', (e) => { h.notes.author = e.target.value; });
  notesWrap.appendChild(authorRow);

  const fileRow = document.createElement('div');
  fileRow.className = 'prop-row';
  fileRow.innerHTML = `<label>Filename</label><input type="text" placeholder="${HELP_PLACEHOLDERS.filename}" value="${escapeHtml(h.notes.filename)}">`;
  fileRow.querySelector('input').addEventListener('change', (e) => { h.notes.filename = e.target.value; });
  notesWrap.appendChild(fileRow);

  const notesRow = document.createElement('div');
  notesRow.className = 'prop-row';
  notesRow.innerHTML = `<label title="Runtime requirements, e.g. PowerShell version or required assemblies. Any button/event wired to an external .ps1 file is automatically listed below this as a 'Calls:' line - you don't need to add those yourself.">Dependencies</label><textarea placeholder="${HELP_PLACEHOLDERS.notes}">${escapeHtml(h.notes.notes)}</textarea>`;
  notesRow.querySelector('textarea').addEventListener('change', (e) => { h.notes.notes = e.target.value; });
  notesWrap.appendChild(notesRow);

  frag.appendChild(notesWrap);

  return frag;
}

function buildParamRow(p, idx) {
  const wrap = document.createElement('div');
  wrap.className = 'param-row';
  const head = document.createElement('label');
  head.className = 'help-item-label';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = p.enabled;
  cb.addEventListener('change', () => { p.enabled = cb.checked; });
  head.appendChild(cb);
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = HELP_PLACEHOLDERS.paramName;
  nameInput.value = p.name;
  nameInput.className = 'param-name-input';
  nameInput.addEventListener('change', () => { p.name = nameInput.value; });
  head.appendChild(nameInput);
  const rmBtn = document.createElement('button');
  rmBtn.className = 'btn btn-ghost btn-danger';
  rmBtn.textContent = '\u00d7';
  rmBtn.title = 'Remove parameter';
  rmBtn.addEventListener('click', () => { state.form.help.parameters.splice(idx, 1); renderProps(); });
  head.appendChild(rmBtn);
  wrap.appendChild(head);

  const desc = document.createElement('textarea');
  desc.placeholder = HELP_PLACEHOLDERS.paramText;
  desc.value = p.text;
  desc.addEventListener('change', () => { p.text = desc.value; });
  wrap.appendChild(desc);

  return wrap;
}

function generateHelpBlockLines() {
  const h = state.form.help;
  const lines = [];
  if (h.synopsis.enabled) {
    lines.push('.SYNOPSIS');
    lines.push('    ' + (h.synopsis.text || HELP_PLACEHOLDERS.synopsis));
  }
  if (h.description.enabled) {
    lines.push('.DESCRIPTION');
    lines.push('    ' + (h.description.text || HELP_PLACEHOLDERS.description));
  }
  h.parameters.filter(p => p.enabled).forEach(p => {
    lines.push('.PARAMETER ' + (p.name || HELP_PLACEHOLDERS.paramName));
    lines.push('    ' + (p.text || HELP_PLACEHOLDERS.paramText));
  });
  h.examples.filter(ex => ex.enabled).forEach(ex => {
    lines.push('.EXAMPLE');
    (ex.text || HELP_PLACEHOLDERS.example).split('\n').forEach(l => lines.push('    ' + l));
  });
  if (h.notes.enabled) {
    lines.push('.NOTES');
    lines.push('    Author: ' + (h.notes.author || HELP_PLACEHOLDERS.author));
    lines.push('    Filename: ' + (h.notes.filename || HELP_PLACEHOLDERS.filename));
    const depText = h.notes.notes || HELP_PLACEHOLDERS.notes;
    if (depText) lines.push('    Dependencies: ' + depText);
    collectCalledScripts().forEach(ps1 => {
      lines.push(`    Calls: . "${ps1}"`);
    });
  }
  return lines;
}

function helpBlockAsPs1Comment() {
  const lines = generateHelpBlockLines();
  if (!lines.length) return '';
  return '<#\n' + lines.join('\n') + '\n#>\n\n';
}

function helpBlockAsHtmlComment() {
  const lines = generateHelpBlockLines();
  if (!lines.length) return '';
  return '<!--\n' + lines.join('\n') + '\n-->\n';
}
