async function loadCmdletDocs() {
    const moduleName = document.getElementById('moduleInput').value.trim();
    const cmdletName = document.getElementById('cmdletInput').value.trim();
    
    if (!moduleName || !cmdletName) return alert("Please enter both a module and cmdlet name.");

    // Using PowerShell 7.4 reference docs on GitHub
    const url = `https://raw.githubusercontent.com/MicrosoftDocs/PowerShell-Docs/main/reference/7.4/${moduleName}/${cmdletName}.md`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const markdown = await response.text();
        
        // Reset the Universal Model
        universalUIModel.Title = `${cmdletName} Tool`;
        universalUIModel.Children = [];

        // Regex to find: ### -ParameterName followed eventually by ```yaml ... ```
        const paramRegex = /###\s+-([a-zA-Z0-9]+)[\s\S]*?```yaml([\s\S]*?)```/g;
        let match;
        
        while ((match = paramRegex.exec(markdown)) !== null) {
            const paramName = match[1];
            const yamlBlock = match[2];

            const isSwitch = yamlBlock.includes("Type: System.Management.Automation.SwitchParameter");
            const isRequired = yamlBlock.includes("Required: True");

            if (isSwitch) {
                universalUIModel.Children.push({
                    Type: "CheckBox",
                    Name: `chk_${paramName}`,
                    Text: paramName
                });
            } else {
                let labelText = paramName + (isRequired ? " *" : "");
                universalUIModel.Children.push({ Type: "Label", Text: labelText });
                universalUIModel.Children.push({ Type: "TextBox", Name: `txt_${paramName}` });
            }
        }

        // Trigger the engine to draw the new UI
        renderSimulator();

    } catch (error) {
        console.error("Fetch failed:", error);
        alert(`Failed to load docs for ${cmdletName}. Ensure the module and cmdlet names are exactly as they appear on Microsoft Docs.`);
    }
}
