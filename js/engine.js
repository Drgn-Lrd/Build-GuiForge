// The Global State
let universalUIModel = {
    Title: "Untitled Form",
    Children: []
};

// Renders the JSON model into HTML to simulate the GUI
function renderSimulator() {
    const canvas = document.getElementById('live-preview-canvas');
    const jsonOutput = document.getElementById('json-output');
    
    // Update the JSON debug panel
    jsonOutput.textContent = JSON.stringify(universalUIModel, null, 2);
    
    // Set the Window Title for the CSS pseudo-element
    canvas.setAttribute('data-title', universalUIModel.Title);
    
    // Clear the canvas contents entirely
    canvas.innerHTML = '';
    
    // Draw each child element
    universalUIModel.Children.forEach(control => {
        let el;
        if (control.Type === "Label") {
            el = document.createElement('label');
            el.textContent = control.Text;
        } 
        else if (control.Type === "TextBox") {
            el = document.createElement('input');
            el.type = "text";
            el.name = control.Name;
            el.style.width = "100%";
            el.style.boxSizing = "border-box";
        }
        else if (control.Type === "CheckBox") {
            el = document.createElement('div');
            el.innerHTML = `<input type="checkbox" id="${control.Name}"> <label style="display:inline;" for="${control.Name}">${control.Text}</label>`;
        }
        
        if (el) canvas.appendChild(el);
    });
}

// Initial render on load
document.addEventListener('DOMContentLoaded', renderSimulator);
