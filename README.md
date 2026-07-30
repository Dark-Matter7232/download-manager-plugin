# Legcord Download Manager

A native plugin for [Legcord](https://github.com/Legcord/Legcord) that seamlessly routes your Discord file downloads directly to **Gopeed**, **Internet Download Manager (IDM)**, or your default **Browser**.

Author: [Anurag Rai (Dark-Matter7232)](https://github.com/Dark-Matter7232)

---

## 🌟 Features

- **Seamless Interception**: Automatically catches file downloads from Discord chats, external link clicks, and popups.
- **Protected Download Support**: Passes session cookies and headers so protected or private links download without authorization errors.
- **Smart Link Detection**: Automatically detects files by extension (`.zip`, `.exe`, `.pdf`, `.mp4`, etc.) and download links (`?dl=1`, GitHub releases).
- **Easy Settings UI**: Change backends on the fly using the built-in Download Manager pill or settings menu.
- **Reliable Fallback**: If Gopeed or IDM is closed, downloads fall back safely to Legcord's default browser flow.

---

## ⚡ Supported Download Managers

| Manager | Compatibility | Description |
| :--- | :--- | :--- |
| **Browser** | All Platforms | Standard Legcord/Chromium download handler. |
| **Gopeed** | Windows / macOS / Linux | Connects directly to Gopeed's REST API for fast, cross-platform downloads. |
| **IDM** | Windows | Integrates directly with Internet Download Manager on Windows. |

---

## 🚀 Quick Setup

### 1. Requirements

- **Legcord** with native plugin support enabled.
- **Gopeed** (if using Gopeed) installed and running.
- **IDM** (if using Internet Download Manager) installed on Windows.

### 2. Installation

1. Download or clone this repository.
2. Move the plugin folder into Legcord's plugins directory:
   - **Windows**: `%APPDATA%\legcord\plugins\download-manager-plugin`
   - **Linux**: `~/.config/legcord/plugins/download-manager-plugin`
   - **macOS**: `~/Library/Application Support/legcord/plugins/download-manager-plugin`
3. Open Legcord and navigate to **Settings → Advanced**.
4. Enable **Show experimental plugin menu** and **Extended plugin abilities**.
5. Go to **Settings → Plugins**, enable **Download Manager Plugin**, and restart Legcord.

---

## ⚙️ Configuration

You can configure the plugin in two ways:

### Via the In-App UI (Recommended)
Click the **Download Manager** status pill at the top of Legcord to select your manager, enter your Gopeed API host/token (if applicable), and save.

### Via `config.json`
You can also edit `config.json` directly in the plugin directory:

```json
{
    "manager": "gopeed",
    "ui": {
        "showPill": true
    },
    "gopeed": {
        "host": "http://127.0.0.1:9999",
        "token": ""
    }
}
```

- **`manager`**: `"browser"`, `"gopeed"`, or `"idm"`
- **`ui.showPill`**: `true` to display the status pill, or `false` to hide it.
- **`gopeed.host`**: Gopeed API server address (default: `http://127.0.0.1:9999`).
- **`gopeed.token`**: Optional API token if authentication is enabled in Gopeed.

---

## 🔍 How It Works

The plugin monitors download requests within Legcord. When a file link is clicked:

1. **Fast Match**: The link is checked against known file extensions and download query patterns.
2. **Smart Inspection**: For ambiguous links, the plugin sends a fast header request to verify if the server returns a download payload (`Content-Disposition: attachment` or binary file type).
3. **Handoff**: The file URL, along with necessary browser session headers, is sent to your selected manager (Gopeed API or IDM helper).

---

## 📁 Intercepted File Types

The plugin automatically intercepts common download file types, including:

- **Archives**: `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.iso`, `.dmg`
- **Executables**: `.exe`, `.msi`, `.deb`, `.rpm`, `.appimage`, `.apk`
- **Media**: `.mp4`, `.mkv`, `.avi`, `.mp3`, `.flac`, `.wav`
- **Documents**: `.pdf`, `.epub`, `.mobi`, `.djvu`
- **Other**: `.torrent`, `.patch`, `.bin`

*(Links containing parameters like `?download=1`, `?attachment=1`, or paths like `/releases/download/` are also intercepted automatically.)*

---

## ❓ Troubleshooting

- **Plugins menu is missing**: Ensure `Show experimental plugin menu` is turned on under `Settings -> Advanced`, then restart Legcord.
- **Settings will not save**: Turn on `Extended plugin abilities` in Legcord's settings so the plugin has permission to write configuration.
- **Pill disappeared**: Edit `config.json`, set `"showPill": true`, and reload Legcord.
- **Gopeed not queuing downloads**: Verify Gopeed is open and the API host in plugin settings matches Gopeed (`http://127.0.0.1:9999`).
- **IDM not queuing downloads**: Confirm IDM is installed on Windows.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
