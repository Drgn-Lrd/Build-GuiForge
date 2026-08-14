// --- SELF-REPORTING VERSION ---
const ENGINE_JS_VERSION = "1.2";

// --- GLOBAL STATE ---
let universalUIModel = {
    Title: "My Custom Tool",
    Children: []
};

let selectedControlIndex = null;

// --- SETTINGS MODAL LOGIC (The Interrogator) ---
function openSettings() {
    const list = document.getElementById('version-list-container');
    list.innerHTML = '';
    
    // 1. Pull HTML Version from the DOM
    const htmlMeta = document.getElementById('html-version');
    const htmlVer = htmlMeta ? htmlMeta.getAttribute('content') : "Unknown";
    list.innerHTML += `<li>index.html <span style="color:#888;">[version ${htmlVer}]</span></li>`;

    // 2. Pull JS Version from the loaded script
    list.innerHTML += `<li>js/engine.js <span style="color:#888;">[version ${ENGINE_JS_VERSION}]</span></li>`;

    // 3. Pull CSS Version from the computed styles
    const rootStyles = getComputedStyle(document.documentElement);
    let winformsVer = rootStyles.getPropertyValue('--winforms-css-version').trim();
    // Clean up extra quotes if present
    winformsVer = winformsVer.replace(/^["']|["']$/g, '') || "Unknown or Not Loaded";
    list.innerHTML += `<li>css/winforms.css <span style="color:#888;">[version ${winformsVer}]</span></li>`;

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

function renderSimulator() {
    const canvas = document.getElementById('live-preview-canvas');
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
            el.innerHTML = `<select style="width:100%; padding:3px;"><option>${control.Text}</option></select>`;
        }
        
        canvas.appendChild(el);
    });

    canvas.onclick = () => {
        selectedControlIndex = null;
        renderSimulator();
        renderPropertiesPanel();
    };
}

function renderPropertiesPanel() {
    const propsContent = document.getElementById('props-content');
    
    if (selectedControlIndex === null) {
        propsContent.innerHTML = '<div style="padding: 15px; color: #888;">Select an element on the canvas to edit its properties.</div>';
        return;
    }

    const control = universalUIModel.Children[selectedControlIndex];
    
    let html = `
        <div class="prop-group">
            <label>Type</label>
            <input type="text" value="${control.Type}" disabled style="color:#888;">
        </div>
        <div class="prop-group">
            <label>Name (ID)</label>
            <input type="text" id="prop-name" value="${control.Name}" onkeyup="updateControlProperty('Name', this.value)">
        </div>
        <div class="prop-group">
            <label>Text / Label</label>
            <input type="text" id="prop-text" value="${control.Text}" onkeyup="updateControlProperty('Text', this.value)">
        </div>
    `;

    if (control.Type === "Button") {
        html += `
        <div class="prop-group">
            <label>OnClick Action (PowerShell)</label>
            <textarea id="prop-action" onkeyup="updateControlProperty('Action', this.value)">${control.Action}</textarea>
        </div>`;
    }

    propsContent.innerHTML = html;
}

function updateControlProperty(property, value) {
    if (selectedControlIndex !== null) {
        universalUIModel.Children[selectedControlIndex][property] = value;
        if (property === 'Text') renderSimulator();
    }
}

document.addEventListener('DOMContentLoaded', renderSimulator);
