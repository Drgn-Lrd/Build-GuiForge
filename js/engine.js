// --- SELF-REPORTING VERSION ---
const ENGINE_JS_VERSION = "1.6";

// --- GLOBAL STATE ---
let universalUIModel = {
    Title: "My Custom Tool",
    Theme: "winforms",
    Children: []
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
    const newControl = {
        Type: type,
        Name: `${type}${universalUIModel.Children.length + 1}`,
        Text: type === 'MenuBar' ? 'File, Edit, View, Help' : `New ${type}`,
        X: 20 + (universalUIModel.Children.length * 10),
        Y: 20 + (universalUIModel.Children.length * 30),
        Interactive: false,
        Options: type === 'Dropdown' ? 'Item 1, Item 2, Item 3' : (type === 'MenuBar' ? 'File, Edit, Help' : undefined),
        Action: type === 'Button' ? '# Enter PowerShell code here...\nWrite-Host "Clicked!"' : ''
    };
    
    universalUIModel.Children.push(newControl);
    renderSimulator();
    selectControl(universalUIModel.Children.length - 1);
}

function selectControl(index) {
    selectedControlIndex = index;
    renderSimulator();
    renderPropertiesPanel();
}

function deleteSelectedControl() {
    if (selectedControlIndex !== null) {
        universalUIModel.Children.splice(selectedControlIndex, 1);
        selectedControlIndex = null;
        renderSimulator();
        renderPropertiesPanel();
    }
}

function renderSimulator() {
    const workspace = document.getElementById('workspace');
    const canvas = document.getElementById('live-preview-canvas');
    
    workspace.className = `theme-${universalUIModel.Theme}`;
    canvas.setAttribute('data-title', universalUIModel.Title);
    canvas.innerHTML = '';
    
    universalUIModel.Children.forEach((control, index) => {
        let el = document.createElement('div');
        el.className = 'canvas-element';
        if (index === selectedControlIndex) el.classList.add('selected-element');
        if (control.Interactive) el.classList.add('interactive');
        
        el.style.left = `${control.X}px`;
        el.style.top = `${control.Y}px`;
        
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
            el.innerHTML = `<button type="button">${control.Text}</button>`;
        } else if (control.Type === "TextBox") {
            el.innerHTML = `<input type="text" value="${control.Text}">`;
        } else if (control.Type === "Label") {
            el.innerHTML = `<label>${control.Text}</label>`;
        } else if (control.Type === "CheckBox") {
            el.innerHTML = `<div style="display:flex; align-items:center;"><input type="checkbox"> <label>${control.Text}</label></div>`;
        } else if (control.Type === "RadioButton") {
            el.innerHTML = `<div style="display:flex; align-items:center;"><input type="radio" name="group_${control.Y}"> <label>${control.Text}</label></div>`;
        } else if (control.Type === "Dropdown") {
            const optionsHtml = (control.Options || '').split(',').map(opt => `<option>${opt.trim()}`).join('');
            el.innerHTML = `<select>${optionsHtml}</select>`;
        } else if (control.Type === "MenuBar") {
            const menusHtml = (control.Options || control.Text || '').split(',').map(m => `<span>${m.trim()}</span>`).join('');
            el.innerHTML = `<div class="menu-bar">${menusHtml}</div>`;
        }
        
        canvas.appendChild(el);
    });

    canvas.onclick = (e) => {
        if (e.target === canvas) {
            selectedControlIndex = null;
            renderSimulator();
            renderPropertiesPanel();
        }
    };
}

document.onmousemove = (e) => {
    if (!isDragging || selectedControlIndex === null) return;
    const canvas = document.getElementById('live-preview-canvas');
    const canvasRect = canvas.getBoundingClientRect();
    
    let newX = (e.clientX - canvasRect.left) - dragOffset.x;
    let newY = (e.clientY - canvasRect.top) - dragOffset.y;
    
    newX = Math.max(0, Math.min(newX, canvas.clientWidth - 100));
    newY = Math.max(0, Math.min(newY, canvas.clientHeight - 30));
    
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
        
        control.X = Math.max(0, Math.min(control.X + dx, canvas.clientWidth - 100));
        control.Y = Math.max(0, Math.min(control.Y + dy, canvas.clientHeight - 30));
        
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
            <div style="padding: 15px; color: #888; font-size: 0.9em;">Click an element on the canvas to edit its properties or drag it around.</div>
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
            <label>Position Nudge (X: ${control.X}px, Y: ${control.Y}px)</label>
            <div class="nudge-section">
                <div class="nudge-row">
                    <span style="font-size:0.75em; color:#aaa; width:30px;">1px:</span>
                    <button class="nudge-btn" onclick="nudgeControl(0, -1)">▲ Up</button>
                    <button class="nudge-btn" onclick="nudgeControl(0, 1)">▼ Down</button>
                    <button class="nudge-btn" onclick="nudgeControl(-1, 0)">◀ Left</button>
                    <button class="nudge-btn" onclick="nudgeControl(1, 0)">▶ Right</button>
                </div>
                <div class="nudge-row">
                    <span style="font-size:0.75em; color:#aaa; width:30px;">5px:</span>
                    <button class="nudge-btn" onclick="nudgeControl(0, -5)">▲ Up</button>
                    <button class="nudge-btn" onclick="nudgeControl(0, 5)">▼ Down</button>
                    <button class="nudge-btn" onclick="nudgeControl(-5, 0)">◀ Left</button>
                    <button class="nudge-btn" onclick="nudgeControl(5, 0)">▶ Right</button>
                </div>
                <div class="nudge-row">
                    <span style="font-size:0.75em; color:#aaa; width:30px;">10px:</span>
                    <button class="nudge-btn" onclick="nudgeControl(0, -10)">▲ Up</button>
                    <button class="nudge-btn" onclick="nudgeControl(0, 10)">▼ Down</button>
                    <button class="nudge-btn" onclick="nudgeControl(-10, 0)">◀ Left</button>
                    <button class="nudge-btn" onclick="nudgeControl(10, 0)">▶ Right</button>
                </div>
            </div>
        </div>
        <div class="prop-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" ${control.Interactive ? 'checked' : ''} onchange="toggleInteractive(${selectedControlIndex}, this.checked)" style="width:auto;"> 
                Interact Mode (Test Control)
            </label>
        </div>
        ${control.Type === 'Dropdown' ? `
        <div class="prop-group">
            <label>Dropdown Options (Comma separated)</label>
            <input type="text" value="${control.Options || ''}" oninput="updateControlProperty('Options', this.value)">
        </div>` : ''}
        ${control.Type === 'MenuBar' ? `
        <div class="prop-group">
            <label>Menu Items (Comma separated)</label>
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
        universalUIModel.Children[selectedControlIndex][property] = value;
        if (property === 'Text' || property === 'Options') {
            renderSimulator();
        }
    }
}

function toggleInteractive(index, isChecked) {
    universalUIModel.Children[index].Interactive = isChecked;
    renderSimulator();
}

document.addEventListener('DOMContentLoaded', () => {
    renderSimulator();
    renderPropertiesPanel();
});
