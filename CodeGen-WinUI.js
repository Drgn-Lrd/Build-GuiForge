/*
    CodeGen-WinUI.js
    Written by: Johnathon Largent
    Version 1.0

    Revision:

    1. Split out of codegen.js: winuiMenuXaml, winuiTabXaml, and
    generateWinUI - the WinUI output generator (not implemented yet:
    a page-shell scaffold with a TODO list, see FORMAT_STATUS.winui in
    Engine.js). Depends on helpBlockAsHtmlComment (Properties-Pane.js) -
    load before CodeGen.js.
*/

const CODEGEN_WINUI_VERSION = '1.0';

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

