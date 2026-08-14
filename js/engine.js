// --- SELF-REPORTING VERSION ---
const ENGINE_JS_VERSION = "1.3";

// --- GLOBAL STATE ---
let universalUIModel = {
    Title: "My Custom Tool",
    Theme: "winforms", // Default to WinForms
    Children: []
};

let selectedControlIndex = null;

// --- SETTINGS MODAL LOGIC (The Interrogator) ---
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
        Options: type === 'ComboBox' ? 'Item 1, Item 2, Item 3' : undefined,
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
    
    // Apply the selected Theme to the workspace
    workspace.className = `theme-${universalUIModel.Theme}`;
    
    canvas.setAttribute('data-title', universalUIModel.Title);
    canvas.innerHTML = '';
    
    universalUIModel.Children.forEach((control, index) => {
        let el = document.createElement('div');
        el.className = 'canvas-element';
        if (index === selectedControlIndex) el.classList.add('selected-element');
        
        el.onclick = (e) => {
            e.stopPropagation();
            selectControl(index);
        };

        if (control.Type === "Button") {
            el.innerHTML = `<button type="button" style="width:100%; padding: 5px; cursor: pointer;">${control.Text}</button>`;
        } else if (control.Type === "TextBox") {
            el.innerHTML = `<input type="text" style="width:100%;" value="${control.Text}" readonly>`;
        } else if (control.Type === "Label") {
            el.innerHTML = `<label>${control.Text}</label>`;
        } else if (control.Type === "CheckBox") {
            el.innerHTML = `<div><input type="checkbox" disabled> <label style="display:inline;">${control.Text}</label></div>`;
        } else if (control.Type === "ComboBox") {
            // Parse comma-separated options
            const optionsHtml = (control.Options || '').split(',').map(opt => `<option>${opt.trim()}</option>`).join('');
            el.innerHTML = `<select style="width:100%; padding:3px;">${optionsHtml}</select>`;
        }
        
        canvas.appendChild(el);
    });

    // Clicking empty canvas deselects and shows Form Properties
    canvas.onclick = () => {
        selectedControlIndex = null;
        renderSimulator();
        renderPropertiesPanel();
    };
}

function renderPropertiesPanel() {
    const propsContent = document.getElementById('props-content');
    
    // IF NO CONTROL IS SELECTED: Show Form Properties
    if (selectedControlIndex === null) {
        propsContent.innerHTML = `
            <div style="padding: 10px 15px; background: #333; color: #4af626; font-size: 0.9em; text-transform: uppercase;">Form Properties</div>
            <div class="prop-group">
                <label>Window Title</label>
                <input type="text" value="${universalUIModel.Title}" onkeyup="updateFormProperty('Title', this.value)">
            </div>
            <div class="prop-group">
                <label>Rendering Theme (Output Type)</label>
                <select onchange="updateFormProperty('Theme', this.value)">
                    <option value="winforms" ${universalUIModel.Theme === 'winforms' ? 'selected' : ''}>PowerShell WinForms</option>
                    <option value="wpf" ${universalUIModel.Theme === 'wpf' ? 'selected' : ''}>PowerShell WPF</option>
                    <option value="html" ${universalUIModel.Theme === 'html' ? 'selected' : ''}>HTML / Web Form</option>
                </select>
            </div>
            <div style="padding: 15px; color: #888; font-size: 0.9em;">Click an element on the canvas to edit its specific properties.</div>
        `;
        return;
    }

    // IF CONTROL IS SELECTED: Show Control Properties
    const control = universalUIModel.Children[selectedControlIndex];
    
    let html = `
        <div style="padding: 10px 15px; background: #333; color: #0078d4; font-size: 0.9em; text-transform: uppercase;">Control Properties</div>
        <div class="prop-group">
            <label>Type</label>
            <input type="text" value="${control.Type}" disabled style="color:#888;">
        </div>
        <div class="prop-group">
            <label>Name (ID)</label>
            <input type="text" value="${control.Name}" onkeyup="updateControlProperty('Name', this.value)">
        </div>
        <div class="prop-group">
            <label>Text / Label</label>
            <input type="text" value="${control.Text}" onkeyup="updateControlProperty('Text', this.value)">
        </div>
    `;

    if (control.Type === "ComboBox") {
        html += `
        <div class="prop-group">
            <label>Dropdown Options (Comma separated)</label>
            <input type="text" value="${control.Options}" onkeyup="updateControlProperty('Options', this.value)">
        </div>`;
    }

    if (control.Type === "Button") {
        html += `
        <div class="prop-group">
            <label>OnClick Action (PowerShell script)</label>
            <textarea onkeyup="updateControlProperty('Action', this.value)">${control.Action}</textarea>
        </div>`;
    }

    // Add Delete Button at the bottom
    html += `
        <div class="prop-group" style="border-bottom: none;">
            <button class="tool-btn danger-btn" onclick="deleteSelectedControl()">🗑️ Delete Element</button>
        </div>
    `;

    propsContent.innerHTML = html;
}

// Update properties on the Universal Model itself
function updateFormProperty(property, value) {
    universalUIModel[property] = value;
    renderSimulator();
}

function updateControlProperty(property, value) {
    if (selectedControlIndex !== null) {
        universalUIModel.Children[selectedControlIndex][property] = value;
        renderSimulator(); // Instantly update the visual canvas
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    renderSimulator();
    renderPropertiesPanel(); // Show Form properties by default on load
});
