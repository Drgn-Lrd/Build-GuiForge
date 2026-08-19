/*
    CodeGen.js
    Written by: Johnathon Largent
    Version 1.5

    Revision:

    1. Merged codegen-shared.js back into this file - having a separate
    near-empty "shared helpers" file alongside the "registry" file was
    two small files where one does the job, working against the actual
    goal (making the giant per-format generators smaller and easier to
    navigate, not fragmenting the small stuff too). This file now holds
    both: orderedControls/menuAboutMessage/menuItemCodeFor (used by 2+
    generators) at the top, and the GENERATORS registry at the bottom.
    Load this file AFTER CodeGen-HTML.js/CodeGen-WinForms.js/
    CodeGen-WPF.js/CodeGen-WinUI.js - GENERATORS references their
    generateX() functions directly and needs them to already exist.
*/

const CODEGEN_VERSION = '1.5';

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

const GENERATORS = { html: generateHTML, winforms: generateWinForms, wpf: generateWPF, winui: generateWinUI };
