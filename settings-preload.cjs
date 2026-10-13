const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("downloadManagerSettings", {
    get: () => ipcRenderer.invoke("download-manager-plugin:settings:get"),
    save: (config) => ipcRenderer.invoke("download-manager-plugin:settings:save", config),
});
