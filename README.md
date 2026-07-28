# Legcord Download Manager

A native [Legcord](https://github.com/Legcord/Legcord) plugin that routes Discord downloads through Browser, Gopeed, or Internet Download Manager (IDM).

Author: [Anurag Rai (Dark-Matter7232)](https://github.com/Dark-Matter7232)

## Features

- Routes downloads through Browser, Gopeed, or IDM
- Captures Discord download headers and cookies when available
- Displays the selected backend in the Download Manager pill
- Shows the configuration pill automatically on fresh installs
- Lets users hide the pill after configuration
- Falls back to the normal Legcord download flow when routing fails

## Requirements

- Legcord with native plugin support
- `Settings -> Advanced -> Show experimental plugin menu` enabled
- `Extended plugin abilities` enabled in Legcord settings to save settings from the plugin UI
- Windows for IDM support
- Gopeed installed and running for Gopeed downloads

## Installation

1. Download or clone this repository.
2. Copy the plugin folder to Legcord's plugins directory:

   `%APPDATA%\legcord\plugins\download-manager-plugin`

3. Open Legcord and go to `Settings -> Advanced`.
4. Enable `Show experimental plugin menu`.
5. Open `Settings -> Plugins`.
6. Enable `Download Manager Plugin`.
7. Restart Legcord if the Plugins section or Download Manager pill does not appear.

## First-Time Setup

Fresh installs show the `Download Manager` pill automatically.

1. Click the pill.
2. Enable `Extended plugin abilities` in Legcord settings if saving is disabled.
3. Select Browser, Gopeed, or IDM and save.
4. Optionally select `Do not show plugin pill on next launch` before saving.

After the pill is hidden, edit `config.json` and set `ui.showPill` to `true`, then reload Legcord:

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

The pill displays the active backend, for example `Download Manager: Gopeed` or `Download Manager: IDM`.

## Configuration

The bundled `config.json` is the authoritative configuration. Supported values are:

- `manager`: `browser`, `gopeed`, or `idm`
- `ui.showPill`: `true` or `false`
- `gopeed.host`: Gopeed API host
- `gopeed.token`: optional Gopeed API token

After manually editing `config.json`, reload the plugin or restart Legcord. Selecting a backend in the pill writes the normalized configuration and synchronizes Legcord's required internal plugin-storage copy.

## Supported Backends

### Browser

Uses Legcord's normal download behavior without interception.

### Gopeed

Routes downloads through Gopeed's local API or deep link. The default API host is `http://127.0.0.1:9999`.

### Internet Download Manager

Routes downloads through IDM on Windows using the bundled PowerShell helpers. The helper locates IDM through the Windows registry and standard installation paths.

## Troubleshooting

- If the Plugins page is missing, enable `Show experimental plugin menu` under `Settings -> Advanced`, then restart Legcord.
- If saving fails, enable `Extended plugin abilities` and reopen the Download Manager pill.
- If the pill is hidden, set `ui.showPill` to `true` in `config.json` and reload Legcord.
- If Gopeed routing fails, confirm Gopeed is running and the configured API host is reachable.
- If IDM routing fails, confirm IDM is installed and available on Windows.

## Legcord Plugin Bridge

The current Legcord bridge exposes scoped filesystem methods and plugin lifecycle methods. Filesystem access is gated by `Extended plugin abilities` and cannot directly write the installed plugin directory, so the plugin keeps Legcord's internal storage copy synchronized with the bundled `config.json`.

## License

This project is licensed under the [MIT License](LICENSE).
