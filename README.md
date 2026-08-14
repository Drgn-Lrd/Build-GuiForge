# Build-GuiForge

A static, web-based GUI builder with live preview, dynamic command parsing, and BYOK AI integration. Generates UI code from a Universal JSON Model.

## Overview

**Build-GuiForge** is a serverless, static web application designed to rapidly generate Graphical User Interfaces (GUIs). It features a decoupled architecture that separates the UI definition from the rendering layer, allowing you to build a form once and instantly export it to different formats.

By utilizing a **Universal UI JSON Model**, the app provides an interactive HTML canvas that visually simulates desktop environments (like WinForms and WPF) in real-time, right in your browser.

## Key Features

*   **Live Simulated Previews:** Toggle between CSS themes to see what your GUI will look like in WinForms, WPF, or native HTML before generating the code.
*   **Dynamic Command Parsing:** Type in any core cmdlet (e.g., `Get-Process`), and the engine will automatically scrape the PlatyPS schema from Microsoft's GitHub repository to auto-generate a complete form based on the parameters—no local backend required.
*   **Bring Your Own Key (BYOK) AI:** Connect your Gemini or Claude API key via browser `localStorage` to generate complex UIs using natural language prompts without paying for a subscription service.

> **Note on Future Expansion**
> Build-GuiForge is built on an Abstract Syntax Tree (AST) architecture. Because the frontend canvas and AI integrations output to a centralized `Universal UI JSON Model`, the rendering and code-generation engines are entirely modular. While the initial release focuses on generating **PowerShell** code (WinForms/WPF), the engine is designed to be language-agnostic. Future updates will add central launcher support to generate **C#**, **Python (Tkinter/PyQt)**, and other framework UIs from the exact same builder interface.
