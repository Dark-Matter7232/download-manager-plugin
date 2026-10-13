# Legcord Download Manager

A native plugin for [Legcord](https://github.com/Legcord/Legcord) that seamlessly routes your Discord file downloads directly to **Gopeed**, **Internet Download Manager (IDM)**, or your default **Browser**.

Author: [Anurag Rai (Dark-Matter7232)](https://github.com/Dark-Matter7232)

---

## 🌟 Features

- **Seamless Interception**: Automatically catches file downloads from Discord chats, external link clicks, and popups.
- **Protected Download Support**: Passes the current browser cookies, user agent, and page referrer to the selected manager.
- **Smart Link Detection**: Automatically detects files by extension (`.zip`, `.exe`, `.pdf`, `.mp4`, etc.) and download links (`?dl=1`, GitHub releases).
- **Separate Settings Window**: Configure download routing in a plugin-owned window, outside the Discord page.
- **Reliable Fallback**: If Gopeed or IDM is closed, downloads fall back safely to Legcord's default browser flow.

---

## ⚡ Supported Download Managers

| Manager | Compatibility | Description |
| :--- | :--- | :--- |
| **Browser** | All Platforms | Standard Legcord/Chromium download handler. |
| **Gopeed** | Windows / macOS / Linux | Opens Gopeed's create-task window with the URL and request headers ready for review. |
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
3. Open Legcord, go to **Settings → Plugins**, and enable **Download Manager Plugin**.
4. Select **Reload** on the plugin card to open its settings window.

---

## ⚙️ Configuration

You can configure the plugin in two ways:

### Via the Settings Window (Recommended)
Open **Settings → Plugins** and select **Reload** on the Download Manager plugin card. This opens the plugin's separate settings window. Saving applies the routing settings immediately.

### Via the Runtime Settings File
The plugin stores settings only at
`<userData>/plugin-storage/download-manager-plugin/config.json`. This file in
Legcord's plugin storage is the sole source of truth. If it does not exist, the
plugin creates it there with default settings.

```json
{
    "manager": "gopeed"
}
```

- **`manager`**: `"browser"`, `"gopeed"`, or `"idm"`

Gopeed handoff uses its registered `gopeed:///create` link to open the task
form for review. No Gopeed REST API setup is needed.

---

## 🔍 How It Works

The plugin monitors download requests within Legcord. When a file link is clicked:

1. **Fast Match**: The link is checked against known file extensions and download query patterns.
2. **Smart Inspection**: For ambiguous links, the plugin sends a fast header request to verify if the server returns a download payload (`Content-Disposition: attachment` or binary file type).
3. **Handoff**: The file URL, current browser cookies, user agent, and page referrer are passed to Gopeed's create-task window for review, or to the IDM helper.

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
- **Settings window did not open**: Go to **Settings → Plugins** and select **Reload** on the Download Manager plugin card.
- **Gopeed task window not opening**: Confirm Gopeed is installed and its `gopeed://` link handler is registered with the operating system.
- **IDM not queuing downloads**: Confirm IDM is installed on Windows.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
