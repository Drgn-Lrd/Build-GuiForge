/*
    codegen.js
    Written by: Johnathon Largent
    Version 1.2

    Revision:

    1. Every generated event handler now starts with param($sender,
    $e) - gives event action code access to the real EventArgs (e.g.
    ItemCheck's $e.Index / $e.NewValue) via the standard PowerShell
    WinForms convention. Harmless on handlers that don't reference $e.
*/

const CODEGEN_VERSION = '1.2';

/* =========================================================================
   Code generation
   ========================================================================= */

function orderedControls() {
  // parents before children, stable by z
  const byParent = {};
  state.controls.forEach(c => { (byParent[c.parentId || ''] = byParent[c.parentId || ''] || []).push(c); });
  const out = [];
  (function walk(parentId) {
    (byParent[parentId || ''] || []).sort((a, b) => a.z - b.z).forEach(c => { out.push(c); walk(c.id); });
  })(null);
  return out;
}

function cssColor(hex) { return hex; }

function menuAboutMessage() {
  const h = state.form.help;
  const parts = [];
  if (h.synopsis && h.synopsis.enabled && h.synopsis.text) parts.push(h.synopsis.text);
  if (h.description && h.description.enabled && h.description.text) parts.push(h.description.text);
  return parts.join('\n\n') || (state.form.text + ' - no description provided.');
}

// Returns the code that should run when a menu item is clicked, in the
// requested target language. autoAbout items ignore their stored `code`
// and are generated fresh each time from the Comment-Based Help block,
// unless the user has typed their own code (which clears autoAbout).
function menuItemCodeFor(it, format) {
  if (it.autoAbout) {
    const msg = menuAboutMessage();
    if (format === 'html') return `alert(${JSON.stringify(msg)});`;
    return `[System.Windows.Forms.MessageBox]::Show("${msg.replace(/"/g, '""').replace(/\r?\n/g, '\`n')}", "About ${state.form.text.replace(/"/g, '""')}")`;
  }
  return it.code || '';
}

function menuStripHtml(c, styleBase, functionsOut) {
  const menus = (c.props.menuItems || []).filter(m => m.enabled);
  const li = (m) => {
    const items = (m.items || []).filter(it => it.enabled);
    const subUl = items.length
      ? `<ul>${items.map(it => {
        if (it.label === '-') return `<li class="menu-sep"></li>`;
        const code = menuItemCodeFor(it, 'html');
        if (code && code.trim()) {
          const fnName = `${c.name}_${m.id}_${it.id}`;
          functionsOut.push(`function ${fnName}(event) {\n  ${code.split('\n').join('\n  ')}\n}`);
          return `<li onclick="${fnName}(event)">${escapeHtml(it.label)}</li>`;
        }
        return `<li>${escapeHtml(it.label)}</li>`;
      }).join('')}</ul>`
      : '';
    return `<li>${escapeHtml(m.label)}${subUl}</li>`;
  };
  return `<nav id="${c.name}" class="menu-strip" style="${styleBase}"><ul>${menus.map(li).join('')}</ul></nav>`;
}

function generateHTML() {
  const f = state.form;
  const ctrls = orderedControls();
  const functions = [];
  const tabControlCss = [];

  const domFor = (c) => {
    const p = c.props;
    const styleBase = `position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;z-index:${c.z};` +
      (p.visible === false ? 'display:none;' : '') +
      `font-family:${p.fontFamily};font-size:${p.fontSize}px;font-weight:${p.fontBold ? '700' : '400'};font-style:${p.fontItalic ? 'italic' : 'normal'};`;
    const evtAttr = (evtName, domEvt) => {
      const e = c.events[evtName];
      return e ? ` on${domEvt}="${e.fn}(event)"` : '';
    };

    switch (c.type) {
      case 'Button': {
        const clickFns = [];
        if (c.events.Click) clickFns.push(`${c.events.Click.fn}(event)`);
        if (c.events.ClickToClose) clickFns.push(`${c.events.ClickToClose.fn}(event)`);
        const onclickAttr = clickFns.length ? ` onclick="${clickFns.join('; ')}"` : '';
        return `<button id="${c.name}" style="${styleBase}background:${p.backColor};color:${p.foreColor};"${onclickAttr} ${!p.enabled ? 'disabled' : ''}>${escapeHtml(p.text)}</button>`;
      }
      case 'Label':
        return `<label id="${c.name}" style="${styleBase}color:${p.foreColor};text-align:${p.textAlign.toLowerCase()};"${evtAttr('Click', 'click')}>${escapeHtml(p.text)}</label>`;
      case 'TextBox':
        return `<input id="${c.name}" type="${p.passwordChar ? 'password' : 'text'}" value="${escapeHtml(p.text)}" maxlength="${p.maxLength || ''}" ${p.readOnly ? 'readonly' : ''} style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('TextChanged', 'input')}${evtAttr('Enter', 'focus')}${evtAttr('Leave', 'blur')}${evtAttr('KeyDown', 'keydown')}>`;
      case 'CheckBox':
        return `<label style="${styleBase}color:${p.foreColor};"><input id="${c.name}" type="checkbox" ${p.checked ? 'checked' : ''}${evtAttr('CheckedChanged', 'change')}${evtAttr('Click', 'click')}> ${escapeHtml(p.text)}</label>`;
      case 'RadioButton':
        return `<label style="${styleBase}color:${p.foreColor};"><input id="${c.name}" type="radio" name="${p.groupName}" ${p.checked ? 'checked' : ''}${evtAttr('CheckedChanged', 'change')}${evtAttr('Click', 'click')}> ${escapeHtml(p.text)}</label>`;
      case 'ComboBox': {
        const items = (p.items || '').split('\n').filter(Boolean);
        return `<select id="${c.name}" style="${styleBase}"${evtAttr('SelectedIndexChanged', 'change')}>${items.map((it, i) => `<option ${i === p.selectedIndex ? 'selected' : ''}>${escapeHtml(it)}</option>`).join('')}</select>`;
      }
      case 'ListBox': {
        const items = (p.items || '').split('\n').filter(Boolean);
        return `<select id="${c.name}" style="${styleBase}" ${p.selectionMode.startsWith('Multi') ? 'multiple' : ''}${evtAttr('SelectedIndexChanged', 'change')}>${items.map(it => `<option>${escapeHtml(it)}</option>`).join('')}</select>`;
      }
      case 'CheckedListBox': {
        const items = (p.items || '').split('\n').filter(Boolean);
        const checked = p.checkedIndices || [];
        return `<div id="${c.name}" style="${styleBase}background:#fff;border:1px solid #7d8390;overflow-y:auto;">${items.map((it, i) => `<label style="display:block;padding:2px 4px;"><input type="checkbox" ${checked.includes(i) ? 'checked' : ''}${evtAttr('ItemCheck', 'change')}> ${escapeHtml(it)}</label>`).join('')}</div>`;
      }
      case 'Panel':
        return `<div id="${c.name}" style="${styleBase}background:${p.backColor};border:1px solid #33475e;"${evtAttr('Click', 'click')}>\n${childrenHtml(c)}</div>`;
      case 'FlowLayoutPanel': {
        const flexDir = { LeftToRight: 'row', TopDown: 'column', RightToLeft: 'row-reverse', BottomUp: 'column-reverse' }[p.flowDirection] || 'row';
        return `<div id="${c.name}" style="${styleBase}background:${p.backColor};border:1px dashed #33475e;display:flex;flex-direction:${flexDir};flex-wrap:${p.wrapContents ? 'wrap' : 'nowrap'};align-content:flex-start;"${evtAttr('Click', 'click')}>\n${childrenHtml(c)}</div>`;
      }
      case 'TableLayoutPanel':
        return `<div id="${c.name}" style="${styleBase}background:${p.backColor};border:1px solid #33475e;display:grid;grid-template-columns:repeat(${p.columnCount},1fr);grid-template-rows:repeat(${p.rowCount},1fr);"${evtAttr('Click', 'click')}>\n${childrenHtml(c)}</div>`;
      case 'GroupBox':
        return `<fieldset id="${c.name}" style="${styleBase}background:${p.backColor};"><legend>${escapeHtml(p.text)}</legend>\n${childrenHtml(c)}</fieldset>`;
      case 'MaskedTextBox':
        return `<input id="${c.name}" type="text" placeholder="${escapeHtml(p.mask)}" value="${escapeHtml(p.text)}" style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('TextChanged', 'input')}>`;
      case 'StatusStrip':
        return `<div id="${c.name}" style="${styleBase}background:#F0F0F0;border-top:1px solid #ACA899;display:flex;align-items:center;padding:0 6px;font-size:12px;">${escapeHtml(p.text)}</div>`;
      case 'ToolStrip': {
        const items = (p.items || '').split('\n').filter(Boolean);
        return `<div id="${c.name}" class="tool-strip" style="${styleBase}">${items.map(it => `<button type="button">${escapeHtml(it)}</button>`).join('')}</div>`;
      }
      case 'PictureBox':
        return `<img id="${c.name}" src="${escapeHtml(p.imageSource)}" style="${styleBase}object-fit:${p.sizeMode === 'StretchImage' ? 'fill' : 'contain'};"${evtAttr('Click', 'click')}>`;
      case 'ProgressBar':
        return `<progress id="${c.name}" min="${p.min}" max="${p.max}" value="${p.value}" style="${styleBase}"></progress>`;
      case 'TrackBar':
        return `<input id="${c.name}" type="range" min="${p.min}" max="${p.max}" value="${p.value}" style="${styleBase}"${evtAttr('ValueChanged', 'change')}>`;
      case 'NumericUpDown':
        return `<input id="${c.name}" type="number" min="${p.min}" max="${p.max}" step="${p.increment}" value="${p.value}" style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('ValueChanged', 'change')}>`;
      case 'DateTimePicker':
        return `<input id="${c.name}" type="date" value="${escapeHtml(p.value)}" style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('ValueChanged', 'change')}>`;
      case 'RichTextBox':
        return `<textarea id="${c.name}" style="${styleBase}background:${p.backColor};color:${p.foreColor};"${evtAttr('TextChanged', 'input')}>${escapeHtml(p.text)}</textarea>`;
      case 'LinkLabel':
        return `<a id="${c.name}" href="${escapeHtml(p.url)}" style="${styleBase}color:${p.foreColor};"${evtAttr('LinkClicked', 'click')}>${escapeHtml(p.text)}</a>`;
      case 'MenuStrip':
        return menuStripHtml(c, styleBase, functions);
      case 'TabControl': {
        const tabs = p.tabs || [];
        const radios = tabs.map((tab, i) => `<input type="radio" name="${c.name}_tabs" id="${c.name}_${tab.id}" class="tabcontrol-radio"${i === 0 ? ' checked' : ''}>`).join('');
        const headers = tabs.map(tab => `<label for="${c.name}_${tab.id}" class="tabcontrol-tab">${escapeHtml(tab.label)}</label>`).join('');
        const pages = tabs.map(tab => `<div class="tabcontrol-page" id="${c.name}_page_${tab.id}">\n${childrenHtmlForTab(c, tab.id)}\n</div>`).join('\n');
        tabs.forEach(tab => {
          tabControlCss.push(`#${c.name}_${tab.id}:checked ~ .tabcontrol-body #${c.name}_page_${tab.id} { display: block; }`);
        });
        return `<div id="${c.name}" class="tabcontrol" style="${styleBase}">${radios}<div class="tabcontrol-header">${headers}</div><div class="tabcontrol-body">${pages}</div></div>`;
      }
      default:
        return '';
    }
  };

  const childrenHtml = (parent) => ctrls.filter(c => c.parentId === parent.id).map(domFor).join('\n');
  const childrenHtmlForTab = (parent, tabId) => ctrls.filter(c => c.parentId === parent.id && c.tabPage === tabId).map(domFor).join('\n');
  const topLevelHtml = ctrls.filter(c => !c.parentId).map(domFor).join('\n  ');

  ctrls.forEach(c => Object.entries(c.events).forEach(([evtName, data]) => {
    if (data && data.code) functions.push(`function ${data.fn}(event) {\n  ${data.code.split('\n').join('\n  ')}\n}`);
  }));

  return `${helpBlockAsHtmlComment()}<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(f.text)}</title>
<style>
  body { margin: 0; font-family: Segoe UI, sans-serif; }
  #${'form_root'} { position: relative; width: ${f.width}px; height: ${f.height}px; background: ${f.backColor}; overflow: hidden; }
  .menu-strip { background: #F0F0F0; border-bottom: 1px solid #ACA899; }
  .menu-strip > ul { list-style: none; margin: 0; padding: 0; display: flex; height: 100%; }
  .menu-strip > ul > li { position: relative; padding: 0 10px; display: flex; align-items: center; font-size: 12px; cursor: default; }
  .menu-strip > ul > li:hover { background: #C1D2EE; }
  .menu-strip li > ul { display: none; position: absolute; top: 100%; left: 0; list-style: none; margin: 0; padding: 4px 0; background: #FFFFFF; border: 1px solid #ACA899; min-width: 140px; z-index: 50; }
  .menu-strip li:hover > ul { display: block; }
  .menu-strip li > ul li { padding: 4px 18px; font-size: 12px; white-space: nowrap; }
  .menu-strip li > ul li:hover { background: #C1D2EE; }
  .menu-strip li > ul li.menu-sep { height: 1px; margin: 4px 0; padding: 0; background: #ddd; }
  .tabcontrol-radio { position: absolute; opacity: 0; pointer-events: none; }
  .tabcontrol-header { display: flex; background: #ECECEC; border-bottom: 1px solid #ACA899; }
  .tabcontrol-tab { padding: 6px 14px; font-size: 12px; cursor: pointer; border-right: 1px solid #ACA899; user-select: none; }
  .tabcontrol-page { display: none; position: relative; }
  .tool-strip { display: flex; align-items: center; gap: 4px; background: #F0F0F0; border-bottom: 1px solid #ACA899; padding: 0 4px; }
  .tool-strip button { border: 1px solid transparent; background: transparent; padding: 4px 8px; font-size: 12px; cursor: pointer; border-radius: 2px; }
  .tool-strip button:hover { border-color: #ACA899; background: #E0E0E0; }
${tabControlCss.map(r => '  ' + r).join('\n')}
</style>
</head>
<body>
<div id="form_root">
  ${topLevelHtml}
</div>
<script>
${functions.join('\n\n')}
${state.form.events.Load && state.form.events.Load.code ? `window.addEventListener('DOMContentLoaded', function(){ ${state.form.events.Load.code} });` : ''}
</script>
</body>
</html>`;
}

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

  const tabPageVarFor = {}; // `${tabControlId}::${tabId}` -> generated $variable name

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
        const items = (p.items || '').split('\n').filter(Boolean);
        items.forEach((it, i) => {
          lines.push(`$${c.name}_Btn${i} = New-Object System.Windows.Forms.ToolStripButton`);
          lines.push(`$${c.name}_Btn${i}.Text = "${it.replace(/"/g, '""')}"`);
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
    }

    // events
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

    // Route into the right container: a TabPage for TabControl children,
    // the parent control for other nested children, or the Form.
    let addTarget = 'Form';
    if (c.parentId) {
      const parentCtrl = getControl(c.parentId);
      if (parentCtrl && parentCtrl.type === 'TabControl' && c.tabPage) {
        addTarget = tabPageVarFor[`${parentCtrl.id}::${c.tabPage}`] || parentCtrl.name;
      } else if (parentCtrl) {
        addTarget = parentCtrl.name;
      }
    }
    lines.push(`$${addTarget}.Controls.Add($${c.name})`);
    if (c.type === 'MenuStrip') lines.push(`$Form.MainMenuStrip = $${c.name}`);
    lines.push('');
  });

  lines.push(`[void]$Form.ShowDialog()`);

  return helpBlockAsPs1Comment() + lines.join('\n');
}

function xamlColorAttr(hex) { return hex; }

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

function winuiMenuXaml(c) {
  const menus = (c.props.menuItems || []).filter(m => m.enabled);
  const menuItem = (m) => {
    const items = (m.items || []).filter(it => it.enabled);
    const children = items.length
      ? `\n      ${items.map(it => it.label === '-' ? `<MenuFlyoutSeparator />` : `<MenuFlyoutItem Text="${escapeHtml(it.label)}" />`).join('\n      ')}\n    `
      : '';
    return `<MenuBarItem Title="${escapeHtml(m.label)}">${children}</MenuBarItem>`;
  };
  return `<MenuBar x:Name="${c.name}">\n    ${menus.map(menuItem).join('\n    ')}\n  </MenuBar>`;
}

function winuiTabXaml(c) {
  const tabs = c.props.tabs || [];
  const items = tabs.map(tab => `<TabViewItem Header="${escapeHtml(tab.label)}" IsCloseable="False" />`).join('\n      ');
  return `<TabView x:Name="${c.name}">\n      ${items}\n    </TabView>`;
}

function generateWinUI() {
  const f = state.form;
  const header = helpBlockAsHtmlComment() + `<!-- WinUI export is a roadmap item: control -> markup mapping, Fluent
     styling, and event wiring are not implemented yet, except MenuStrip
     (maps to a real MenuBar/MenuBarItem/MenuFlyoutItem tree) and
     TabControl (maps to a real TabView/TabViewItem tree) below.
     Everything else is a page shell with a TODO list for manual porting. -->
`;
  const menuControls = state.controls.filter(c => c.type === 'MenuStrip');
  const tabControls = state.controls.filter(c => c.type === 'TabControl');
  const otherControls = state.controls.filter(c => c.type !== 'MenuStrip' && c.type !== 'TabControl');
  const menuXaml = menuControls.map(winuiMenuXaml).join('\n  ');
  const tabXaml = tabControls.map(winuiTabXaml).join('\n  ');
  const todoList = otherControls.map(c => `    <!-- TODO: port ${c.name} (${c.type}) at ${c.x},${c.y} ${c.w}x${c.h} -->`).join('\n');
  const xaml = `<Page
    x:Class="App.${(f.text || 'MainPage').replace(/[^a-zA-Z0-9]/g, '')}"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <StackPanel Background="${f.backColor}" Width="${f.width}" Height="${f.height}">
    ${menuXaml}
    ${tabXaml}
    <Grid>
${todoList}
    </Grid>
  </StackPanel>
</Page>`;
  return header + xaml;
}

const GENERATORS = { html: generateHTML, winforms: generateWinForms, wpf: generateWPF, winui: generateWinUI };
