// --- SELF-REPORTING VERSION ---
const ENGINE_JS_VERSION = "1.10";

// --- GLOBAL STATE ---
let universalUIModel = {
    Title: "My Custom Tool",
    Theme: "winforms",
    ShowControlBox: true,
    TopMost: false,
    StartPosition: "CenterScreen",
    FormBorderStyle: "Sizable",
    Width: 650,
    Height: 480,
    Children: [],
    GlobalMenu: "File (Open, Save, Exit), Edit (Cut, Copy, Paste), Help (About)"
};

let selectedControlIndex = null;
let activeSidebarTab = 'properties'; // 'properties' or 'code'
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

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

// --- SIDEBAR SWITCHING ---
function switchSidebarTab(tabName) {
    activeSidebarTab = tabName;
    document.getElementById('btn-tab-props').style.background = tabName === 'properties' ? '#333' : '#252526';
    document.getElementById('btn-tab-code').style.background = tabName === 'code' ? '#333' : '#252526';
    renderSidebar();
}

// --- CORE ENGINE LOGIC ---
function addControl(type) {
    const newControl = {
        Type: type,
        Name: `${type}${universalUIModel.Children.length + 1}`,
        Text: type === 'MenuBar' ? 'File (Open, Save, Exit), Edit, Help' : (type === 'TabControl' ? 'Tab 1, Tab 2, Tab 3' : `New ${type}`),
        X: 20 + (universalUIModel.Children.length * 10),
        Y: 40 + (universalUIModel.Children.length * 20),
        Width: type === 'TabControl' ? 450 : 160,
        Height: type === 'TabControl' ? 280 : (type === 'TextBox' || type === 'Dropdown' ? 24 : 30),
        Interactive: false,
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
    
    let themeClass = `theme-${universalUIModel.Theme}`;
    if (universalUIModel.ShowControlBox) {
        themeClass += ` show-chrome`;
    }
    workspace.className = themeClass;
    
    canvas.style.width = `${universalUIModel.Width}px`;
    canvas.style.height = `${universalUIModel.Height}px`;
    canvas.setAttribute('data-title', universalUIModel.Title);
    
    let canvasInnerHtml = `
        <div class="window-controls">
            <button class="win-btn" title="Minimize">_</button>
            <button class="win-btn" title="Maximize">□</button>
            <button class="win-btn" title="Close">×</button>
        </div>`;

    if (universalUIModel.GlobalMenu) {
        canvasInnerHtml += `<div class="menu-bar">` + renderInteractiveMenu(universalUIModel.GlobalMenu) + `</div>`;
    }

    canvas.innerHTML = canvasInnerHtml;

    universalUIModel.Children.forEach((control, index) => {
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

        if (control.Type === "Button") {
            el.innerHTML = `<button type="button" style="width:100%; height:100%;">${control.Text}</button>`;
        } else if (control.Type === "TextBox") {
            el.innerHTML = `<input type="text" style="width:100%; height:100%;" value="${control.Text}">`;
        } else if (control.Type === "Label") {
            el.innerHTML = `<label style="width:100%; height:100%; display:inline-block;">${control.Text}</label>`;
        } else if (control.Type === "CheckBox") {
            el.innerHTML = `<div style="display:flex; align-items:center; width:100%; height:100%;"><input type="checkbox"> <label>${control.Text}</label></div>`;
        } else if (control.Type === "RadioButton") {
            el.innerHTML = `<div style="display:flex; align-items:center; width:100%; height:100%;"><input type="radio" name="group_main"> <label>${control.Text}</label></div>`;
        } else if (control.Type === "Dropdown") {
            const optionsHtml = (control.Options || '').split(',').map(opt => `<option>${opt.trim()}</option>`).join('');
            el.innerHTML = `<select style="width:100%; height:100%;">${optionsHtml}</select>`;
        } else if (control.Type === "MenuBar") {
            el.innerHTML = `<div class="menu-bar" style="width:100%; height:100%;">` + renderInteractiveMenu(control.Options || control.Text) + `</div>`;
        } else if (control.Type === "TabControl") {
            const tabsArr = (control.Options || 'Tab 1, Tab 2').split(',').map(t => t.trim());
            let tabsHtml = `<div class="tabcontrol-wrapper"><div class="tabcontrol-headers">`;
            tabsArr.forEach((t, ti) => {
                tabsHtml += `<div class="tabcontrol-tab ${ti === 0 ? 'active' : ''}">${t}</div>`;
            });
            tabsHtml += `</div><div class="tabcontrol-content" style="padding-bottom:30px;">[Configurable Content Area]</div></div>`;
            el.innerHTML = tabsHtml;
        }
        
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

document.onmousemove = (e) => {
    if (!isDragging || selectedControlIndex === null) return;
    const canvas = document.getElementById('live-preview-canvas');
    const canvasRect = canvas.getBoundingClientRect();
    
    let newX = (e.clientX - canvasRect.left) - dragOffset.x;
    let newY = (e.clientY - canvasRect.top) - dragOffset.y;
    
    newX = Math.max(0, Math.min(newX, canvas.clientWidth - 50));
    newY = Math.max(0, Math.min(newY, canvas.clientHeight - 20));
    
    universalUIModel.Children[selectedControlIndex].X = Math.round(newX);
    universalUIModel.Children[selectedControlIndex].Y = Math.round(newY);
    
    const el = document.getElementsByClassName('canvas-element')[selectedControlIndex];
    if (el) {
        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
    }
};

document.onmouseup = () => {
    isDragging = false;
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
                <input type="text" value="${universalUIModel.Title}" oninput="updateFormProperty('Title', this.value)">
            </div>
            <div class="prop-group">
                <label>Rendering Theme (Output Type)</label>
                <select onchange="updateFormProperty('Theme', this.value)">
                    <option value="winforms" ${universalUIModel.Theme === 'winforms' ? 'selected' : ''}>PowerShell WinForms</option>
                    <option value="wpf" ${universalUIModel.Theme === 'wpf' ? 'selected' : ''}>PowerShell WPF</option>
                    <option value="html" ${universalUIModel.Theme === 'html' ? 'selected' : ''}>HTML / Web Form</option>
                </select>
            </div>
            <div class="prop-group">
                <label>Window Dimensions (Width x Height)</label>
                <div style="display:flex; gap:5px;">
                    <input type="number" value="${universalUIModel.Width}" oninput="updateFormProperty('Width', parseInt(this.value)||400)">
                    <input type="number" value="${universalUIModel.Height}" oninput="updateFormProperty('Height', parseInt(this.value)||300)">
                </div>
            </div>
            <div class="prop-group">
                <label>Startup Position</label>
                <select onchange="updateFormProperty('StartPosition', this.value)">
                    <option value="CenterScreen" ${universalUIModel.StartPosition === 'CenterScreen' ? 'selected' : ''}>Center Screen</option>
                    <option value="Manual" ${universalUIModel.StartPosition === 'Manual' ? 'selected' : ''}>Manual (Default)</option>
                    <option value="WindowsDefaultLocation" ${universalUIModel.StartPosition === 'WindowsDefaultLocation' ? 'selected' : ''}>Windows Default</option>
                </select>
            </div>
            <div class="prop-group">
                <label>Border Style / Resizability</label>
                <select onchange="updateFormProperty('FormBorderStyle', this.value)">
                    <option value="Sizable" ${universalUIModel.FormBorderStyle === 'Sizable' ? 'selected' : ''}>Sizable (Resizable)</option>
                    <option value="FixedSingle" ${universalUIModel.FormBorderStyle === 'FixedSingle' ? 'selected' : ''}>Fixed Single (Non-Resizable)</option>
                    <option value="None" ${universalUIModel.FormBorderStyle === 'None' ? 'selected' : ''}>None</option>
                </select>
            </div>
            <div class="prop-group">
                <label>Global Top Menu Bar Items (e.g. File (Open, Save, Exit), Edit, Help)</label>
                <input type="text" value="${universalUIModel.GlobalMenu}" oninput="updateFormProperty('GlobalMenu', this.value)">
            </div>
            <div class="prop-group">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" ${universalUIModel.TopMost ? 'checked' : ''} onchange="updateFormProperty('TopMost', this.checked)" style="width:auto;"> 
                    TopMost (Always on Top)
                </label>
            </div>
            <div class="prop-group">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" ${universalUIModel.ShowControlBox ? 'checked' : ''} onchange="updateFormProperty('ShowControlBox', this.checked)" style="width:auto;"> 
                    Show Window Title Bar & Buttons
                </label>
            </div>
        `;
        return;
    }

    const control = universalUIModel.Children[selectedControlIndex];
    
    propsContent.innerHTML = `
        <div style="padding: 10px 15px; background: #333; color: #0078d4; font-size: 0.9em; text-transform: uppercase;">Control Properties</div>
        <div class="prop-group">
            <label>Type</label>
            <input type="text" value="${control.Type}" disabled style="color:#888;">
        </div>
        <div class="prop-group">
            <label>Name (ID)</label>
            <input type="text" value="${control.Name}" oninput="updateControlProperty('Name', this.value)">
        </div>
        <div class="prop-group">
            <label>Text / Label</label>
            <input type="text" value="${control.Text}" oninput="updateControlProperty('Text', this.value)">
        </div>
        <div class="prop-group">
            <label>Size (Width x Height)</label>
            <div style="display:flex; gap:5px;">
                <input type="number" value="${control.Width}" oninput="updateControlDimension('Width', this.value)">
                <input type="number" value="${control.Height}" oninput="updateControlDimension('Height', this.value)">
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
                <input type="checkbox" ${control.Interactive ? 'checked' : ''} onchange="toggleInteractive(${selectedControlIndex}, this.checked)" style="width:auto;"> 
                Interact Mode (Test Control)
            </label>
        </div>
        ${control.Type === 'Dropdown' || control.Type === 'MenuBar' || control.Type === 'TabControl' ? `
        <div class="prop-group">
            <label>Items / Tabs / Submenus (Comma separated)</label>
            <input type="text" value="${control.Options || ''}" oninput="updateControlProperty('Options', this.value)">
        </div>` : ''}
        ${control.Type === 'Button' ? `
        <div class="prop-group">
            <label>OnClick Action (PowerShell script)</label>
            <textarea oninput="updateControlProperty('Action', this.value)">${control.Action}</textarea>
        </div>` : ''}
        <div class="prop-group" style="border-bottom: none;">
            <button class="tool-btn danger-btn" onclick="deleteSelectedControl()">🗑️ Delete Element</button>
        </div>
    `;
}

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

    propsContent.innerHTML = `
        <div style="padding: 10px 15px; background: #333; color: #4af626; font-size: 0.9em; text-transform: uppercase;">Generated Code Exporter</div>
        <div class="prop-group">
            <label>Ready-to-use PowerShell Script</label>
            <textarea readonly style="height: 300px; font-size: 11px;">${generatedCode}</textarea>
        </div>
        <div class="prop-group" style="border-bottom: none;">
            <button class="tool-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.previousElementSibling.querySelector('textarea').value); alert('Code copied to clipboard!');" style="text-align:center; background:#0078d4;">📋 Copy Code to Clipboard</button>
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
    return `# WPF XAML Exporter template\n[xml]$xaml = @"\n<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="${universalUIModel.Title}" Width="${universalUIModel.Width}" Height="${universalUIModel.Height}">\n    <Canvas>\n    </Canvas>\n</Window>\n"@\n# Load XAML in PowerShell...`;
}

function generateHTMLCode() {
    return `<!DOCTYPE html>\n<html>\n<head><title>${universalUIModel.Title}</title></head>\n<body>\n    <!-- Generated HTML Form -->\n</body>\n</html>`;
}

function updateFormProperty(property, value) {
    universalUIModel[property] = value;
    renderSimulator();
}

function updateControlProperty(property, value) {
    if (selectedControlIndex !== null) {
        universalUIModel.Children[selectedControlIndex][property] = value;
        if (property === 'Text' || property === 'Options') {
            renderSimulator();
        }
    }
}

function updateControlDimension(dimension, value) {
    if (selectedControlIndex !== null) {
        universalUIModel.Children[selectedControlIndex][dimension] = Math.max(20, parseInt(value) || 50);
        renderSimulator();
    }
}

function toggleInteractive(index, isChecked) {
    universalUIModel.Children[index].Interactive = isChecked;
    renderSimulator();
}

document.addEventListener('DOMContentLoaded', () => {
    renderSimulator();
    renderSidebar();
});
