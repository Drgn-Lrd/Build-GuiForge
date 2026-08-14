let universalUIModel = {
    Title: "My Custom Tool",
    Children: []
};

let selectedControlIndex = null;

// 1. Add a new control from the Toolbox
function addControl(type) {
    const newControl = {
        Type: type,
        Name: `${type}${universalUIModel.Children.length + 1}`,
        Text: `New ${type}`,
        Action: type === 'Button' ? '# Enter PowerShell code here...\nWrite-Host "Clicked!"' : ''
    };
    
    universalUIModel.Children.push(newControl);
    renderSimulator();
    selectControl(universalUIModel.Children.length - 1); // Auto-select the new item
}

// 2. Select a control on the canvas to edit
function selectControl(index) {
    selectedControlIndex = index;
    renderSimulator(); // Redraw to show the selection outline
    renderPropertiesPanel();
}

// 3. Draw the Canvas
function renderSimulator() {
    const canvas = document.getElementById('live-preview-canvas');
    canvas.setAttribute('data-title', universalUIModel.Title);
    canvas.innerHTML = '';
    
    universalUIModel.Children.forEach((control, index) => {
        let el = document.createElement('div');
        el.className = 'canvas-element';
        if (index === selectedControlIndex) el.classList.add('selected-element');
        
        // Basic click-to-select binding
        el.onclick = (e) => {
            e.stopPropagation(); // Prevent deselecting
            selectControl(index);
        };

        // Render the visual mockup based on type
        if (control.Type === "Button") {
            el.innerHTML = `<button type="button" style="width:100%; padding: 5px;">${control.Text}</button>`;
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

    // Clicking the empty canvas deselects everything
    canvas.onclick = () => {
        selectedControlIndex = null;
        renderSimulator();
        renderPropertiesPanel();
    };
}

// 4. Populate the Properties Grid for the selected control
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

    // Only show the PowerShell Action block if it's a Button (for now)
    if (control.Type === "Button") {
        html += `
        <div class="prop-group">
            <label>OnClick Action (PowerShell)</label>
            <textarea id="prop-action" onkeyup="updateControlProperty('Action', this.value)">${control.Action}</textarea>
        </div>`;
    }

    propsContent.innerHTML = html;
}

// 5. Live update the JSON model when typing in the Properties Grid
function updateControlProperty(property, value) {
    if (selectedControlIndex !== null) {
        universalUIModel.Children[selectedControlIndex][property] = value;
        
        // Auto-rename if naming convention is needed could go here
        
        // Re-render the canvas immediately if the Text changes
        if (property === 'Text') renderSimulator();
    }
}

// Init
document.addEventListener('DOMContentLoaded', renderSimulator);
