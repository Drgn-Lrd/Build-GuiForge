/*
    Wizard-Boolean-Builder.js
    Written by: Johnathon Largent
    Version 1.1

    Revision:

    1. New Field + Comparator + Value support: an already-required
    NumericUpDown/DateTimePicker/TextBox/MaskedTextBox/RichTextBox/
    ComboBox/ListBox item can now start a fresh comparison (its own value
    against a typed literal) instead of only reusing its pre-set
    Additional Requirements condition - e.g. "NumericUpDown1 -lt 3 OR
    NumericUpDown1 -gt 20" as two different comparisons on the same field
    within one boolean group. CheckBox/RadioButton (or anything without a
    comparable value) are unaffected - no comparator step, since they're
    already a complete condition on their own.

    2. Click flow: clicking such an item pushes an incomplete
    'fieldcompare' chip; a new Comparator palette (only shows the operators
    that make sense for that field's type - numbers/dates get the full
    -eq/-ne/-ge/-gt/-lt/-le set, text fields only -eq/-ne) sets the
    operator on it; the value is then typed directly into a small inline
    text box that lives ON that same chip. Field, comparator, and value
    are always one combined chip/token from the start - never three
    separate pieces that could be pulled apart via drag-reorder.

    3. wizardCustomExprValidity now also requires a 'fieldcompare' chip to
    have both a comparator and a non-empty value before the expression
    counts as complete (Apply stays disabled otherwise) - no format/range
    checking on the value itself, that's left to run as PowerShell would
    handle it. wizardCustomExprToPs emits the comparison with the value as
    a raw number, a [DateTime]::Parse(...) call, or a quoted string,
    matching the field's kind. wizardCustomExprToHumanText reads it as
    "Field is/is not/is more than/... value" for the friendly popup.
*/

const WIZARD_BOOLEAN_BUILDER_VERSION = '1.1';

// Per-type config for the Field + Comparator + Value feature: which
// already-required control types have a comparable value at all (a
// CheckBox/RadioButton doesn't - it's already a complete condition on its
// own, so it stays a plain 'item' chip with no comparator step), the raw
// PowerShell expression that reads that value BY CONTROL NAME (this runs
// inside the wizard's own Test/Update-NextEnabled functions, not that
// control's own event, so it can't use $ThisControl), and which
// comparators make sense for it - numbers and dates support the full set,
// text fields are limited to equal/not-equal since lexical greater/less
// on arbitrary typed text rarely means what it looks like.
const WIZARD_COMPARABLE_VALUE_TYPES = {
  NumericUpDown: { kind: 'number', expr: (name) => `$${name}.Value`, comparators: ['eq', 'ne', 'ge', 'gt', 'lt', 'le'] },
  DateTimePicker: { kind: 'date', expr: (name) => `$${name}.Value`, comparators: ['eq', 'ne', 'ge', 'gt', 'lt', 'le'] },
  TextBox: { kind: 'text', expr: (name) => `$${name}.Text`, comparators: ['eq', 'ne'] },
  MaskedTextBox: { kind: 'text', expr: (name) => `$${name}.Text`, comparators: ['eq', 'ne'] },
  RichTextBox: { kind: 'text', expr: (name) => `$${name}.Text`, comparators: ['eq', 'ne'] },
  ComboBox: { kind: 'text', expr: (name) => `$${name}.Text`, comparators: ['eq', 'ne'] },
  ListBox: { kind: 'text', expr: (name) => `$${name}.Text`, comparators: ['eq', 'ne'] },
};
const WIZARD_COMPARATOR_PS = { eq: '-eq', ne: '-ne', ge: '-ge', gt: '-gt', lt: '-lt', le: '-le' };
const WIZARD_COMPARATOR_LABEL = { eq: '-eq', ne: '-ne', ge: '-ge', gt: '-gt', lt: '-lt', le: '-le' };
const WIZARD_COMPARATOR_HUMAN = { eq: 'is', ne: 'is not', ge: 'is at least', gt: 'is more than', lt: 'is less than', le: 'is at most' };

/* =========================================================================
   Custom requirement-logic builder - grouped AND/OR/parentheses instead of
   the flat All/Any combine mode. A page's built expression
   (page.customExpr, an ordered token list) is independent of
   page.requirementsMode: it's only ACTIVE when the mode is 'custom', but
   it's kept around either way so switching back to All/Any and later back
   to Custom (or just reopening the builder) never loses what was built -
   only hitting Apply here ever writes it back onto the page.
   ========================================================================= */

let wizardCustomExprDraft = null; // { wizardCtrl, page, tokens } - null when closed
let wizardCustomExprDragIndex = null;

function getWizardCustomExprOverlay() {
  let overlay = document.getElementById('wizardCustomExprModalOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'wizardCustomExprModalOverlay';
  overlay.innerHTML = `
    <div class="modal" style="width:480px;">
      <div class="modal-header">
        <h2>Build Custom Requirement Logic</h2>
        <button class="btn icon-btn btn-ghost" id="wizardCustomExprClose">&times;</button>
      </div>
      <div class="modal-body">
        <div class="items-hint" style="margin-bottom:8px;">Click items and operators below to build a boolean expression, e.g. (A AND B AND NOT C) OR (J AND NOT B) OR C - click NOT right after an item and it folds "AND NOT" into a single chip for you. A number/date/text item instead prompts for a comparator, then a value right on the chip. Drag a chip by its handle to reorder; use the &times; on a chip to remove it.</div>
        <div class="wizard-custom-expr-chips" id="wizardCustomExprChips"></div>
        <div class="wizard-custom-expr-error" id="wizardCustomExprError"></div>
        <div class="wizard-custom-expr-palette-heading">Operators</div>
        <div class="wizard-custom-expr-palette" id="wizardCustomExprOpPalette"></div>
        <div class="wizard-custom-expr-palette-heading">Required Items</div>
        <div class="wizard-custom-expr-palette" id="wizardCustomExprItemPalette"></div>
        <div class="wizard-custom-expr-palette-heading">Comparator (for the item just added, if it has a value to compare)</div>
        <div class="wizard-custom-expr-palette" id="wizardCustomExprCmpPalette"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-danger" id="wizardCustomExprClear">Clear</button>
        <button class="btn" id="wizardCustomExprCancel">Cancel</button>
        <button class="btn btn-accent" id="wizardCustomExprApply">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWizardCustomExprModal(); });
  document.getElementById('wizardCustomExprClose').addEventListener('click', closeWizardCustomExprModal);
  document.getElementById('wizardCustomExprCancel').addEventListener('click', closeWizardCustomExprModal);
  document.getElementById('wizardCustomExprClear').addEventListener('click', () => {
    if (!wizardCustomExprDraft) return;
    wizardCustomExprDraft.tokens = [];
    renderWizardCustomExprModal();
  });
  document.getElementById('wizardCustomExprApply').addEventListener('click', () => {
    if (!wizardCustomExprDraft) return;
    const items = wizardRequirementItemsForPage(wizardCustomExprDraft.wizardCtrl, wizardCustomExprDraft.page);
    if (!wizardCustomExprValidity(wizardCustomExprDraft.tokens, items).valid) return;
    wizardCustomExprDraft.page.customExpr = wizardCustomExprDraft.tokens.map(t => ({ ...t }));
    wizardCustomExprDraft.page.requirementsMode = 'custom';
    closeWizardCustomExprModal();
    render();
  });

  return overlay;
}

function closeWizardCustomExprModal() {
  const overlay = document.getElementById('wizardCustomExprModalOverlay');
  if (overlay) overlay.classList.remove('open');
  // Discards any unapplied edits - only Apply above ever writes back onto
  // the page, so Cancel/backdrop-click/X safely revert to whatever was
  // last saved, exactly as if nothing had been touched this time around.
  wizardCustomExprDraft = null;
  wizardCustomExprDragIndex = null;
}

// Opens the builder for one page, pre-loaded from its last-saved
// page.customExpr (or empty, the first time) - reopening never wipes it.
function openWizardCustomExprModal(wizardCtrl, page) {
  const overlay = getWizardCustomExprOverlay();
  wizardCustomExprDraft = {
    wizardCtrl,
    page,
    tokens: (page.customExpr || []).map(t => ({ ...t })),
  };
  renderWizardCustomExprModal();
  overlay.classList.add('open');
}

function wizardCustomExprTokenLabel(token, items) {
  if (token.type === 'and') return 'AND';
  if (token.type === 'or') return 'OR';
  if (token.type === 'not' || token.type === 'andnot') return 'NOT';
  if (token.type === 'lparen') return '(';
  if (token.type === 'rparen') return ')';
  const item = items.find(it => it.key === token.key);
  return item ? item.label : '(removed control)';
}

function renderWizardCustomExprModal() {
  if (!wizardCustomExprDraft) return;
  const { wizardCtrl, page, tokens } = wizardCustomExprDraft;
  const items = wizardRequirementItemsForPage(wizardCtrl, page);

  const chipRow = document.getElementById('wizardCustomExprChips');
  chipRow.innerHTML = '';
  if (!tokens.length) {
    const empty = document.createElement('div');
    empty.className = 'wizard-custom-expr-empty';
    empty.textContent = 'Nothing built yet - use the buttons below.';
    chipRow.appendChild(empty);
  }
  tokens.forEach((token, i) => {
    const chip = document.createElement('div');
    chip.className = `wizard-expr-chip wizard-expr-chip-${token.type}`;
    chip.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'wizard-expr-chip-handle';
    handle.textContent = '\u22ee\u22ee';
    handle.title = 'Drag to reorder';
    chip.appendChild(handle);

    if (token.type === 'fieldcompare') {
      // One combined chip start to finish - a field reference, its
      // comparator, and its value never exist as separate draggable/
      // removable pieces, so they can't be pulled apart from each other.
      const item = items.find(it => it.key === token.key);
      const itemLabel = item ? item.label : '(removed control)';
      const label = document.createElement('span');
      label.className = 'wizard-expr-chip-label';
      label.textContent = token.comparator ? `${itemLabel} ${WIZARD_COMPARATOR_LABEL[token.comparator]}` : itemLabel;
      chip.appendChild(label);
      if (token.comparator) {
        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.className = 'wizard-expr-chip-value-input';
        valInput.value = token.value || '';
        valInput.placeholder = 'value';
        valInput.draggable = false;
        valInput.addEventListener('mousedown', (e) => e.stopPropagation());
        valInput.addEventListener('change', (e) => { token.value = e.target.value; renderWizardCustomExprModal(); });
        chip.appendChild(valInput);
      }
    } else {
      const label = document.createElement('span');
      label.className = 'wizard-expr-chip-label';
      label.textContent = wizardCustomExprTokenLabel(token, items);
      chip.appendChild(label);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'wizard-expr-chip-remove';
    removeBtn.textContent = '\u2715';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => { tokens.splice(i, 1); renderWizardCustomExprModal(); });
    chip.appendChild(removeBtn);

    chip.addEventListener('dragstart', () => { wizardCustomExprDragIndex = i; });
    chip.addEventListener('dragover', (e) => { e.preventDefault(); chip.classList.add('drag-over'); });
    chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
    chip.addEventListener('drop', (e) => {
      e.preventDefault();
      chip.classList.remove('drag-over');
      if (wizardCustomExprDragIndex === null || wizardCustomExprDragIndex === i) return;
      const [moved] = tokens.splice(wizardCustomExprDragIndex, 1);
      const insertAt = wizardCustomExprDragIndex < i ? i - 1 : i;
      tokens.splice(insertAt, 0, moved);
      wizardCustomExprDragIndex = null;
      renderWizardCustomExprModal();
    });

    chipRow.appendChild(chip);
  });

  const opPalette = document.getElementById('wizardCustomExprOpPalette');
  opPalette.innerHTML = '';
  [['lparen', '('], ['rparen', ')'], ['and', 'AND'], ['or', 'OR'], ['not', 'NOT']].forEach(([type, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost wizard-expr-palette-btn';
    btn.textContent = label;
    if (type === 'not') btn.title = 'Negates whatever comes right after it - a single "NOT" chip. Clicking this right after an item or ")" folds an implied AND into that same chip ("but not" in the friendly message); click OR yourself first if you specifically want "OR NOT" instead.';
    btn.addEventListener('click', () => {
      if (type === 'not') {
        // A bare NOT can't directly follow an item or ")" (see
        // wizardCustomExprValidity) - in practice that's almost always
        // "...AND NOT this one" anyway, so rather than a separate AND
        // chip plus a NOT chip, that case folds into ONE 'andnot' token:
        // still real AND-NOT underneath (wizardCustomExprToPs), just one
        // chip instead of two - and it can't come apart via drag-reorder
        // the way two separate chips could. "OR NOT" is still reachable
        // by clicking OR yourself first, then NOT (a plain standalone
        // 'not' token, since it's already in an operand-expected spot).
        const last = tokens[tokens.length - 1];
        const expectingOperand = !last || last.type === 'and' || last.type === 'or' || last.type === 'andnot' || last.type === 'lparen' || last.type === 'not';
        tokens.push({ type: expectingOperand ? 'not' : 'andnot' });
      } else {
        tokens.push({ type });
      }
      renderWizardCustomExprModal();
    });
    opPalette.appendChild(btn);
  });

  // One button per requirement currently marked required on this page
  // (toggle, detected, or manual) - the same set Test-<n>PageRequirements
  // already checks, just clickable here instead of typed. A control with
  // a comparable value (WIZARD_COMPARABLE_VALUE_TYPES) starts a NEW
  // Field+Comparator+Value chip instead of reusing its already-configured
  // requirement condition - lets the same field get compared differently
  // in different branches (e.g. "< 3 OR > 20") without touching the flat
  // Additional Requirements row. A CheckBox/RadioButton (or anything else
  // not in that map) has no separate value to compare - it's already a
  // complete condition on its own, so it stays the plain whole-boolean
  // 'item' chip exactly as before.
  const itemPalette = document.getElementById('wizardCustomExprItemPalette');
  itemPalette.innerHTML = '';
  if (!items.length) {
    const hint = document.createElement('div');
    hint.className = 'items-hint';
    hint.textContent = 'No requirements on this page yet - mark a control "Required before Next" first.';
    itemPalette.appendChild(hint);
  }
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost wizard-expr-palette-btn';
    btn.textContent = item.label;
    btn.title = item.ctrl.name;
    const cmpCfg = WIZARD_COMPARABLE_VALUE_TYPES[item.ctrl.type];
    btn.addEventListener('click', () => {
      tokens.push(cmpCfg ? { type: 'fieldcompare', key: item.key, comparator: null, value: '' } : { type: 'item', key: item.key });
      renderWizardCustomExprModal();
    });
    itemPalette.appendChild(btn);
  });

  // Only ever targets the LAST token, and only while it's a fieldcompare
  // chip still missing its comparator - matches the click-to-append flow
  // every other button here already uses (nothing to reorder into the
  // middle of an expression; drag-reorder handles repositioning after).
  const cmpPalette = document.getElementById('wizardCustomExprCmpPalette');
  cmpPalette.innerHTML = '';
  const lastToken = tokens[tokens.length - 1];
  const pendingItem = (lastToken && lastToken.type === 'fieldcompare' && !lastToken.comparator) ? items.find(it => it.key === lastToken.key) : null;
  const pendingCfg = pendingItem ? WIZARD_COMPARABLE_VALUE_TYPES[pendingItem.ctrl.type] : null;
  if (pendingCfg) {
    pendingCfg.comparators.forEach(op => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost wizard-expr-palette-btn';
      btn.textContent = WIZARD_COMPARATOR_LABEL[op];
      btn.title = `${pendingItem.label} ${WIZARD_COMPARATOR_HUMAN[op]} <value>`;
      btn.addEventListener('click', () => { lastToken.comparator = op; renderWizardCustomExprModal(); });
      cmpPalette.appendChild(btn);
    });
  } else {
    const hint = document.createElement('div');
    hint.className = 'items-hint';
    hint.textContent = 'Click a Required Item above with a comparable value (number, date, or text) first, then pick an operator here.';
    cmpPalette.appendChild(hint);
  }

  const errEl = document.getElementById('wizardCustomExprError');
  const validity = wizardCustomExprValidity(tokens, items);
  errEl.textContent = validity.message || '';
  errEl.style.display = validity.message ? 'block' : 'none';
  document.getElementById('wizardCustomExprApply').disabled = !validity.valid;
}

// Stack-based structural check: balanced parentheses, no two operands or
// two operators back to back, doesn't start/end on AND/OR/NOT, no empty
// parentheses. 'andnot' (the single-chip "AND NOT" fold - see the NOT
// button's click handler) sits in the operator family: it requires an
// operand before it and resolves back to expecting one after, exactly
// like AND/OR. A standalone 'not' is the prefix form instead - it
// consumes an "operand expected" slot without resolving it, so it can be
// chained before "(" or an item (e.g. after OR, for "OR NOT") but never
// right after an item or ")" directly (that combination becomes a single
// 'andnot' chip instead, not two adjacent tokens). A 'fieldcompare' chip
// occupies an operand slot exactly like a plain 'item' - it's also
// required to have both a comparator AND a non-empty value before it's
// considered complete (no format/range checking on the value itself - it
// runs as-is; a bad value is a PowerShell-runtime problem, not a builder
// one). A missing-item token (its control got deleted since the
// expression was built) isn't flagged here - wizardCustomExprToPs below
// substitutes $true for it rather than breaking codegen outright.
function wizardCustomExprValidity(tokens, items) {
  if (!tokens.length) return { valid: false, message: 'Add at least one item.' };
  let depth = 0;
  let expectOperand = true; // true: an item, "(", or "NOT" is valid next
  for (const t of tokens) {
    if (t.type === 'lparen') {
      if (!expectOperand) return { valid: false, message: 'A "(" can\'t follow an item or ")".' };
      depth++;
    } else if (t.type === 'rparen') {
      if (expectOperand) return { valid: false, message: 'A ")" can\'t follow an operator, "(", or "NOT".' };
      depth--;
      if (depth < 0) return { valid: false, message: 'Unmatched ")".' };
    } else if (t.type === 'and' || t.type === 'or' || t.type === 'andnot') {
      if (expectOperand) return { valid: false, message: 'AND/OR/NOT can\'t follow another operator, "(", or "NOT".' };
      expectOperand = true;
    } else if (t.type === 'not') {
      if (!expectOperand) return { valid: false, message: 'NOT needs an AND/OR before it - it can\'t follow an item or ")" directly.' };
      // NOT doesn't resolve the operand itself - still expecting one next.
    } else if (t.type === 'item' || t.type === 'fieldcompare') {
      if (!expectOperand) return { valid: false, message: 'Two items in a row need AND/OR between them.' };
      expectOperand = false;
      if (t.type === 'fieldcompare') {
        const item = (items || []).find(it => it.key === t.key);
        const label = item ? item.label : 'that item';
        if (!t.comparator) return { valid: false, message: `Finish the ${label} comparison - pick an operator below.` };
        if (t.value == null || String(t.value).trim() === '') return { valid: false, message: `Finish the ${label} comparison - enter a value.` };
      }
    }
  }
  if (depth !== 0) return { valid: false, message: 'Unmatched "(".' };
  if (expectOperand) return { valid: false, message: 'Expression can\'t end with an operator, "(", or "NOT".' };
  return { valid: true, message: '' };
}

// Converts a page's saved token list into a single PowerShell boolean
// expression, substituting each item token with its own requirement
// expression (parenthesized, so combining never depends on -and/-or
// precedence guesswork) - used by both Test-<n>PageRequirements and
// Update-<n>NextEnabled for a page in 'custom' combine mode. A
// 'fieldcompare' token builds its own parenthesized comparison instead of
// looking up a pre-set requirement expression - the value is emitted as a
// raw number for a number-kind field, wrapped in [DateTime]::Parse(...)
// for a date-kind field, or quoted as a string otherwise.
function wizardCustomExprToPs(tokens, items) {
  const byKey = {};
  items.forEach(it => { byKey[it.key] = it.expr; });
  return tokens.map(t => {
    if (t.type === 'item') return byKey[t.key] !== undefined ? `(${byKey[t.key]})` : '$true';
    if (t.type === 'fieldcompare') {
      const item = items.find(it => it.key === t.key);
      const cfg = item && WIZARD_COMPARABLE_VALUE_TYPES[item.ctrl.type];
      if (!item || !cfg || !t.comparator) return '$true';
      const fieldExpr = cfg.expr(item.ctrl.name);
      const psOp = WIZARD_COMPARATOR_PS[t.comparator];
      const valLiteral = cfg.kind === 'number' ? String(t.value)
        : cfg.kind === 'date' ? `[DateTime]::Parse("${wizardEscapePsText(t.value)}")`
        : `"${wizardEscapePsText(t.value)}"`;
      return `(${fieldExpr} ${psOp} ${valLiteral})`;
    }
    if (t.type === 'and') return '-and';
    if (t.type === 'or') return '-or';
    if (t.type === 'not') return '-not';
    if (t.type === 'andnot') return '-and -not';
    if (t.type === 'lparen') return '(';
    if (t.type === 'rparen') return ')';
    return '';
  }).join(' ');
}

// Renders a page's built token list as a plain-English restatement of the
// rule itself - "Option A and Option B or Option J" - for the "Show
// message" friendly text. Deliberately NOT a per-item unmet check: which
// specific items still need attention depends on which OR-branch the
// person is pursuing, so the fixed rule text is the only thing that's
// always accurate, however many other requirements the page also has.
// A 'fieldcompare' token reads as "Field is/is not/is more than/... value"
// (WIZARD_COMPARATOR_HUMAN) rather than the raw -gt/-lt PowerShell form.
function wizardCustomExprToHumanText(tokens, items) {
  const byKey = {};
  items.forEach(it => { byKey[it.key] = it.label; });
  return tokens.map(t => {
    if (t.type === 'item') return byKey[t.key] || '(removed control)';
    if (t.type === 'fieldcompare') {
      const label = byKey[t.key] || '(removed control)';
      return t.comparator ? `${label} ${WIZARD_COMPARATOR_HUMAN[t.comparator]} ${t.value}` : label;
    }
    if (t.type === 'and') return 'and';
    if (t.type === 'or') return 'or';
    if (t.type === 'not') return 'not';
    // The folded "AND NOT" chip reads as "but not" - clearer to an end
    // user than "and not" for a contrastive exclusion ("Option A but not
    // Option C"), while a standalone NOT (after OR, or opening a group)
    // stays a plain "not" - it isn't a contrast with what came before.
    if (t.type === 'andnot') return 'but not';
    if (t.type === 'lparen') return '(';
    if (t.type === 'rparen') return ')';
    return '';
  }).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
}
