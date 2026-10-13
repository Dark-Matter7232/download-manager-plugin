const form = document.getElementById("settings-form");
const managerSelect = document.getElementById("manager");
const gopeedFields = document.getElementById("gopeed-fields");
const idmNote = document.getElementById("idm-note");
const hostInput = document.getElementById("gopeed-host");
const tokenInput = document.getElementById("gopeed-token");
const saveButton = document.getElementById("save");
const status = document.getElementById("status");

function updateFields() {
    gopeedFields.hidden = managerSelect.value !== "gopeed";
    idmNote.hidden = managerSelect.value !== "idm";
}

function setStatus(message, isError = false) {
    status.textContent = message;
    status.dataset.error = String(isError);
}

managerSelect.addEventListener("change", updateFields);
document.getElementById("close").addEventListener("click", () => window.close());

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    setStatus("Saving…");
    try {
        const result = await window.downloadManagerSettings.save({
            manager: managerSelect.value,
            gopeed: { host: hostInput.value, token: tokenInput.value },
        });
        if (!result.ok) throw new Error(result.error || "Could not save settings");
        setStatus("Saved. Download routing is updated.");
    } catch (error) {
        setStatus(error.message || "Could not save settings.", true);
    } finally {
        saveButton.disabled = false;
    }
});

async function loadSettings() {
    try {
        const result = await window.downloadManagerSettings.get();
        if (!result.ok) throw new Error(result.error || "Could not load settings");
        const config = result.config;
        managerSelect.value = config.manager;
        hostInput.value = config.gopeed.host;
        tokenInput.value = config.gopeed.token;
        updateFields();
    } catch (error) {
        setStatus(error.message || "Could not load settings.", true);
    }
}

updateFields();
void loadSettings();
