// --- SELF-REPORTING VERSION ---
const ENGINE_JS_VERSION = "1.4";

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
        Text: `New ${type}`,
        X: 30 + (universalUIModel.Children.length * 15),
        Y: 30 + (universalUIModel.Children.length * 35),
        Options: type === 'Dropdown' ? 'Item 1, Item 2, Item 3' : undefined,
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
        
        el.style.left = `${control.X}px`;
        el.style.top = `${control.Y}px`;
        
        // Mouse drag event binding
        el.onmousedown = (e) => {
            e.stopPropagation();
            selectControl(index);
            isDragging = true;
            const rect = el.getBoundingClientRect();
            dragOffset.x = e.clientX - rect.left;
            dragOffset.y = e.clientY - rect.top;
        };

        if (control.Type === "Button") {
            el.innerHTML = `<button type="button">${control.Text}</button>`;
        } else if (control.Type === "TextBox") {
            el.innerHTML = `<input type="text" value="${control.Text}" readonly>`;
        } else if (control.Type === "Label") {
            el.innerHTML = `<label>${control.Text}</label>`;
        } else if (control.Type === "CheckBox") {
            el.innerHTML = `<div style="display:flex; align-items:center;"><input type="checkbox" disabled> <label>${control.Text}</label></div>`;
        } else if (control.Type === "Dropdown") {
            const optionsHtml = (control.Options || '').split(',').map(opt => `<option>${opt.trim()}</option>`).join('');
            el.innerHTML = `<select>${optionsHtml}</select>`;
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

// Global mouse drag tracking
document.onmousemove = (e) => {
    if (!isDragging || selectedControlIndex === null) return;
    const canvas = document.getElementById('live-preview-canvas');
    const rect = canvas.getBoundingClientRect();
    
    let newX = e.clientX - rect.left - dragOffset.x;
    let newY = e.clientY - rect.top - dragOffset.y;
    
    // Boundary constraints inside the form canvas
    newX = Math.max(0, Math.min(newX, canvas.clientWidth - 100));
    newY = Math.max(0, Math.min(newY, canvas.clientHeight - 30));
    
    universalUIModel.Children[selectedControlIndex].X = Math.round(newX);
    universalUIModel.Children[selectedControlIndex].Y = Math.round(newY);
    
    // Move element live without destroying DOM focus
    const el = document.getElementsByClassName('canvas-element')[selectedControlIndex];
    if (el) {
        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
    }
    
    // Update X/Y input values in properties panel if open
    const inputX = document.getElementById('prop-x');
    const inputY = document.getElementById('prop-y');
    if (inputX) inputX.value = Math.round(newX);
    if (inputY) inputY.value = Math.round(newY);
};

document.onmouseup = () => {
    isDragging = false;
};

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
        <div style="display:flex;">
            <div class="prop-group" style="flex:1;">
                <label>X Pos</label>
                <input type="number" id="prop-x" value="${control.X}" oninput="updateControlCoordinate('X', this.value)">
            </div>
            <div class="prop-group" style="flex:1;">
                <label>Y Pos</label>
                <input type="number" id="prop-y" value="${control.Y}" oninput="updateControlCoordinate('Y', this.value)">
            </div>
        </div>
        ${control.Type === 'Dropdown' ? `
        <div class="prop-group">
            <label>Dropdown Options (Comma separated)</label>
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
        // Only re-render if text or options change, avoiding full loss of text input focus
        if (property === 'Text' || property === 'Options') {
            renderSimulator();
        }
    }
}

function updateControlCoordinate(axis, value) {
    if (selectedControlIndex !== null) {
        const val = parseInt(value) || 0;
        universalUIModel.Children[selectedControlIndex][axis] = val;
        const el = document.getElementsByClassName('canvas-element')[selectedControlIndex];
        if (el) {
            el.style[axis === 'X' ? 'left' : 'top'] = `${val}px`;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    renderSimulator();
    renderPropertiesPanel();
});
