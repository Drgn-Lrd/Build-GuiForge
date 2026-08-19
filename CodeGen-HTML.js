/*
    CodeGen-HTML.js
    Written by: Johnathon Largent
    Version 1.0

    Revision:

    1. Split out of codegen.js: menuStripHtml and generateHTML - the
    HTML/CSS/JS output generator. Depends on orderedControls/
    menuItemCodeFor (CodeGen.js) and escapeHtml/helpBlockAsHtmlComment
    (Engine.js/Properties-Pane.js) - load before CodeGen.js.
*/

const CODEGEN_HTML_VERSION = '1.0';

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
        const items = p.items || [];
        return `<div id="${c.name}" class="tool-strip" style="${styleBase}">${items.map(it => `<button type="button">${toolStripIconSvg(it.icon)}<span>${escapeHtml(it.label)}</span></button>`).join('')}</div>`;
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
  .tool-strip button { display: flex; flex-direction: column; align-items: center; gap: 1px; border: 1px solid transparent; background: transparent; padding: 3px 8px; font-size: 9.5px; cursor: pointer; border-radius: 2px; color: #333; }
  .tool-strip button:hover { border-color: #ACA899; background: #E0E0E0; }
  .tool-strip button svg { width: 14px; height: 14px; color: #555; }
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
