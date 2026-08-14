# GUI Designer

A browser-based drag-and-drop GUI designer, in the spirit of PoshGUI, that
exports the form you build to **HTML**, **WinForms (PowerShell)**, **WPF
(XAML)**, or a **WinUI 3** scaffold.

## Running it

No build step. Either:
- Open `index.html` directly in a browser, or
- Push these three files to a GitHub repo and enable **GitHub Pages** on
  the branch/folder they live in.

`engine.js` and `styles.css` are shared and will be reused by any
additional HTML pages added later (e.g. a saved-projects list, a settings
page).

## Using the designer

- **Add a control**: drag an item from the left toolbox onto the form, or
  double-click a toolbox item to drop it at a default position.
- **Move**: drag a control on the canvas. Movement snaps to the grid
  (default 5px) unless snapping is turned off in the properties pane.
- **Resize**: select a control, drag any of the 8 handles.
- **Nudge precisely**: with a control selected, use the arrow-key d-pad in
  the properties pane (or your keyboard's arrow keys) with a 1px / 5px /
  10px step.
- **Containers**: drop controls onto a Panel or GroupBox to parent them —
  they'll move together with their container.
- **Interact toggle**: each control has an "interact" switch in its
  properties pane. Turn it on to pause the designer's select/drag
  behavior for that control so you can actually click into it (e.g. open
  a ComboBox's dropdown) to check it, then turn it off to keep editing.
- **Events**: expand the Events section for a selected control, pick an
  event, and either write inline code, insert one of the starter
  snippets, or point at a `.ps1` file to dot-source (for the WinForms
  export).
- **Show Code**: switch formats along the top or in the Show Code modal,
  then copy the generated source.

## Versioning convention

Every file carries a changelog header comment (most recent change only)
and a version constant used at runtime:

| File          | Version constant                     |
|---------------|---------------------------------------|
| `engine.js`   | `ENGINE_VERSION` (top of file)        |
| `styles.css`  | `--stylesheet-version` custom property|
| `index.html`  | `window.PAGE_VERSION`                 |

Format is `X.x` — the minor number (`x`) increments on every edit to that
file; the major number (`X`) only changes when explicitly instructed.
`1.1` and `1.10` are distinct versions, not decimals. Current versions are
visible in-app via the **i** (About) button in the toolbar.

## Current scope / roadmap

Implemented now:
- 16 controls: Button, Label, TextBox, CheckBox, RadioButton, ComboBox,
  ListBox, Panel, GroupBox, PictureBox, ProgressBar, TrackBar,
  NumericUpDown, DateTimePicker, RichTextBox, LinkLabel.
- Full property set per control (layout, behavior, appearance, and
  type-specific), event handlers with inline code or `.ps1` linkage.
- Full code generation for **HTML** and **WinForms (PowerShell)**.

Partial / scaffolded (by design, flagged in the Show Code modal):
- **WPF**: top-level controls and common properties generate to XAML;
  nested containers and full event/data-binding wiring are simplified.
- **WinUI 3**: page shell only, with a TODO list of placed controls for
  manual porting — control-to-markup mapping isn't implemented yet.

Not yet started (future direction the architecture supports):
- A true multi-language port so the same design model can drive a
  PowerShell-native version of this tool (not just PowerShell *output*).
- Deeper WPF/WinUI control mapping and style/theme export.
- Packaging as a Docker container for self-hosting alongside GitHub
  Pages.
