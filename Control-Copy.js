/*
    Control-Copy.js
    Written by: Johnathon Largent
    Version 1.2

    Revision:

    1. Fixed incrementSuffix only bumping the FIRST character of a
    multi-letter suffix (OptionZ -> OptionAA correctly, but the next
    copy's OptionAA -> "OptionB" instead of "OptionAB" - silently
    collapsing back to a single letter, colliding with names already
    taken, and burning through the retry guard until it gave up on
    whatever letter it landed on, producing duplicates). Replaced with
    a proper base-26 "spreadsheet column" increment (incrementLetterSuffix:
    A -> B -> ... -> Z -> AA -> AB -> ... ). splitTrailingSuffix's letter
    pattern also widened to match a whole trailing run of uppercase
    letters, not just one.

    2. Copying an entire tab/page (performCopyTabPage) now renames its
    children to match the new page label the same way the page itself
    does, instead of falling back to a generic name - a starter
    template's SummaryTitle/SummaryLog become Summary2Title/Summary2Log
    when "Summary" is copied to "Summary2" (renamePageCopyChildren: any
    cloned child whose ORIGINAL name started with the exact old page
    label gets that prefix swapped for the new label; anything else
    keeps whatever nextSmartName already gave it).
*/

const CONTROL_COPY_VERSION = '1.2';

/* =========================================================================
   Shared naming helpers
   ========================================================================= */

// base+2, base+3, ... - the same numbering wizardGeneratePageId already
// uses for page ids, reused here for page/tab LABELS so a duplicated
// "Options" page reads "Options2" like the rest of the app, not "Options
// Copy".
function nextAvailableLabel(base, existingLabels) {
  if (!existingLabels.includes(base)) return base;
  let n = 2;
  while (existingLabels.includes(base + n)) n++;
  return base + n;
}

// Splits a trailing "counter" off a name/text: either a run of digits
// (CheckBox3 -> "CheckBox"+"3"), or a single trailing uppercase letter
// immediately preceded by a lowercase letter (OptionA -> "Option"+"A").
// The lowercase-then-uppercase requirement is deliberate - every built-in
// control type name (Button, CheckBox, GroupBox, ListView, ...) ends in
// two lowercase letters, so this never misfires on a freshly-created,
// not-yet-renamed control; it only catches an intentional single-letter
// tag like the Options template's OptionA/OptionB. An optional single
// space is allowed between base and letter so "Option B" parses the same
// way as "OptionB".
function splitTrailingSuffix(str) {
  if (!str) return null;
  let m = str.match(/^(.*?)(\d+)$/);
  if (m) return { base: m[1], sep: '', suffix: m[2], kind: 'digit' };
  m = str.match(/^(.*[a-z])( ?)([A-Z]+)$/);
  if (m) return { base: m[1], sep: m[2], suffix: m[3], kind: 'letter' };
  return null;
}

// Proper base-26 "spreadsheet column" increment for a run of uppercase
// letters (A -> B -> ... -> Z -> AA -> AB -> ... -> AZ -> BA -> ...).
// Only bumping the first character (Z -> AA, but then AA -> "B") was the
// earlier bug: it silently collapsed back to a single letter, which made
// every later candidate collide with something already taken and burned
// through the collision-retry guard, ending on whatever letter it
// happened to land on when the guard gave up (duplicate names).
function incrementLetterSuffix(s) {
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === 'Z') { arr[i] = 'A'; i--; }
    else { arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1); return arr.join(''); }
  }
  return 'A' + arr.join(''); // every position rolled over (Z -> AA, ZZ -> AAA, ...)
}

function incrementSuffix(parsed) {
  if (parsed.kind === 'digit') return String(parseInt(parsed.suffix, 10) + 1);
  return incrementLetterSuffix(parsed.suffix);
}

// Finds the next free NAME for a clone of sourceCtrl, continuing whatever
// counter its own name already ends in (skipping any that are already
// taken) rather than jumping straight to a generic type+counter name.
// Falls back to the normal nextName(type) when the source's name doesn't
// end in a recognizable counter at all.
function nextSmartName(sourceCtrl) {
  const parsed = splitTrailingSuffix(sourceCtrl.name);
  if (!parsed) return { name: nextName(sourceCtrl.type), suffixInfo: null };
  let suffix = parsed.suffix;
  let candidate;
  let guard = 0;
  do {
    suffix = incrementSuffix({ kind: parsed.kind, suffix });
    candidate = parsed.base + parsed.sep.replace(' ', '') + suffix;
    guard++;
  } while (state.controls.some(c => c.name === candidate) && guard < 1000);
  return { name: candidate, suffixInfo: { base: parsed.base, sep: parsed.sep, suffix, kind: parsed.kind } };
}

// Mirrors the NAME's newly-chosen suffix onto the clone's visible Text,
// but only when the Text ends in a counter of the SAME kind (both letter
// or both digit) - if they don't match, the Text's ending wasn't really
// an enumeration in the first place, so it's left alone rather than
// guessed at.
function applyMatchingTextSuffix(clonedCtrl, suffixInfo) {
  if (!suffixInfo) return;
  if (!clonedCtrl.props || typeof clonedCtrl.props.text !== 'string') return;
  const parsedText = splitTrailingSuffix(clonedCtrl.props.text);
  if (!parsedText || parsedText.kind !== suffixInfo.kind) return;
  clonedCtrl.props.text = parsedText.base + parsedText.sep + suffixInfo.suffix;
}

/* =========================================================================
   Deep-clone helpers
   ========================================================================= */

// Deep-clones a single control: fresh random id, a smart-incremented name
// (see nextSmartName above, falling back to nextName() for anything
// without a recognizable counter), and events come back all-null - same
// shape createControl gives a new control - rather than copying the
// original's wired-up code/ps1, since that almost certainly references
// the old control's name and would be silently wrong on the copy. If
// it's a TabControl or Wizard, its own tabs/pages get fresh ids too
// (returned as pageMap, old id -> new id) so the caller can remap each
// child's tabPage and - for a Wizard - each page's
// `requirements[].targetId` once the whole tree has been cloned.
function cloneControlDeep(oldCtrl, newParentId, newTabPage) {
  const def = CONTROL_DEFS[oldCtrl.type];
  const cloned = JSON.parse(JSON.stringify(oldCtrl));
  const { name, suffixInfo } = nextSmartName(oldCtrl);
  cloned.id = 'c' + Math.random().toString(36).slice(2, 10);
  cloned.name = name;
  cloned.parentId = newParentId;
  cloned.tabPage = newTabPage;
  cloned.events = {};
  def.events.forEach(evt => { cloned.events[evt] = null; });
  applyMatchingTextSuffix(cloned, suffixInfo);

  let pageMap = null;
  if (def.isTabControl) {
    pageMap = {};
    cloned.props.tabs = (cloned.props.tabs || []).map(t => {
      const newId = 'tab' + Math.random().toString(36).slice(2, 8);
      pageMap[t.id] = newId;
      return { ...t, id: newId };
    });
    cloned.activeTabId = pageMap[oldCtrl.activeTabId] || (cloned.props.tabs[0] && cloned.props.tabs[0].id) || null;
  } else if (def.isWizard) {
    pageMap = {};
    const newIds = [];
    cloned.props.pages = (cloned.props.pages || []).map(p => {
      const newId = wizardGeneratePageId(p.label, newIds);
      newIds.push(newId);
      pageMap[p.id] = newId;
      return { ...p, id: newId, requirements: (p.requirements || []).map(r => ({ ...r })) };
    });
    cloned.activeTabId = pageMap[oldCtrl.activeTabId] || (cloned.props.pages[0] && cloned.props.pages[0].id) || null;
  }

  return { ctrl: cloned, pageMap };
}

// Clones every direct child of oldParentId (any tabPage) into newParentId,
// recursively - used both for "copy this whole container" (root already
// cloned by the caller) and for "copy just this one tab/page's content"
// (a single tab/page's children, cloned by performCopyTabPage below).
// pageMap remaps a cloned TabControl/Wizard child's own tabPage
// assignments for ITS children in the next recursion step; plain
// containers pass null, which correctly forces their grandchildren's
// tabPage to null too (only a direct TabControl/Wizard child ever has a
// real tabPage).
function cloneChildrenDeep(oldParentId, newParentId, pageMap) {
  const idMap = {};
  const newControls = [];
  state.controls.filter(c => c.parentId === oldParentId).forEach(child => {
    const childNewTabPage = (child.tabPage != null && pageMap) ? (pageMap[child.tabPage] || null) : null;
    const result = cloneControlDeep(child, newParentId, childNewTabPage);
    idMap[child.id] = result.ctrl.id;
    newControls.push(result.ctrl);
    const nested = cloneChildrenDeep(child.id, result.ctrl.id, result.pageMap);
    newControls.push(...nested.newControls);
    Object.assign(idMap, nested.idMap);
  });
  return { newControls, idMap };
}

// Remaps requirements[].targetId on any cloned Wizard now that the full
// old-id -> new-id map for its cloned subtree is known.
function remapWizardRequirements(newControls, idMap) {
  newControls.forEach(c => {
    if (CONTROL_DEFS[c.type].isWizard) {
      (c.props.pages || []).forEach(p => {
        (p.requirements || []).forEach(r => {
          if (r.targetId && idMap[r.targetId]) r.targetId = idMap[r.targetId];
        });
      });
    }
  });
}

// Clones sourceCtrl plus every descendant (found purely by parentId, so
// this also picks up a Wizard's footer buttons, which live on the wizard
// itself with tabPage=null alongside its per-page children). Returns the
// new controls (root first, then children) and the full old-id -> new-id
// map.
function deepCopyControlTree(sourceCtrl, newParentId, newTabPage) {
  const rootResult = cloneControlDeep(sourceCtrl, newParentId, newTabPage);
  const idMap = { [sourceCtrl.id]: rootResult.ctrl.id };
  const newControls = [rootResult.ctrl];

  const nested = cloneChildrenDeep(sourceCtrl.id, rootResult.ctrl.id, rootResult.pageMap);
  newControls.push(...nested.newControls);
  Object.assign(idMap, nested.idMap);

  remapWizardRequirements(newControls, idMap);
  return { newControls, idMap };
}

/* =========================================================================
   Placement (non-docked controls)
   ========================================================================= */

// Where a freshly-copied (non-docked) control lands: siblings in the same
// container (form root, Panel, a TabControl/Wizard page - whichever
// containerClientRect resolves) are grouped into "columns" by shared x;
// the copy's Y is a real 5px gap below the bottom edge of the bottommost
// control in the right-most column - matching the app's own template
// spacing (e.g. the Options template's OptionA/OptionB, both 25px tall,
// 30px apart top-to-top: 25 + 5). Using the actual bottom edge (rather
// than a fixed top-to-top increment) means this scales correctly for any
// control height, not just the ones that happen to already sit on the
// 5px grid. Only once that no longer fits in the container's usable area
// (already excludes a Wizard's Contents nav strip / a docked status bar
// via containerClientRect, plus the Wizard footer strip which
// containerClientRect does NOT account for - see footerReserve below)
// does it wrap to a new column: 25px right of the widest control in that
// column, back up at the y of the container's topmost non-Label control
// (its "header row"), so repeated columns start in a lined-up row
// instead of drifting down.
function calcCopyPosition(sourceCtrl) {
  const parentId = sourceCtrl.parentId || null;
  const tabPage = sourceCtrl.tabPage || null;
  const rect = containerClientRect(parentId, tabPage);

  const parentCtrl = parentId ? getControl(parentId) : null;
  const footerReserve = (parentCtrl && CONTROL_DEFS[parentCtrl.type].isWizard && tabPage) ? WIZARD_FOOTER_HEIGHT : 0;
  const usableBottom = rect.y + rect.h - footerReserve;

  const allSiblings = state.controls.filter(c =>
    (c.parentId || null) === parentId &&
    (c.tabPage || null) === tabPage &&
    !(c.props.dock && c.props.dock !== 'None') &&
    !c.wizardFooter
  );

  if (!allSiblings.length) return { x: rect.x, y: rect.y };

  // A page title Label is usually much wider than the real content below
  // it and often shares the same x - left in, it would win every "widest
  // control in this column" check and blow the column spacing out to the
  // title's width. Labels are excluded from the flow math entirely (not
  // just the row-reset reference below), falling back to including them
  // only if there's nothing else yet to measure against.
  const noLabels = allSiblings.filter(c => c.type !== 'Label');
  const siblings = noLabels.length ? noLabels : allSiblings;

  const columns = {};
  siblings.forEach(c => {
    const col = columns[c.x] || (columns[c.x] = { x: c.x, bottom: -Infinity, right: -Infinity });
    col.bottom = Math.max(col.bottom, c.y + c.h);
    col.right = Math.max(col.right, c.x + c.w);
  });
  const rightmost = Object.values(columns).reduce((a, b) => (b.x > a.x ? b : a));

  const proposedY = snap(rightmost.bottom + 5);
  if (proposedY + sourceCtrl.h <= usableBottom) {
    return { x: rightmost.x, y: proposedY };
  }

  const topRefY = Math.min(...siblings.map(c => c.y));
  return { x: snap(rightmost.right + 25), y: snap(topRefY) };
}

/* =========================================================================
   Scoped picker (reuses the Objects modal's look/DOM, different content)
   ========================================================================= */

// Repurposes the existing Objects modal shell (#objectsModalOverlay /
// #objectsList) to show a short, flat, custom list instead of the normal
// full control tree - used to offer "whole thing" vs one specific
// tab/page when a TabControl/Wizard is what's selected. The normal
// Objects modal (initObjectsModal in Engine.js) resets the title and
// rebuilds its own list again the next time it's opened, so this never
// leaves stray state behind.
function showObjectsStylePicker(scopeName, items, onPick) {
  const overlay = document.getElementById('objectsModalOverlay');
  const titleEl = document.getElementById('objectsModalTitle');
  if (titleEl) titleEl.textContent = 'Copy from ' + scopeName;

  const container = document.getElementById('objectsList');
  container.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'objects-row';
    row.style.paddingLeft = '10px';
    row.innerHTML = `<span class="objects-row-name">${escapeHtml(item.label)}</span>`;
    row.title = 'Click to copy this.';
    row.addEventListener('click', () => {
      overlay.classList.remove('open');
      onPick(item.id);
    });
    container.appendChild(row);
  });

  overlay.classList.add('open');
}

/* =========================================================================
   Copy actions
   ========================================================================= */

// Plain control copy (leaf or container, but NOT the "select a TabControl/
// Wizard" case - see startCopySelected/performCopyTabPage for that). A
// whole state mutation (push every cloned control, however many) followed
// by exactly one render() call, so the entire copy - root plus every
// descendant - lands as a single undo/redo step, never one step per
// cloned control.
function performCopy(sourceCtrl) {
  const { newControls } = deepCopyControlTree(sourceCtrl, sourceCtrl.parentId, sourceCtrl.tabPage);
  const rootClone = newControls[0];

  // A second Fill-docked control doesn't do anything useful - Fill always
  // claims whatever space is left regardless of order, so two of them just
  // sit exactly on top of each other. Reset to None so the copy actually
  // lands somewhere editable instead.
  if (rootClone.props.dock === 'Fill') rootClone.props.dock = 'None';
  const isDocked = !!(rootClone.props.dock && rootClone.props.dock !== 'None');

  if (isDocked) {
    // x/y/w/h for a docked control are fully recomputed by
    // recomputeAllDocking() on the next render() - just take a spot at
    // the end of its dock group's order.
    rootClone.dockOrder = ++state.dockOrderSeq;
  } else {
    const pos = calcCopyPosition(sourceCtrl);
    rootClone.x = pos.x;
    rootClone.y = pos.y;
  }

  state.controls.push(...newControls);
  render();
}

// Copies ONE tab (TabControl) or page (Wizard), inserting it immediately
// after activePageId in the tabs/pages array (bumping everything after it
// down one slot); its own content is deep-cloned into the new tab/page
// id; a Wizard's per-page requirements are remapped the same way a
// whole-Wizard copy remaps them. The container's activeTabId is left
// pointing at the ORIGINAL tab/page (selection doesn't move to the copy),
// matching the same "don't change what's selected" rule as a regular
// control copy. The new label follows the app's existing base+2,3,4...
// numbering (wizardGeneratePageId/nextAvailableLabel) instead of
// appending " Copy", so e.g. "Options" becomes "Options2" the same way it
// would from the Pages/Tabs editor's own Add button.
// A page/tab's starter children are usually named as "<page label><role>"
// (the Options template's OptionsTitle, SummaryTitle/SummaryLog, ...) -
// nextSmartName/cloneControlDeep has no way to know that "Summary" in
// "SummaryLog" is the PAGE's own name rather than an arbitrary counter,
// so it falls back to a generic name like "RichTextBox3". This walks the
// just-cloned subtree and, for any clone whose ORIGINAL name started
// with the exact old page label, swaps that prefix for the new page
// label instead (SummaryLog -> Summary2Log), leaving the rest of the
// name untouched. Anything that doesn't start with the old label keeps
// whatever nextSmartName already gave it.
function renamePageCopyChildren(oldLabel, newLabel, idMap, newControls) {
  if (!oldLabel) return;
  Object.entries(idMap).forEach(([oldId, newId]) => {
    const oldCtrl = getControl(oldId);
    if (!oldCtrl || !oldCtrl.name.startsWith(oldLabel)) return;
    const newCtrl = newControls.find(c => c.id === newId);
    if (!newCtrl) return;
    const base = newLabel + oldCtrl.name.slice(oldLabel.length);
    let candidate = base;
    let n = 2;
    const taken = (name) => name !== newCtrl.name && (
      state.controls.some(c => c.name === name) ||
      newControls.some(c => c !== newCtrl && c.name === name)
    );
    while (taken(candidate)) { candidate = base + n; n++; }
    newCtrl.name = candidate;
  });
}

function performCopyTabPage(containerCtrl, isWizard, activePageId) {
  const listKey = isWizard ? 'pages' : 'tabs';
  const list = containerCtrl.props[listKey] || [];
  const srcIndex = list.findIndex(p => p.id === activePageId);
  if (srcIndex === -1) return;
  const srcEntry = list[srcIndex];

  const newId = isWizard
    ? wizardGeneratePageId(srcEntry.label, list.map(p => p.id))
    : ('tab' + Math.random().toString(36).slice(2, 8));
  const newLabel = nextAvailableLabel(srcEntry.label || '', list.map(p => p.label));

  const newEntry = { ...srcEntry, id: newId, label: newLabel };
  if (isWizard) newEntry.requirements = (srcEntry.requirements || []).map(r => ({ ...r }));

  const idMap = {};
  const newControls = [];
  state.controls
    .filter(c => c.parentId === containerCtrl.id && c.tabPage === activePageId && !c.wizardFooter)
    .forEach(child => {
      const result = cloneControlDeep(child, containerCtrl.id, newId);
      idMap[child.id] = result.ctrl.id;
      newControls.push(result.ctrl);
      const nested = cloneChildrenDeep(child.id, result.ctrl.id, result.pageMap);
      newControls.push(...nested.newControls);
      Object.assign(idMap, nested.idMap);
    });

  renamePageCopyChildren(srcEntry.label, newLabel, idMap, newControls);

  if (isWizard) {
    (newEntry.requirements || []).forEach(r => {
      if (r.targetId && idMap[r.targetId]) r.targetId = idMap[r.targetId];
    });
  }
  remapWizardRequirements(newControls, idMap);

  list.splice(srcIndex + 1, 0, newEntry);
  state.controls.push(...newControls);
  render();
}

// Selecting a TabControl or Wizard offers a choice, using the same list
// look as the Objects modal but scoped to just this control: copy the
// whole thing, or just one of its tabs/pages. Picking "whole thing" runs
// the normal deep-copy (performCopy); picking a specific tab/page runs
// performCopyTabPage for that one.
function openCopyContainerChoice(containerCtrl, isWizard) {
  const listKey = isWizard ? 'pages' : 'tabs';
  const list = containerCtrl.props[listKey] || [];
  const items = [{ id: null, label: containerCtrl.name + ' (whole thing)' }]
    .concat(list.map(p => ({ id: p.id, label: p.label })));
  showObjectsStylePicker(containerCtrl.name, items, (chosenId) => {
    if (chosenId === null) { performCopy(containerCtrl); return; }
    performCopyTabPage(containerCtrl, isWizard, chosenId);
  });
}

function copyForSelection(ctrl) {
  const def = CONTROL_DEFS[ctrl.type];
  if (def.isTabControl) { openCopyContainerChoice(ctrl, false); return; }
  if (def.isWizard) { openCopyContainerChoice(ctrl, true); return; }
  performCopy(ctrl);
}

// Copy button: copies whatever's selected. If nothing is (the Main Panel
// is "selected"), opens the same Select Control picker used elsewhere -
// picking a control both selects it AND copies it, so pressing Copy again
// right after just keeps duplicating that same control without asking
// again (selection is never moved to the new copy itself).
function startCopySelected() {
  const src = getControl(state.selectedId);
  if (src) { copyForSelection(src); return; }
  startControlPick((picked) => {
    selectControl(picked.id);
    copyForSelection(picked);
  });
}
