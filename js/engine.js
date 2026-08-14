// --- SELF-REPORTING VERSION ---
const ENGINE_JS_VERSION = "1.14";

// --- GLOBAL STATE ---
let universalUIModel = {
    Title: "My Custom Tool",
    Theme: "winforms",
    ShowControlBox: true,
    ShowGlobalMenu: true,
    TopMost: false,
    StartPosition: "CenterScreen",
    FormBorderStyle: "Sizable",
    Width: 650,
    Height: 480,
    Children: [],
    GlobalMenu: "File (Open, Save, Exit), Edit (Cut, Copy, Paste), Help (About)"
};

let selectedControlIndex = null;
let activeSidebarTab = 'properties'; 
let isDragging = false;
let resizeMode = null; 
let activeResizeIndex = null;
let dragOffset = { x: 0, y: 0 };
let resizeStartDims = { w: 0, h: 0, x: 0, y: 0, mouseX: 0, mouseY: 0 };

// --- SETTINGS MODAL LOGIC ---
function openSettings() {
    const list = document.getElementById('version-list-container');
    list.innerHTML = '';
    
    const htmlMeta = document.getElementById('html-version');
    const htmlVer = htmlMeta ? htmlMeta.getAttribute('content') : "Unknown";
    list.innerHTML += `<li>index.html <span style="color:#888;">[version ${htmlVer}]</span></li>`;
    list.innerHTML += `<li>js/engine.js <span style="color:#888;">[version ${ENGINE_JS_VERSION}]</span></li>`;

    const rootStyles = getComputedStyle(document.documentElement);
    let themesVer = rootStyles.getPropertyValue('--themes-css-version').trim();
    themesVer = themesVer.replace(/^["']|["']$/g, '') || "Unknown or Not Loaded";
    list.innerHTML += `<li>css/themes.css <span style="color:#888;">[version ${themesVer}]</span></li>`;

    document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

function switchSidebarTab(tabName) {
    activeSidebarTab = tabName;
    document.getElementById('btn-tab-props').style.background = tabName === 'properties' ? '#333' : '#252526';
    document.getElementById('btn-tab-code').style.background = tabName === 'code' ? '#333' : '#252526';
    renderSidebar();
}

// --- CORE ENGINE LOGIC ---
function addControl(type) {
    let parentTabCtrl = null;
    let parentTabIdx = 0;
    if (selectedControlIndex !== null) {
        let sel = universalUIModel.Children[selectedControlIndex];
        if (sel.Type === 'TabControl') {
            parentTabCtrl = sel.Name;
            parentTabIdx = sel.ActiveTabIdx || 0;
        }
    }

    const newControl = {
        Type: type,
        Name: `${type}${universalUIModel.Children.length + 1}`,
        Text: type === 'MenuBar' ? 'File (Open, Save, Exit), Edit, Help' : (type === 'TabControl' ? 'Tab 1, Tab 2, Tab 3' : `New ${type}`),
        X: 20 + (universalUIModel.Children.length * 10),
        Y: 40 + (universalUIModel.Children.length * 20),
        Width: type === 'TabControl' ? 450 : 160,
        Height: type === 'TabControl' ? 280 : (type === 'TextBox' || type === 'Dropdown' ? 24 : 30),
        Interactive: false,
        ActiveTabIdx: 0,
        ParentTabControl: parentTabCtrl,
        ParentTabIndex: parentTabIdx,
        Options: type === 'Dropdown' || type === 'MenuBar' || type === 'TabControl' ? 'Item 1, Item 2' : undefined,
        Action: type === 'Button' ? '# Enter PowerShell code here...\nWrite-Host "Clicked!"' : ''
    };
    
    universalUIModel.Children.push(newControl);
    renderSimulator();
    renderSidebar();
    selectControl(universalUIModel.Children.length - 1);
}

function selectControl(index) {
    selectedControlIndex = index;
    renderSimulator();
    renderSidebar();
}

function deleteSelectedControl() {
    if (selectedControlIndex !== null) {
        universalUIModel.Children.splice(selectedControlIndex, 1);
        selectedControlIndex = null;
        renderSimulator();
        renderSidebar();
    }
}

function renderSimulator() {
    const workspace = document.getElementById('workspace');
    const canvas = document.getElementById('live-preview-canvas');
    
    workspace.className = `theme-${universalUIModel.Theme}`;
    canvas.style.width = `${universalUIModel.Width}px`;
    canvas.style.height = `${universalUIModel.Height}px`;
    
    let canvasInnerHtml = '';

    if (universalUIModel.ShowControlBox) {
        let controlsHtml = `
            <div class="window-controls">
                <button class="win-btn" title="Minimize">_</button>
                <button class="win-btn" title="Maximize">□</button>
                <button class="win-btn" title="Close">×</button>
            </div>`;
        if (universalUIModel.Theme === 'html') {
            controlsHtml = `
            <div class="window-controls">
                <button class="win-btn" title="Minimize">&#x2212;</button>
                <button class="win-btn" title="Maximize">&#x25A2;</button>
                <button class="win-btn" title="Close">&#x2715;</button>
            </div>`;
        }
        canvasInnerHtml += `
            <div class="window-titlebar">
                <span class="window-title-text">${universalUIModel.Title}</span>
                ${controlsHtml}
            </div>`;
    }

    if (universalUIModel.ShowGlobalMenu && universalUIModel.GlobalMenu) {
        canvasInnerHtml += `<div class="menu-bar">` + renderInteractiveMenu(universalUIModel.GlobalMenu) + `</div>`;
    }

    canvasInnerHtml += `
        <div class="canvas-handle canvas-handle-e" onmousedown="initResizeCanvas(event, 'e')"></div>
        <div class="canvas-handle canvas-handle-s" onmousedown="initResizeCanvas(event, 's')"></div>
        <div class="canvas-handle canvas-handle-se" onmousedown="initResizeCanvas(event, 'se')"></div>
        <div class="canvas-handle canvas-handle-w" onmousedown="initResizeCanvas(event, 'w')"></div>
        <div class="canvas-handle canvas-handle-n" onmousedown="initResizeCanvas(event, 'n')"></div>`;

    canvas.innerHTML = canvasInnerHtml;

    universalUIModel.Children.forEach((control, index) => {
        if (control.ParentTabControl) {
            const parent = universalUIModel.Children.find(c => c.Name === control.ParentTabControl);
            if (parent && parent.ActiveTabIdx !== control.ParentTabIndex) {
                return; 
            }
        }

        let el = document.createElement('div');
        el.className = 'canvas-element';
        if (index === selectedControlIndex) el.classList.add('selected-element');
        if (control.Interactive) el.classList.add('interactive');
        
        el.style.left = `${control.X}px`;
        el.style.top = `${control.Y}px`;
        el.style.width = `${control.Width}px`;
        el.style.height = `${control.Height}px`;
        
        el.onmousedown = (e) => {
            if (control.Interactive) return;
            e.stopPropagation();
            selectControl(index);
            isDragging = true;
            
            const canvasRect = canvas.getBoundingClientRect();
            dragOffset.x = (e.clientX - canvasRect.left) - control.X;
            dragOffset.y = (e.clientY - canvasRect.top) - control.Y;
        };

        let innerContent = '';
        if (control.Type === "Button") {
            innerContent = `<button type="button" style="width:100%; height:100%;">${control.Text}</button>`;
        } else if (control.Type === "TextBox") {
            innerContent = `<input type="text" style="width:100%; height:100%;" value="${control.Text}">`;
        } else if (control.Type === "Label") {
            innerContent = `<label style="width:100%; height:100%; display:inline-block;">${control.Text}</label>`;
        } else if (control.Type === "CheckBox") {
            innerContent = `<div style="display:flex; align-items:center; width:100%; height:100%;"><input type="checkbox"> <label>${control.Text}</label></div>`;
        } else if (control.Type === "RadioButton") {
            innerContent = `<div style="display:flex; align-items:center; width:100%; height:100%;"><input type="radio" name="group_main"> <label>${control.Text}</label></div>`;
        } else if (control.Type === "Dropdown") {
            const optionsHtml = (control.Options || '').split(',').map(opt => `<option>${opt.trim()}</option>`).join('');
            innerContent = `<select style="width:100%; height:100%;">${optionsHtml}</select>`;
        } else if (control.Type === "MenuBar") {
            innerContent = `<div class="menu-bar" style="width:100%; height:100%;">` + renderInteractiveMenu(control.Options || control.Text) + `</div>`;
        } else if (control.Type === "TabControl") {
            const tabsArr = (control.Options || 'Tab 1, Tab 2').split(',').map(t => t.trim());
            if (control.ActiveTabIdx >= tabsArr.length) control.ActiveTabIdx = 0;
            
            let tabsHtml = `<div class="tabcontrol-wrapper"><div class="tabcontrol-headers">`;
            tabsArr.forEach((t, ti) => {
                tabsHtml += `<div class="tabcontrol-tab ${ti === control.ActiveTabIdx ? 'active' : ''}" onclick="switchControlTab(${index}, ${ti}); event.stopPropagation();">${t}</div>`;
            });
            tabsHtml += `</div><div class="tabcontrol-content">Active Tab: <strong>${tabsArr[control.ActiveTabIdx]}</strong></div></div>`;
            innerContent = tabsHtml;
        }

        if (index === selectedControlIndex) {
            innerContent += `
                <div class="resize-handle handle-se" onmousedown="initResizeControl(event, ${index}, 'se')"></div>
                <div class="resize-handle handle-e" onmousedown="initResizeControl(event, ${index}, 'e')"></div>
                <div class="resize-handle handle-s" onmousedown="initResizeControl(event, ${index}, 's')"></div>`;
        }

        el.innerHTML = innerContent;
        canvas.appendChild(el);
    });

    canvas.onclick = (e) => {
        if (e.target === canvas) {
            selectedControlIndex = null;
            renderSimulator();
            renderSidebar();
        }
    };
}

function switchControlTab(controlIndex, tabIdx) {
    universalUIModel.Children[controlIndex].ActiveTabIdx = tabIdx;
    renderSimulator();
}

function renderInteractiveMenu(menuString) {
    if (!menuString) return '';
    let html = '';
    const parts = menuString.split(/,(?![^(]*\))/);
    parts.forEach(part => {
        part = part.trim();
        const subMatch = part.match(/(.*?)\((.*?)\)/);
        if (subMatch) {
            const parentName = subMatch[1].trim();
            const subItems = subMatch[2].split(',').map(s => `<div onclick="alert('Clicked menu item: ${s.trim()}')">${s.trim()}</div>`).join('');
            html += `
                <div class="menu-item-wrapper" onclick="this.classList.toggle('active'); event.stopPropagation();">
                    <span class="menu-label">${parentName} ▼</span>
                    <div class="menu-dropdown-content">${subItems}</div>
                </div>`;
        } else {
            html += `<div class="menu-item-wrapper"><span class="menu-label" onclick="alert('Clicked menu item: ${part}')">${part}</span></div>`;
        }
    });
    return html;
}

window.onclick = function() {
    document.querySelectorAll('.menu-item-wrapper').forEach(el => el.classList.remove('active'));
};

function initResizeControl(e, index, mode) {
    e.stopPropagation();
    resizeMode = 'control-' + mode;
    activeResizeIndex = index;
    const ctrl = universalUIModel.Children[index];
    resizeStartDims = { w: ctrl.Width, h: ctrl.Height, mouseX: e.clientX, mouseY: e.clientY };
}

function initResizeCanvas(e, mode) {
    e.stopPropagation();
    resizeMode = 'canvas-' + mode;
    resizeStartDims = { w: universalUIModel.Width, h: universalUIModel.Height, x: universalUIModel.Width, y: universalUIModel.Height, mouseX: e.clientX, mouseY: e.clientY };
}

document.onmousemove = (e) => {
    if (resizeMode && resizeMode.startsWith('control-') && activeResizeIndex !== null) {
        const ctrl = universalUIModel.Children[activeResizeIndex];
        const dx = e.clientX - resizeStartDims.mouseX;
        const dy = e.clientY - resizeStartDims.mouseY;
        
        if (resizeMode === 'control-se' || resizeMode === 'control-e') {
            ctrl.Width = Math.max(40, resizeStartDims.w + dx);
        }
        if (resizeMode === 'control-se' || resizeMode === 'control-s') {
            ctrl.Height = Math.max(20, resizeStartDims.h + dy);
        }
        renderSimulator();
        return;
    }

    if (resizeMode && resizeMode.startsWith('canvas-')) {
        const dx = e.clientX - resizeStartDims.mouseX;
        const dy = e.clientY - resizeStartDims.mouseY;

        if (resizeMode.includes('e')) {
            universalUIModel.Width = Math.max(300, resizeStartDims.w + dx);
        }
        if (resizeMode.includes('s')) {
            universalUIModel.Height = Math.max(200, resizeStartDims.h + dy);
        }
        if (resizeMode.includes('w')) {
            universalUIModel.Width = Math.max(300, resizeStartDims.w - dx);
        }
        if (resizeMode.includes('n')) {
            universalUIModel.Height = Math.max(200, resizeStartDims.h - dy);
        }
        renderSimulator();
        return;
    }

    if (!isDragging || selectedControlIndex === null) return;
    const canvas = document.getElementById('live-preview-canvas');
    const canvasRect = canvas.getBoundingClientRect();
    
    let newX = (e.clientX - canvasRect.left) - dragOffset.x;
    let newY = (e.clientY - canvasRect.top) - dragOffset.y;
    
    newX = Math.max(0, Math.min(newX, canvas.clientWidth - 50));
    newY = Math.max(0, Math.min(newY, canvas.clientHeight - 20));
    
    const control = universalUIModel.Children[selectedControlIndex];
    control.X = Math.round(newX);
    control.Y = Math.round(newY);
    
    const el = document.getElementsByClassName('canvas-element')[selectedControlIndex];
    if (el) {
        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
    }
};

document.onmouseup = () => {
    isDragging = false;
    resizeMode = null;
    activeResizeIndex = null;
};

function nudgeControl(dx, dy) {
    if (selectedControlIndex !== null) {
        const control = universalUIModel.Children[selectedControlIndex];
        const canvas = document.getElementById('live-preview-canvas');
        
        control.X = Math.max(0, Math.min(control.X + dx, canvas.clientWidth - 50));
        control.Y = Math.max(0, Math.min(control.Y + dy, canvas.clientHeight - 20));
        
        renderSimulator();
        renderSidebar();
    }
}

function resizeControl(dw, dh) {
    if (selectedControlIndex !== null) {
        const control = universalUIModel.Children[selectedControlIndex];
        const canvas = document.getElementById('live-preview-canvas');
        
        control.Width = Math.max(30, Math.min(control.Width + dw, canvas.clientWidth - control.X));
        control.Height = Math.max(20, Math.min(control.Height + dh, canvas.clientHeight - control.Y));
        
        renderSimulator();
        renderSidebar();
    }
}

function renderSidebar() {
    const propsContent = document.getElementById('props-content');
    if (activeSidebarTab === 'code') {
        renderCodeExporter();
        return;
    }
    
    if (selectedControlIndex === null) {
        propsContent.innerHTML = `
            <div style="padding: 10px 15px; background: #333; color: #4af626; font-size: 0.9em; text-transform: uppercase;">Form Properties</div>
            <div class="prop-group">
                <label>Window Title</label>
                <input type="text" value="${universalUIModel.Title}" oninput="universalUIModel.Title = this.value; renderSimulator();">
            </div>
            <div class="prop-group">
                <label>Rendering Theme (Output Type)</label>
                <select onchange="universalUIModel.Theme = this.value; renderSimulator();">
                    <option value="winforms" ${universalUIModel.Theme === 'winforms' ? 'selected' : ''}>PowerShell WinForms</option>
                    <option value="wpf" ${universalUIModel.Theme === 'wpf' ? 'selected' : ''}>PowerShell WPF</option>
                    <option value="html" ${universalUIModel.Theme === 'html' ? 'selected' : ''}>HTML / Web Form</option>
                </select>
            </div>
            <div class="prop-group">
                <label>Window Dimensions (Width x Height)</label>
                <div style="display:flex; gap:5px;">
                    <input type="number" value="${universalUIModel.Width}" oninput="universalUIModel.Width = parseInt(this.value)||400; renderSimulator();">
                    <input type="number" value="${universalUIModel.Height}" oninput="universalUIModel.Height = parseInt(this.value)||300; renderSimulator();">
                </div>
            </div>
            <div class="prop-group">
                <label>Startup Position</label>
                <select onchange="universalUIModel.StartPosition = this.value;">
                    <option value="CenterScreen" ${universalUIModel.StartPosition === 'CenterScreen' ? 'selected' : ''}>Center Screen</option>
                    <option value="Manual" ${universalUIModel.StartPosition === 'Manual' ? 'selected' : ''}>Manual (Default)</option>
                    <option value="WindowsDefaultLocation" ${universalUIModel.StartPosition === 'WindowsDefaultLocation' ? 'selected' : ''}>Windows Default</option>
                </select>
            </div>
            <div class="prop-group">
                <label>Border Style / Resizability</label>
                <select onchange="universalUIModel.FormBorderStyle = this.value;">
                    <option value="Sizable" ${universalUIModel.FormBorderStyle === 'Sizable' ? 'selected' : ''}>Sizable (Resizable)</option>
                    <option value="FixedSingle" ${universalUIModel.FormBorderStyle === 'FixedSingle' ? 'selected' : ''}>Fixed Single (Non-Resizable)</option>
                    <option value="None" ${universalUIModel.FormBorderStyle === 'None' ? 'selected' : ''}>None</option>
                </select>
            </div>
            <div class="prop-group">
                <label>Global Top Menu Bar Items (e.g. File (Open, Save, Exit), Edit, Help)</label>
                <input type="text" value="${universalUIModel.GlobalMenu}" oninput="universalUIModel.GlobalMenu = this.value; renderSimulator();">
            </div>
            <div class="prop-group">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" ${universalUIModel.ShowGlobalMenu ? 'checked' : ''} onchange="universalUIModel.ShowGlobalMenu = this.checked; renderSimulator();" style="width:auto;"> 
                    Show Global Top Menu Bar
                </label>
            </div>
            <div class="prop-group">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" ${universalUIModel.TopMost ? 'checked' : ''} onchange="universalUIModel.TopMost = this.checked;" style="width:auto;"> 
                    TopMost (Always on Top)
                </label>
            </div>
            <div class="prop-group">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" ${universalUIModel.ShowControlBox ? 'checked' : ''} onchange="universalUIModel.ShowControlBox = this.checked; renderSimulator();" style="width:auto;"> 
                    Show Window Title Bar & Buttons
                </label>
            </div>
        `;
        return;
    }

    const control = universalUIModel.Children[selectedControlIndex];
    
    const tabControls = universalUIModel.Children.filter(c => c.Type === 'TabControl' && c.Name !== control.Name);
    let tabParentOptions = `<option value="">None (Form Level)</option>`;
    tabControls.forEach(tc => {
        const tabs = (tc.Options || 'Tab 1, Tab 2').split(',');
        tabs.forEach((t, idx) => {
            let sel = (control.ParentTabControl === tc.Name && control.ParentTabIndex === idx) ? 'selected' : '';
            tabParentOptions += `<option value="${tc.Name}:${idx}" ${sel}>${tc.Name} -> ${t.trim()}</option>`;
        });
    });

    propsContent.innerHTML = `
        <div style="padding: 10px 15px; background: #333; color: #0078d4; font-size: 0.9em; text-transform: uppercase;">Control Properties</div>
        <div class="prop-group">
            <label>Type</label>
            <input type="text" value="${control.Type}" disabled style="color:#888;">
        </div>
        <div class="prop-group">
            <label>Name (ID)</label>
            <input type="text" value="${control.Name}" oninput="control.Name = this.value;">
        </div>
        <div class="prop-group">
            <label>Text / Label</label>
            <input type="text" value="${control.Text}" oninput="control.Text = this.value; renderSimulator();">
        </div>
        ${tabControls.length > 0 && control.Type !== 'TabControl' ? `
        <div class="prop-group">
            <label>Parent Tab Container</label>
            <select onchange="let val = this.value; if(val === '') { control.ParentTabControl = null; control.ParentTabIndex = 0; } else { let p = val.split(':'); control.ParentTabControl = p[0]; control.ParentTabIndex = parseInt(p[1]); } renderSimulator();">
                ${tabParentOptions}
            </select>
        </div>` : ''}
        <div class="prop-group">
            <label>Size (Width x Height)</label>
            <div style="display:flex; gap:5px;">
                <input type="number" value="${control.Width}" oninput="control.Width = Math.max(20, parseInt(this.value)||50); renderSimulator();">
                <input type="number" value="${control.Height}" oninput="control.Height = Math.max(20, parseInt(this.value)||30); renderSimulator();">
            </div>
            <div style="display:flex; gap:4px; margin-top:5px;">
                <button class="nudge-btn" onclick="resizeControl(-10, 0)">Width -10</button>
                <button class="nudge-btn" onclick="resizeControl(10, 0)">Width +10</button>
                <button class="nudge-btn" onclick="resizeControl(0, -10)">Height -10</button>
                <button class="nudge-btn" onclick="resizeControl(0, 10)">Height +10</button>
            </div>
        </div>
        <div class="prop-group">
            <label>Position Nudge (X: ${control.X}px, Y: ${control.Y}px)</label>
            <div style="display:flex; flex-direction:column; gap:4px; margin-top:5px;">
                <div style="font-size:0.75em; color:#aaa;">1px Nudge:</div>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:2px; max-width:150px;">
                    <div></div><button class="nudge-btn" onclick="nudgeControl(0, -1)">▲</button><div></div>
                    <button class="nudge-btn" onclick="nudgeControl(-1, 0)">◀</button>
                    <button class="nudge-btn" onclick="nudgeControl(0, 1)">▼</button>
                    <button class="nudge-btn" onclick="nudgeControl(1, 0)">▶</button>
                </div>
                <div style="font-size:0.75em; color:#aaa; margin-top:4px;">5px Nudge:</div>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:2px; max-width:150px;">
                    <div></div><button class="nudge-btn" onclick="nudgeControl(0, -5)">▲</button><div></div>
                    <button class="nudge-btn" onclick="nudgeControl(-5, 0)">◀</button>
                    <button class="nudge-btn" onclick="nudgeControl(0, 5)">▼</button>
                    <button class="nudge-btn" onclick="nudgeControl(5, 0)">▶</button>
                </div>
                <div style="font-size:0.75em; color:#aaa; margin-top:4px;">10px Nudge:</div>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:2px; max-width:150px;">
                    <div></div><button class="nudge-btn" onclick="nudgeControl(0, -10)">▲</button><div></div>
                    <button class="nudge-btn" onclick="nudgeControl(-10, 0)">◀</button>
                    <button class="nudge-btn" onclick="nudgeControl(0, 10)">▼</button>
                    <button class="nudge-btn" onclick="nudgeControl(10, 0)">▶</button>
                </div>
            </div>
        </div>
        <div class="prop-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" ${control.Interactive ? 'checked' : ''} onchange="control.Interactive = this.checked; renderSimulator();" style="width:auto;"> 
                Interact Mode (Test Control)
            </label>
        </div>
        ${control.Type === 'Dropdown' || control.Type === 'MenuBar' || control.Type === 'TabControl' ? `
        <div class="prop-group">
            <label>Items / Tabs / Submenus (Comma separated)</label>
            <input type="text" value="${control.Options || ''}" oninput="control.Options = this.value; renderSimulator();">
        </div>` : ''}
        ${control.Type === 'Button' ? `
        <div class="prop-group">
            <label>OnClick Action (PowerShell script)</label>
            <textarea oninput="control.Action = this.value;">${control.Action}</textarea>
        </div>` : ''}
        <div class="prop-group" style="border-bottom: none;">
            <button class="tool-btn danger-btn" onclick="deleteSelectedControl()">🗑️ Delete Element</button>
        </div>
    `;
}

let wpfExportMode = 'single';

function renderCodeExporter() {
    const propsContent = document.getElementById('props-content');
    let generatedCode = "";

    if (universalUIModel.Theme === 'winforms') {
        generatedCode = generatePowerShellWinFormsCode();
    } else if (universalUIModel.Theme === 'wpf') {
        generatedCode = generatePowerShellWPFCode();
    } else {
        generatedCode = generateHTMLCode();
    }

    let wpfToggleHtml = universalUIModel.Theme === 'wpf' ? `
        <div class="prop-group">
            <label>WPF Export Format</label>
            <select onchange="wpfExportMode = this.value; renderCodeExporter();">
                <option value="single" ${wpfExportMode === 'single' ? 'selected' : ''}>Single PowerShell script (.ps1)</option>
                <option value="xaml" ${wpfExportMode === 'xaml' ? 'selected' : ''}>Separate XAML + PS1 files</option>
            </select>
        </div>` : '';

    propsContent.innerHTML = `
        <div style="padding: 10px 15px; background: #333; color: #4af626; font-size: 0.9em; text-transform: uppercase;">Generated Code Exporter</div>
        ${wpfToggleHtml}
        <div class="prop-group">
            <label>Ready-to-use Script (Click inside and press Ctrl+A, Ctrl+C to copy)</label>
            <textarea readonly onclick="this.select();" style="height: 280px; font-size: 11px; font-family: Consolas, monospace;">${generatedCode}</textarea>
        </div>
    `;
}

function generatePowerShellWinFormsCode() {
    let code = `Add-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName System.Drawing\n\n`;
    code += `$form = New-Object System.Windows.Forms.Form\n`;
    code += `$form.Text = '${universalUIModel.Title}'\n`;
    code += `$form.Width = ${universalUIModel.Width}\n`;
    code += `$form.Height = ${universalUIModel.Height}\n`;
    code += `$form.StartPosition = [System.Windows.Forms.FormStartPosition]::${universalUIModel.StartPosition}\n`;
    code += `$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::${universalUIModel.FormBorderStyle}\n`;
    code += `$form.TopMost = $${universalUIModel.TopMost}\n`;
    code += `$form.ControlBox = $${universalUIModel.ShowControlBox}\n\n`;

    if (universalUIModel.ShowGlobalMenu && universalUIModel.GlobalMenu) {
        code += `# Global Menu Bar Setup\n`;
        code += `$mainMenu = New-Object System.Windows.Forms.MainMenu\n`;
        universalUIModel.GlobalMenu.split(',').forEach(part => {
            part = part.trim();
            const subMatch = part.match(/(.*?)\((.*?)\)/);
            if (subMatch) {
                let parentText = subMatch[1].trim();
                let pName = parentText.replace(/[^a-zA-Z0-9]/g, '');
                code += `$m_${pName} = New-Object System.Windows.Forms.MenuItem\n`;
                code += `$m_${pName}.Text = '${parentText}'\n`;
                subMatch[2].split(',').forEach(sub => {
                    let subText = sub.trim();
                    let sName = subText.replace(/[^a-zA-Z0-9]/g, '');
                    code += `$sub_${sName} = New-Object System.Windows.Forms.MenuItem\n`;
                    code += `$sub_${sName}.Text = '${subText}'\n`;
                    code += `$sub_${sName}.Add_Click({ Write-Host "Clicked ${subText}" })\n`;
                    code += `$m_${pName}.MenuItems.Add($sub_${sName}) | Out-Null\n`;
                });
                code += `$mainMenu.MenuItems.Add($m_${pName}) | Out-Null\n\n`;
            } else {
                let mName = part.replace(/[^a-zA-Z0-9]/g, '');
                code += `$m_${mName} = New-Object System.Windows.Forms.MenuItem\n`;
                code += `$m_${mName}.Text = '${part}'\n`;
                code += `$m_${mName}.Add_Click({ Write-Host "Clicked ${part}" })\n`;
                code += `$mainMenu.MenuItems.Add($m_${mName}) | Out-Null\n\n`;
            }
        });
        code += `$form.Menu = $mainMenu\n\n`;
    }

    universalUIModel.Children.forEach(c => {
        if (c.Type === 'Button') {
            code += `$${c.Name} = New-Object System.Windows.Forms.Button\n`;
            code += `$${c.Name}.Text = '${c.Text}'\n`;
            code += `$${c.Name}.Location = New-Object System.Drawing.Point(${c.X}, ${c.Y})\n`;
            code += `$${c.Name}.Size = New-Object System.Drawing.Size(${c.Width}, ${c.Height})\n`;
            if (c.Action) {
                code += `$${c.Name}.Add_Click({ \n${c.Action}\n })\n`;
            }
            code += `$form.Controls.Add($${c.Name})\n\n`;
        } else if (c.Type === 'TextBox') {
            code += `$${c.Name} = New-Object System.Windows.Forms.TextBox\n`;
            code += `$${c.Name}.Text = '${c.Text}'\n`;
            code += `$${c.Name}.Location = New-Object System.Drawing.Point(${c.X}, ${c.Y})\n`;
            code += `$${c.Name}.Size = New-Object System.Drawing.Size(${c.Width}, ${c.Height})\n`;
            code += `$form.Controls.Add($${c.Name})\n\n`;
        } else if (c.Type === 'Label') {
            code += `$${c.Name} = New-Object System.Windows.Forms.Label\n`;
            code += `$${c.Name}.Text = '${c.Text}'\n`;
            code += `$${c.Name}.Location = New-Object System.Drawing.Point(${c.X}, ${c.Y})\n`;
            code += `$${c.Name}.Size = New-Object System.Drawing.Size(${c.Width}, ${c.Height})\n`;
            code += `$form.Controls.Add($${c.Name})\n\n`;
        } else if (c.Type === 'CheckBox') {
            code += `$${c.Name} = New-Object System.Windows.Forms.CheckBox\n`;
            code += `$${c.Name}.Text = '${c.Text}'\n`;
            code += `$${c.Name}.Location = New-Object System.Drawing.Point(${c.X}, ${c.Y})\n`;
            code += `$${c.Name}.Size = New-Object System.Drawing.Size(${c.Width}, ${c.Height})\n`;
            code += `$form.Controls.Add($${c.Name})\n\n`;
        } else if (c.Type === 'RadioButton') {
            code += `$${c.Name} = New-Object System.Windows.Forms.RadioButton\n`;
            code += `$${c.Name}.Text = '${c.Text}'\n`;
            code += `$${c.Name}.Location = New-Object System.Drawing.Point(${c.X}, ${c.Y})\n`;
            code += `$${c.Name}.Size = New-Object System.Drawing.Size(${c.Width}, ${c.Height})\n`;
            code += `$form.Controls.Add($${c.Name})\n\n`;
        } else if (c.Type === 'Dropdown') {
            code += `$${c.Name} = New-Object System.Windows.Forms.ComboBox\n`;
            (c.Options || '').split(',').forEach(opt => {
                code += `$${c.Name}.Items.Add('${opt.trim()}')\n`;
            });
            code += `$${c.Name}.Location = New-Object System.Drawing.Point(${c.X}, ${c.Y})\n`;
            code += `$${c.Name}.Size = New-Object System.Drawing.Size(${c.Width}, ${c.Height})\n`;
            code += `$form.Controls.Add($${c.Name})\n\n`;
        }
    });

    code += `[void]$form.ShowDialog()`;
    return code;
}

function generatePowerShellWPFCode() {
    let xamlChildren = '';
    universalUIModel.Children.forEach(c => {
        if (c.Type === 'Button') {
            xamlChildren += `        <Button Content="${c.Text}" Canvas.Left="${c.X}" Canvas.Top="${c.Y}" Width="${c.Width}" Height="${c.Height}" />\n`;
        } else if (c.Type === 'TextBox') {
            xamlChildren += `        <TextBox Text="${c.Text}" Canvas.Left="${c.X}" Canvas.Top="${c.Y}" Width="${c.Width}" Height="${c.Height}" />\n`;
        } else if (c.Type === 'Label') {
            xamlChildren += `        <Label Content="${c.Text}" Canvas.Left="${c.X}" Canvas.Top="${c.Y}" Width="${c.Width}" Height="${c.Height}" />\n`;
        } else if (c.Type === 'CheckBox') {
            xamlChildren += `        <CheckBox Content="${c.Text}" Canvas.Left="${c.X}" Canvas.Top="${c.Y}" Width="${c.Width}" Height="${c.Height}" />\n`;
        } else if (c.Type === 'RadioButton') {
            xamlChildren += `        <RadioButton Content="${c.Text}" Canvas.Left="${c.X}" Canvas.Top="${c.Y}" Width="${c.Width}" Height="${c.Height}" />\n`;
        }
    });

    if (wpfExportMode === 'xaml') {
        return `# --- form.xaml ---\n<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"\n        Title="${universalUIModel.Title}" Width="${universalUIModel.Width}" Height="${universalUIModel.Height}">\n    <Canvas>\n${xamlChildren}    </Canvas>\n</Window>\n\n# --- run.ps1 ---\n[xml]$xaml = Get-Content "$PSScriptRoot/form.xaml"\n$reader = (New-Object System.Xml.XmlNodeReader $xaml)\n$form = [Windows.Markup.XamlReader]::Load($reader)\n[void]$form.ShowDialog()`;
    } else {
        return `[void][System.Reflection.Assembly]::LoadWithPartialName('presentationframework')\n[xml]$xaml = @"\n<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"\n        Title="${universalUIModel.Title}" Width="${universalUIModel.Width}" Height="${universalUIModel.Height}">\n    <Canvas>\n${xamlChildren}    </Canvas>\n</Window>\n"@\n$reader = (New-Object System.Xml.XmlNodeReader $xaml)\n$form = [Windows.Markup.XamlReader]::Load($reader)\n[void]$form.ShowDialog();\n\n[xml]$xaml2 = @"\n<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"\n        Title="${universalUIModel.Title} - Secondary" Width="${universalUIModel.Width}" Height="${universalUIModel.Height}">\n    <Canvas>\n${xamlChildren}    </Canvas>\n</Window>\n"@\n$reader2 = (New-Object System.Xml.XmlNodeReader $xaml2)\n$form2 = [Windows.Markup.XamlReader]::Load($reader2)\n[void]$form2.ShowDialog()`;
    }
}

function generateHTMLCode() {
    let html = `<!DOCTYPE html>\n<html>\n<head>\n    <title>${universalUIModel.Title}</title>\n    <style>body { font-family: sans-serif; position: relative; width: ${universalUIModel.Width}px; height: ${universalUIModel.Height}px; }</style>\n</head>\n<body>\n`;
    universalUIModel.Children.forEach(c => {
        if (c.Type === 'Button') {
            html += `    <button style="position:absolute; left:${c.X}px; top:${c.Y}px; width:${c.Width}px; height:${c.Height}px;">${c.Text}</button>\n`;
        } else if (c.Type === 'TextBox') {
            html += `    <input type="text" value="${c.Text}" style="position:absolute; left:${c.X}px; top:${c.Y}px; width:${c.Width}px; height:${c.Height}px;" />\n`;
        } else if (c.Type === 'Label') {
            html += `    <label style="position:absolute; left:${c.X}px; top:${c.Y}px; width:${c.Width}px; height:${c.Height}px;">${c.Text}</label>\n`;
        } else if (c.Type === 'CheckBox') {
            html += `    <div style="position:absolute; left:${c.X}px; top:${c.Y}px; width:${c.Width}px; height:${c.Height}px;"><input type="checkbox"/> <label>${c.Text}</label></div>\n`;
        } else if (c.Type === 'RadioButton') {
            html += `    <div style="position:absolute; left:${c.X}px; top:${c.Y}px; width:${c.Width}px; height:${c.Height}px;"><input type="radio"/> <label>${c.Text}</label></div>\n`;
        }
    });
    html += `</body>\n</html>`;
    return html;
}

document.addEventListener('DOMContentLoaded', () => {
    renderSimulator();
    renderSidebar();
});
