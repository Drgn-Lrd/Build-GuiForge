// --- SELF-REPORTING VERSION ---
const ENGINE_JS_VERSION = "1.7";

// --- GLOBAL STATE ---
let universalUIModel = {
    Title: "My Custom Tool",
    Theme: "winforms",
    ShowControlBox: true,
    Width: 650,
    Height: 450,
    Tabs: [
        { Title: "General", Children: [] },
        { Title: "Advanced", Children: [] }
    ],
    ActiveTab: 0,
    GlobalMenu: "File, Edit, View, Help"
};

let selectedControlIndex = null;
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

// --- CORE ENGINE LOGIC ---
function addControl(type) {
    const activeChildren = universalUIModel.Tabs[universalUIModel.ActiveTab].Children;
    const newControl = {
        Type: type,
        Name: `${type}${activeChildren.length + 1}`,
        Text: type === 'MenuBar' ? 'File, Edit, Help' : `New ${type}`,
        X: 20 + (activeChildren.length * 10),
        Y: 20 + (activeChildren.length * 25),
        Width: 150,
        Height: type === 'TextBox' || type === 'Dropdown' ? 24 : 30,
        Interactive: false,
        Options: type === 'Dropdown' || type === 'MenuBar' ? 'Item 1, Item 2, Item 3' : undefined,
        Action: type === 'Button' ? '# Enter PowerShell code here...\nWrite-Host "Clicked!"' : ''
    };
    
    activeChildren.push(newControl);
    renderSimulator();
    selectControl(activeChildren.length - 1);
}

function selectControl(index) {
    selectedControlIndex = index;
    renderSimulator();
    renderPropertiesPanel();
}

function deleteSelectedControl() {
    if (selectedControlIndex !== null) {
        universalUIModel.Tabs[universalUIModel.ActiveTab].Children.splice(selectedControlIndex, 1);
        selectedControlIndex = null;
        renderSimulator();
        renderPropertiesPanel();
    }
}

function addTab() {
    universalUIModel.Tabs.push({ Title: `Tab ${universalUIModel.Tabs.length + 1}`, Children: [] });
    universalUIModel.ActiveTab = universalUIModel.Tabs.length - 1;
    selectedControlIndex = null;
    renderSimulator();
    renderPropertiesPanel();
}

function renderSimulator() {
    const workspace = document.getElementById('workspace');
    const canvas = document.getElementById('live-preview-canvas');
    
    workspace.className = `theme-${universalUIModel.Theme}`;
    canvas.style.width = `${universalUIModel.Width}px`;
    canvas.style.height = `${universalUIModel.Height}px`;
    
    let canvasInnerHtml = `<div class="window-frame" data-title="${universalUIModel.Title}" style="position:relative; width:100%; height:100%;">`;
    
    if (universalUIModel.ShowControlBox && universalUIModel.Theme !== 'html') {
        canvasInnerHtml += `
            <div class="window-controls">
                <button class="win-btn">_</button>
                <button class="win-btn">□</button>
                <button class="win-btn">×</button>
            </div>`;
    }

    // Global Top Menu Bar if specified
    if (universalUIModel.GlobalMenu) {
        const menus = universalUIModel.GlobalMenu.split(',').map(m => `<span>${m.trim()}</span>`).join('');
        canvasInnerHtml += `<div class="menu-bar">${menus}</div>`;
    }

    // Render Tabs Structure
    canvasInnerHtml += `<div class="tab-container"><div class="tab-headers">`;
    universalUIModel.Tabs.forEach((tab, tIdx) => {
        canvasInnerHtml += `<div class="tab-header-btn ${tIdx === universalUIModel.ActiveTab ? 'active' : ''}" onclick="switchTab(${tIdx})">${tab.Title}</div>`;
    });
    canvasInnerHtml += `<button onclick="addTab()" style="padding:2px 8px; margin:2px; cursor:pointer;">+</button></div>`;

    // Active Tab Content Pane
    canvasInnerHtml += `<div class="tab-content-pane active" id="active-tab-pane"></div></div></div>`;
    canvas.innerHTML = canvasInnerHtml;

    // Inject active tab controls
    const pane = document.getElementById('active-tab-pane');
    const activeChildren = universalUIModel.Tabs[universalUIModel.ActiveTab].Children;

    activeChildren.forEach((control, index) => {
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
            
            const paneRect = pane.getBoundingClientRect();
            dragOffset.x = (e.clientX - paneRect.left) - control.X;
            dragOffset.y = (e.clientY - paneRect.top) - control.Y;
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
            el.innerHTML = `<div style="display:flex; align-items:center; width:100%; height:100%;"><input type="radio" name="group_tab"> <label>${control.Text}</label></div>`;
        } else if (control.Type === "Dropdown") {
            const optionsHtml = (control.Options || '').split(',').map(opt => `<option>${opt.trim()}</option>`).join('');
            el.innerHTML = `<select style="width:100%; height:100%;">${optionsHtml}</select>`;
        } else if (control.Type === "MenuBar") {
            const menusHtml = (control.Options || control.Text || '').split(',').map(m => `<span>${m.trim()}</span>`).join('');
            el.innerHTML = `<div class="menu-bar" style="width:100%; height:100%;">${menusHtml}</div>`;
        }
        
        pane.appendChild(el);
    });

    pane.onclick = (e) => {
        if (e.target === pane) {
            selectedControlIndex = null;
            renderSimulator();
            renderPropertiesPanel();
        }
    };
}

function switchTab(index) {
    universalUIModel.ActiveTab = index;
    selectedControlIndex = null;
    renderSimulator();
    renderPropertiesPanel();
}

document.onmousemove = (e) => {
    if (!isDragging || selectedControlIndex === null) return;
    const pane = document.getElementById('active-tab-pane');
    if (!pane) return;
    const paneRect = pane.getBoundingClientRect();
    
    let newX = (e.clientX - paneRect.left) - dragOffset.x;
    let newY = (e.clientY - paneRect.top) - dragOffset.y;
    
    newX = Math.max(0, Math.min(newX, pane.clientWidth - 50));
    newY = Math.max(0, Math.min(newY, pane.clientHeight - 20));
    
    const activeChildren = universalUIModel.Tabs[universalUIModel.ActiveTab].Children;
    activeChildren[selectedControlIndex].X = Math.round(newX);
    activeChildren[selectedControlIndex].Y = Math.round(newY);
    
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
        const activeChildren = universalUIModel.Tabs[universalUIModel.ActiveTab].Children;
        const control = activeChildren[selectedControlIndex];
        const pane = document.getElementById('active-tab-pane');
        
        control.X = Math.max(0, Math.min(control.X + dx, pane.clientWidth - 50));
        control.Y = Math.max(0, Math.min(control.Y + dy, pane.clientHeight - 20));
        
        renderSimulator();
        renderPropertiesPanel();
    }
}

function renderPropertiesPanel() {
    const propsContent = document.getElementById('props-content');
    
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
                <label>Global Top Menu Bar Items (Comma separated)</label>
                <input type="text" value="${universalUIModel.GlobalMenu}" oninput="updateFormProperty('GlobalMenu', this.value)">
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

    const control = universalUIModel.Tabs[universalUIModel.ActiveTab].Children[selectedControlIndex];
    
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
        ${control.Type === 'Dropdown' || control.Type === 'MenuBar' ? `
        <div class="prop-group">
            <label>Options / Items (Comma separated)</label>
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

function updateFormProperty(property, value) {
    universalUIModel[property] = value;
    renderSimulator();
}

function updateControlProperty(property, value) {
    if (selectedControlIndex !== null) {
        const activeChildren = universalUIModel.Tabs[universalUIModel.ActiveTab].Children;
        activeChildren[selectedControlIndex][property] = value;
        if (property === 'Text' || property === 'Options') {
            renderSimulator();
        }
    }
}

function updateControlDimension(dimension, value) {
    if (selectedControlIndex !== null) {
        const activeChildren = universalUIModel.Tabs[universalUIModel.ActiveTab].Children;
        activeChildren[selectedControlIndex][dimension] = Math.max(20, parseInt(value) || 50);
        renderSimulator();
    }
}

function toggleInteractive(index, isChecked) {
    const activeChildren = universalUIModel.Tabs[universalUIModel.ActiveTab].Children;
    activeChildren[index].Interactive = isChecked;
    renderSimulator();
}

document.addEventListener('DOMContentLoaded', () => {
    renderSimulator();
    renderPropertiesPanel();
});
