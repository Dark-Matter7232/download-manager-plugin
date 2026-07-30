const PLUGIN_ID = "download-manager-plugin";
const STYLE_ID = "download-manager-plugin-style";
const BUTTON_ID = "download-manager-plugin-button";
const MODAL_ID = "download-manager-plugin-modal";
const DEFAULT_CONFIG = {
    manager: "browser",
    ui: {
        showPill: true,
    },
    gopeed: {
        host: "http://127.0.0.1:9999",
        token: "",
    },
};

function normalizeConfig(parsed) {
    return {
        manager: parsed?.manager === "gopeed" || parsed?.manager === "idm" ? parsed.manager : "browser",
        ui: {
            showPill: parsed?.ui?.showPill === true,
        },
        gopeed: {
            host:
                typeof parsed?.gopeed?.host === "string" && parsed.gopeed.host.trim().length > 0
                    ? parsed.gopeed.host
                    : DEFAULT_CONFIG.gopeed.host,
            token: typeof parsed?.gopeed?.token === "string" ? parsed.gopeed.token : "",
        },
    };
}

async function loadConfig() {
    try {
        const result = await window.legcord.fs.readFile(PLUGIN_ID, "config.json");
        if (!result.ok) {
            return structuredClone(DEFAULT_CONFIG);
        }
        return normalizeConfig(JSON.parse(result.data));
    } catch {
        return structuredClone(DEFAULT_CONFIG);
    }
}

async function saveConfig(config) {
    try {
        return await window.legcord.fs.writeFile(PLUGIN_ID, "config.json", `${JSON.stringify(config, null, 4)}\n`);
    } catch (error) {
        return { ok: false, error: error?.message ?? "Unknown config write error" };
    }
}

function hasExtendedPluginAbilitiesEnabled() {
    try {
        const settings = window.legcord.settings.getConfig();
        return Boolean(settings.extendedPluginAbilities);
    } catch {
        return false;
    }
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getManagerLabel(manager) {
    if (manager === "gopeed") return "Gopeed";
    if (manager === "idm") return "IDM";
    return "Browser";
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        @keyframes dm-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes dm-scale-up {
            from { transform: scale(0.95); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
        #${BUTTON_ID} {
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 2147483645;
            border: 0;
            border-radius: 999px;
            background: linear-gradient(135deg, #5865F2, #404eed);
            color: white;
            font: 600 13px/1.2 "Segoe UI", sans-serif;
            padding: 12px 18px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
            cursor: pointer;
            transition: all 0.2s ease-in-out;
        }
        #${BUTTON_ID}:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 28px rgba(88, 101, 242, 0.4);
            filter: brightness(1.1);
        }
        #${BUTTON_ID}:active {
            transform: translateY(0);
        }
        #${MODAL_ID} {
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(8, 10, 16, 0.72);
            backdrop-filter: blur(6px);
        }
        #${MODAL_ID}[data-open="true"] {
            display: flex;
            animation: dm-fade-in 0.2s ease-out forwards;
        }
        #${MODAL_ID} .dm-card {
            width: min(560px, calc(100vw - 32px));
            max-height: calc(100vh - 32px);
            overflow: auto;
            border-radius: 20px;
            background: #18191c;
            color: #f9fafb;
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
            border: 1px solid rgba(255, 255, 255, 0.08);
            padding: 24px;
            font-family: "Segoe UI", sans-serif;
        }
        #${MODAL_ID}[data-open="true"] .dm-card {
            animation: dm-scale-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        #${MODAL_ID} h2 {
            margin: 0 0 8px;
            font-size: 24px;
            font-weight: 700;
        }
        #${MODAL_ID} p,
        #${MODAL_ID} label,
        #${MODAL_ID} input,
        #${MODAL_ID} button {
            font-family: "Segoe UI", sans-serif;
        }
        #${MODAL_ID} .dm-subtle {
            color: #b9bbbe;
            margin: 0 0 20px;
            line-height: 1.45;
            font-size: 14px;
        }
        #${MODAL_ID} .dm-stack {
            display: grid;
            gap: 14px;
        }
        #${MODAL_ID} .dm-choice {
            display: grid;
            gap: 6px;
            padding: 14px 16px;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.07);
            transition: all 0.2s ease-in-out;
            cursor: pointer;
        }
        #${MODAL_ID} .dm-choice:hover {
            background: rgba(255, 255, 255, 0.07);
            border-color: rgba(255, 255, 255, 0.15);
        }
        #${MODAL_ID} .dm-choice:has(input[type="radio"]:checked) {
            background: rgba(88, 101, 242, 0.08);
            border-color: rgba(88, 101, 242, 0.4);
        }
        #${MODAL_ID} .dm-choice-row {
            display: flex;
            gap: 10px;
            align-items: center;
            font-weight: 600;
            cursor: pointer;
        }
        #${MODAL_ID} .dm-choice-note {
            color: #b9bbbe;
            font-size: 13px;
            line-height: 1.4;
            padding-left: 24px;
        }
        #${MODAL_ID} .dm-fields {
            display: grid;
            gap: 12px;
            margin-top: 10px;
            padding-left: 24px;
        }
        #${MODAL_ID} .dm-field {
            display: grid;
            gap: 6px;
        }
        #${MODAL_ID} .dm-field label {
            font-size: 13px;
            color: #d7deea;
            font-weight: 500;
        }
        #${MODAL_ID} .dm-field input {
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(0, 0, 0, 0.2);
            color: white;
            padding: 11px 12px;
            border-radius: 12px;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        #${MODAL_ID} .dm-field input:focus {
            border-color: #5865F2;
            box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.25);
        }
        #${MODAL_ID} .dm-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 22px;
        }
        #${MODAL_ID} .dm-actions button {
            border: 0;
            border-radius: 12px;
            padding: 11px 16px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s ease-in-out;
        }
        #${MODAL_ID} .dm-secondary {
            background: rgba(255, 255, 255, 0.08);
            color: white;
        }
        #${MODAL_ID} .dm-secondary:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        #${MODAL_ID} .dm-primary {
            background: linear-gradient(135deg, #5865F2, #404eed);
            color: white;
        }
        #${MODAL_ID} .dm-primary:hover {
            filter: brightness(1.15);
            box-shadow: 0 4px 12px rgba(88, 101, 242, 0.35);
        }
        #${MODAL_ID} .dm-status {
            min-height: 20px;
            margin-top: 12px;
            color: #1fa971;
            font-size: 13px;
            font-weight: 500;
        }
        #${MODAL_ID} .dm-ability {
            display: flex;
            gap: 12px;
            align-items: flex-start;
            padding: 14px 16px;
            margin: 0 0 18px;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.07);
        }
        #${MODAL_ID} .dm-ability input {
            appearance: none;
            width: 18px;
            height: 18px;
            flex: 0 0 18px;
            margin-top: 3px;
            border: 2px solid #5865F2;
            border-radius: 4px;
            background: transparent;
            opacity: 1;
        }
        #${MODAL_ID} .dm-ability input:checked {
            background-color: #5865F2;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m3 8 3 3 7-7' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
            background-position: center;
            background-repeat: no-repeat;
            background-size: 13px;
        }
        #${MODAL_ID} input[type="radio"],
        #${MODAL_ID} input[type="checkbox"] {
            accent-color: #5865F2;
        }
        #${MODAL_ID} .dm-ability-title {
            font-weight: 600;
            color: #f9fafb;
        }
        #${MODAL_ID} .dm-ability-note {
            margin-top: 4px;
            color: #b9bbbe;
            font-size: 13px;
            line-height: 1.4;
        }
        #${MODAL_ID} .dm-hide-pill {
            display: flex;
            gap: 10px;
            align-items: center;
            margin-top: 18px;
            color: #d7deea;
            font-size: 14px;
            cursor: pointer;
        }
    `;
    document.head.append(style);
}

function renderModal(config, onClose) {
    const extendedAbilitiesEnabled = hasExtendedPluginAbilitiesEnabled();
    document.getElementById(MODAL_ID)?.remove();
    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    document.body.append(modal);

    modal.innerHTML = `
        <div class="dm-card" role="dialog" aria-modal="true" aria-labelledby="dm-title">
            <h2 id="dm-title">Download Manager</h2>
            <p class="dm-subtle">
                Configure how Legcord download requests are routed. Saving here updates the plugin's own config file.
                ${extendedAbilitiesEnabled ? "Saving is available." : "Please enable Extended plugin abilities in Legcord settings to save changes."}
            </p>
            <div class="dm-ability">
                <input type="checkbox" ${extendedAbilitiesEnabled ? "checked" : ""} disabled aria-label="Extended plugin abilities status">
                <div>
                    <div class="dm-ability-title">Extended plugin abilities</div>
                    <div class="dm-ability-note">
                        ${extendedAbilitiesEnabled ? "Enabled. Plugin settings can be saved from this menu." : "Disabled. Turn this on in Legcord settings, then reopen this menu to save settings."}
                    </div>
                </div>
            </div>
            <div class="dm-stack">
                <div class="dm-choice">
                    <label class="dm-choice-row">
                        <input type="radio" name="dm-manager" value="browser" ${config.manager === "browser" ? "checked" : ""}>
                        Default browser / normal Legcord download flow
                    </label>
                    <div class="dm-choice-note">Do not intercept downloads.</div>
                </div>
                <div class="dm-choice">
                    <label class="dm-choice-row">
                        <input type="radio" name="dm-manager" value="gopeed" ${config.manager === "gopeed" ? "checked" : ""}>
                        Gopeed
                    </label>
                    <div class="dm-choice-note">Queues downloads through the Gopeed REST API.</div>
                    <div class="dm-fields" data-gopeed-fields>
                        <div class="dm-field">
                            <label for="dm-gopeed-host">Gopeed API host</label>
            <input id="dm-gopeed-host" type="text" value="${escapeHtml(config.gopeed.host)}" placeholder="http://127.0.0.1:9999">
                        </div>
                        <div class="dm-field">
                            <label for="dm-gopeed-token">Gopeed API token</label>
            <input id="dm-gopeed-token" type="password" value="${escapeHtml(config.gopeed.token)}" placeholder="Optional">
                        </div>
                    </div>
                </div>
                <div class="dm-choice">
                    <label class="dm-choice-row">
                        <input type="radio" name="dm-manager" value="idm" ${config.manager === "idm" ? "checked" : ""}>
                        Internet Download Manager
                    </label>
                    <div class="dm-choice-note">Queues downloads through the bundled IDM helper scripts on Windows.</div>
                </div>
            </div>
            <label class="dm-hide-pill">
                <input id="dm-hide-pill" type="checkbox" ${config.ui.showPill ? "" : "checked"}>
                Do not show plugin pill on next launch
            </label>
            <div class="dm-status" data-dm-status></div>
            <div class="dm-actions">
                <button class="dm-secondary" data-action="close">Close</button>
                <button class="dm-secondary" data-action="reload">Reload Plugin</button>
                <button class="dm-primary" data-action="save">Save</button>
            </div>
        </div>
    `;

    modal.dataset.open = "true";

    const syncGopeedFields = () => {
        const checked = modal.querySelector('input[name="dm-manager"]:checked')?.value;
        const fields = modal.querySelector("[data-gopeed-fields]");
        if (fields) {
            fields.style.display = checked === "gopeed" ? "grid" : "none";
        }
    };

    const setStatus = (message) => {
        const status = modal.querySelector("[data-dm-status]");
        if (status) status.textContent = message;
    };

    const closeModal = () => {
        modal.dataset.open = "false";
        modal.remove();
        onClose();
    };

    modal.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target === modal) {
            closeModal();
            return;
        }

        const action = target.dataset.action;
        if (!action) return;

        if (action === "close") {
            closeModal();
            return;
        }

        if (action === "reload") {
            const result = await window.legcord.plugins.reload(PLUGIN_ID);
            setStatus(result.ok ? "Plugin reloaded." : "Plugin reload failed.");
            return;
        }

        if (action === "save") {
            const manager = modal.querySelector('input[name="dm-manager"]:checked')?.value ?? "browser";
            const hidePill = modal.querySelector("#dm-hide-pill")?.checked === true;
            const nextConfig = normalizeConfig({
                manager,
                ui: {
                    ...config.ui,
                    showPill: !hidePill,
                },
                gopeed: {
                    host: modal.querySelector("#dm-gopeed-host")?.value ?? DEFAULT_CONFIG.gopeed.host,
                    token: modal.querySelector("#dm-gopeed-token")?.value ?? "",
                },
            });
            const result = await saveConfig(nextConfig);
            if (result.ok) {
                const button = document.getElementById(BUTTON_ID);
                if (button) {
                    button.textContent = `Download Manager: ${getManagerLabel(nextConfig.manager)}`;
                }
                const reloadResult = await window.legcord.plugins.reload(PLUGIN_ID);
                setStatus(
                    reloadResult.ok
                        ? "Saved and synchronized."
                        : "Saved. Reload Legcord to synchronize config.json.",
                );
                return;
            }
            setStatus(
                `Save failed: ${result.error}. Enable Extended plugin abilities in Legcord settings and reopen this menu.`,
            );
        }
    });

    modal.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.name === "dm-manager") {
            syncGopeedFields();
        }
    });

    syncGopeedFields();
}

module.exports.activate = (api) => {
    ensureStyle();

    let isOpen = false;
    let observer = null;

    const ensureButton = (config) => {
        let button = document.getElementById(BUTTON_ID);
        if (!button) {
            button = document.createElement("button");
            button.id = BUTTON_ID;
            button.type = "button";
            button.addEventListener("click", async () => {
                if (isOpen) return;
                isOpen = true;
                const currentConfig = await loadConfig();
                renderModal(currentConfig, () => {
                    isOpen = false;
                });
            });
            document.body.append(button);
        }
        button.textContent = `Download Manager: ${getManagerLabel(config.manager)}`;
    };

    const syncButtonVisibility = async () => {
        const config = await loadConfig();
        if (config.ui.showPill) {
            ensureButton(config);
        } else {
            document.getElementById(BUTTON_ID)?.remove();
            if (isOpen) {
                document.getElementById(MODAL_ID)?.remove();
                isOpen = false;
            }
        }
    };

    const start = async () => {
        await syncButtonVisibility();
        observer = new MutationObserver(() => {
            if (!document.getElementById(BUTTON_ID)) {
                void syncButtonVisibility();
            }
        });
        observer.observe(document.body, { childList: true });
    };

    if (document.body) {
        void start();
    } else {
        window.addEventListener(
            "DOMContentLoaded",
            () => {
                void start();
            },
            { once: true },
        );
    }

    api.onCleanup(() => {
        observer?.disconnect();
        document.getElementById(BUTTON_ID)?.remove();
        document.getElementById(MODAL_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
    });
};
