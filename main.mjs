import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { shell } from "electron";

const PLUGIN_ID = "download-manager-plugin";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bundledConfigPath = path.join(__dirname, "config.json");
const scriptsDir = path.join(__dirname, "scripts");

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

function getStorageConfigPath(app) {
    return path.join(app.getPath("userData"), "plugin-storage", PLUGIN_ID, "config.json");
}

function ensureParentDir(filePath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonIfChanged(filePath, value) {
    const serialized = `${JSON.stringify(value, null, 4)}\n`;
    try {
        if (readFileSync(filePath, "utf8") === serialized) return false;
    } catch {
        // Create missing or unreadable destination below.
    }
    writeFileSync(filePath, serialized, "utf8");
    return true;
}

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

function ensureConfig(app, logger) {
    const storageConfigPath = getStorageConfigPath(app);
    if (!existsSync(storageConfigPath)) {
        ensureParentDir(storageConfigPath);
        const seedConfig = existsSync(bundledConfigPath) ? readJson(bundledConfigPath) : DEFAULT_CONFIG;
        writeJsonIfChanged(storageConfigPath, normalizeConfig(seedConfig));
        logger.log("Created plugin storage config.json");
    }

    // The renderer can only access plugin storage, so keep it synchronized with
    // the bundled config. The file changed most recently is the source.
    try {
        const bundledConfig = existsSync(bundledConfigPath) ? readJson(bundledConfigPath) : DEFAULT_CONFIG;
        const storedConfig = readJson(storageConfigPath);
        const bundledIsNewer = statSync(bundledConfigPath).mtimeMs >= statSync(storageConfigPath).mtimeMs;
        const sourceConfig = bundledIsNewer ? bundledConfig : storedConfig;
        const normalizedConfig = normalizeConfig(sourceConfig);
        const destinationPath = bundledIsNewer ? storageConfigPath : bundledConfigPath;
        if (writeJsonIfChanged(destinationPath, normalizedConfig)) {
            logger.log("Synchronized plugin config files");
        }
    } catch (error) {
        logger.error("Failed to synchronize plugin config files", error);
        try {
            const seedConfig = existsSync(bundledConfigPath) ? readJson(bundledConfigPath) : DEFAULT_CONFIG;
            writeJsonIfChanged(storageConfigPath, normalizeConfig(seedConfig));
            logger.log("Repaired invalid plugin storage config.json");
        } catch (repairError) {
            logger.error("Failed to repair plugin storage config.json", repairError);
        }
    }

    return storageConfigPath;
}

function readConfig(app, logger) {
    const storageConfigPath = ensureConfig(app, logger);
    try {
        return normalizeConfig(readJson(storageConfigPath));
    } catch (error) {
        logger.error("Failed to read config.json, using defaults", error);
        return structuredClone(DEFAULT_CONFIG);
    }
}

function normalizeHost(host) {
    const trimmed = typeof host === "string" ? host.trim() : "";
    if (!trimmed) return DEFAULT_CONFIG.gopeed.host;
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withProtocol.replace(/\/+$/, "").replace(/\/api\/v1(?:\/tasks)?$/i, "");
}

function getDownloadUrl(item) {
    try {
        const chain = typeof item.getURLChain === "function" ? item.getURLChain() : [];
        return chain.at(-1) ?? item.getURL();
    } catch {
        return typeof item.getURL === "function" ? item.getURL() : "";
    }
}

function isHttpUrl(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url);
}

async function buildDownloadRequestHeaders(window, url) {
    const headers = {};
    const webContents = window?.webContents;
    if (!webContents || webContents.isDestroyed()) {
        return headers;
    }

    const userAgent = webContents.userAgent;
    if (typeof userAgent === "string" && userAgent.length > 0) {
        headers["User-Agent"] = userAgent;
    }

    try {
        const currentUrl = typeof webContents.getURL === "function" ? webContents.getURL() : "";
        if (isHttpUrl(currentUrl)) {
            headers.Referer = currentUrl;
        }
    } catch {
        // Ignore Referer collection failures.
    }

    try {
        const cookies = await webContents.session.cookies.get({ url });
        if (cookies && cookies.length > 0) {
            headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
        }
    } catch {
        // Best-effort cookie collection.
    }

    return headers;
}

const DISCORD_DOWNLOAD_HOSTS = new Set(["cdn.discordapp.com", "cdn.discordapp.net", "media.discordapp.net"]);
const DOWNLOAD_FILENAME_QUERY_KEYS = ["filename", "file", "name"];

function getRelevantQueryFilename(searchParams) {
    for (const key of DOWNLOAD_FILENAME_QUERY_KEYS) {
        const value = searchParams.get(key);
        if (value) {
            return value;
        }
    }
    return "";
}

function computeRouteDecision(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        const lowerPath = parsed.pathname.toLowerCase();

        if (lowerPath.includes("/attachments/") || DISCORD_DOWNLOAD_HOSTS.has(hostname)) {
            return true;
        }

        if (
            parsed.searchParams.has("download") ||
            parsed.searchParams.has("response-content-disposition") ||
            getRelevantQueryFilename(parsed.searchParams).length > 0
        ) {
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

class GopeedDownloadManager {
    constructor(config) {
        this.config = config;
    }

    canUseDeepLink() {
        try {
            const parsed = new URL(normalizeHost(this.config.host));
            const hostname = parsed.hostname.toLowerCase();
            return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
        } catch {
            return false;
        }
    }

    createDeepLink(url, headers, filename) {
        const extra = {};
        if (headers && Object.keys(headers).length > 0) extra.header = headers;
        const payload = filename ? { req: { url, extra }, opts: { name: filename } } : { req: { url, extra } };
        const encodedParams = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
        return `gopeed:///create?params=${encodeURIComponent(encodedParams)}`;
    }

    async bringToFront() {
        try {
            await shell.openExternal("gopeed://");
        } catch {
            // Ignore foreground failures.
        }
    }

    async createTask(url, headers, filename) {
        const host = normalizeHost(this.config.host);
        const token = typeof this.config.token === "string" ? this.config.token.trim() : "";
        const response = await fetch(`${host}/api/v1/tasks`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { "X-Api-Token": token } : {}),
            },
            body: JSON.stringify(
                filename
                    ? { req: { url, extra: { header: headers } }, opts: { name: filename } }
                    : { req: { url, extra: { header: headers } } },
            ),
            signal: AbortSignal.timeout(8_000),
        });

        const bodyText = await response.text();
        if (!response.ok) {
            throw new Error(`Gopeed API returned HTTP ${response.status}: ${bodyText.slice(0, 300)}`);
        }

        const json = JSON.parse(bodyText);
        if (json?.code !== 0) {
            throw new Error(json?.msg ?? json?.message ?? "Unknown Gopeed API error");
        }
    }
}

class IDMDownloadManager {
    getHelperScriptPath(name) {
        return path.join(scriptsDir, name);
    }

    async bringToFront() {
        if (process.platform !== "win32") return;
        try {
            const child = spawn(
                "powershell.exe",
                [
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    this.getHelperScriptPath("bring_idm_to_front.ps1"),
                ],
                {
                    detached: true,
                    stdio: "ignore",
                },
            );
            child.unref();
        } catch {
            // Ignore foreground failures.
        }
    }

    async createTask(url, headers, filename) {
        if (process.platform !== "win32") {
            throw new Error("IDM is only supported on Windows");
        }

        const referrer = headers?.Referer ?? "";
        const cookieHeader = headers?.Cookie ?? "";
        const helperScript = this.getHelperScriptPath("idm_helper.ps1");

        await new Promise((resolve, reject) => {
            const args = [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                helperScript,
                url,
                referrer,
                cookieHeader,
                "",
                "",
                "",
                "",
                filename || "",
                "",
                "1",
            ];
            const child = spawn("powershell.exe", args, { stdio: ["ignore", "pipe", "pipe"] });
            let stdout = "";
            let stderr = "";

            child.stdout?.on("data", (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr?.on("data", (chunk) => {
                stderr += chunk.toString();
            });
            child.on("error", reject);
            child.on("close", (code) => {
                try {
                    const jsonMatch = stdout.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
                    const result = JSON.parse(jsonMatch ? jsonMatch[0] : stdout.trim());
                    if (result?.success) {
                        resolve(result);
                        return;
                    }
                    reject(new Error(result?.error ?? "Unknown IDM error"));
                } catch {
                    reject(new Error(stderr.trim() || stdout.trim() || `IDM helper exited with code ${code}`));
                }
            });
        });
    }
}

function createManager(config) {
    if (config.manager === "gopeed") return new GopeedDownloadManager(config.gopeed);
    if (config.manager === "idm") return new IDMDownloadManager();
    return null;
}

export function activate(api) {
    ensureConfig(api.electron.app, api.logger);

    const sessionListeners = new Map();
    const webContentsListeners = new Map();
    const bypassUrls = new Set();
    const originalOpenExternal = api.electron.shell.openExternal;

    const rememberBypassUrl = (url) => {
        if (bypassUrls.has(url)) {
            bypassUrls.delete(url);
        }
        bypassUrls.add(url);
        if (bypassUrls.size > 256) {
            const oldest = bypassUrls.values().next().value;
            if (oldest) bypassUrls.delete(oldest);
        }
    };

    const attachWindow = (window) => {
        const webContents = window?.webContents;
        if (!webContents) return;

        const session = webContents.session;
        if (session && !sessionListeners.has(session)) {
            const downloadListener = (event, item, wcs) => {
                const sourceUrl = getDownloadUrl(item);
                if (!isHttpUrl(sourceUrl)) return;

                if (bypassUrls.has(sourceUrl)) {
                    bypassUrls.delete(sourceUrl);
                    return;
                }

                const config = readConfig(api.electron.app, api.logger);
                const manager = createManager(config);
                if (!manager) return;

                event.preventDefault();
                item.cancel();

                void (async () => {
                    try {
                        const ownerWindow =
                            api.electron.BrowserWindow.fromWebContents(wcs) ??
                            api.electron.BrowserWindow.getFocusedWindow() ??
                            window;
                        const headers = await buildDownloadRequestHeaders(ownerWindow, sourceUrl);

                        if (manager instanceof GopeedDownloadManager && manager.canUseDeepLink()) {
                            await originalOpenExternal(manager.createDeepLink(sourceUrl, headers, item.getFilename()));
                        } else {
                            await manager.createTask(sourceUrl, headers, item.getFilename());
                        }

                        await manager.bringToFront();
                        api.logger.log(`Queued download through ${config.manager}:`, sourceUrl);
                    } catch (error) {
                        api.logger.error("Falling back to Legcord download flow", error);
                        rememberBypassUrl(sourceUrl);
                        try {
                            if (wcs && !wcs.isDestroyed()) {
                                wcs.downloadURL(sourceUrl);
                                return;
                            }
                        } catch (downloadError) {
                            api.logger.error("Fallback downloadURL failed", downloadError);
                        }
                        try {
                            await originalOpenExternal(sourceUrl);
                        } catch (shellError) {
                            api.logger.error("Fallback openExternal failed", shellError);
                        }
                    }
                })();
            };

            session.on("will-download", downloadListener);
            sessionListeners.set(session, downloadListener);
        }

        if (!webContentsListeners.has(webContents)) {
            const navigateListener = (event, url) => {
                if (!isHttpUrl(url)) return;

                const config = readConfig(api.electron.app, api.logger);
                if (config.manager === "browser") return;

                if (!computeRouteDecision(url)) return;

                event.preventDefault();

                void (async () => {
                    try {
                        const manager = createManager(config);
                        if (!manager) {
                            await originalOpenExternal(url);
                            return;
                        }

                        const ownerWindow =
                            api.electron.BrowserWindow.fromWebContents(webContents) ??
                            api.electron.BrowserWindow.getFocusedWindow() ??
                            window;
                        const headers = await buildDownloadRequestHeaders(ownerWindow, url);

                        if (manager instanceof GopeedDownloadManager && manager.canUseDeepLink()) {
                            await originalOpenExternal(manager.createDeepLink(url, headers));
                        } else {
                            await manager.createTask(url, headers);
                        }

                        await manager.bringToFront();
                        api.logger.log(`Queued navigated download through ${config.manager}:`, url);
                    } catch (error) {
                        api.logger.error("Failed to queue navigated download, falling back to browser", error);
                        try {
                            await originalOpenExternal(url);
                        } catch (shellError) {
                            api.logger.error("Fallback openExternal failed", shellError);
                        }
                    }
                })();
            };

            webContents.on("will-navigate", navigateListener);
            webContentsListeners.set(webContents, navigateListener);
            webContents.once("destroyed", () => {
                webContentsListeners.delete(webContents);
            });
        }
    };

    const unpatchShell = api.patcher.instead("openExternal", api.electron.shell, (args, original) => {
        const url = args[0];

        if (bypassUrls.has(url)) {
            bypassUrls.delete(url);
            return original(...args);
        }

        const config = readConfig(api.electron.app, api.logger);
        if (config.manager !== "browser" && isHttpUrl(url) && computeRouteDecision(url)) {
            void (async () => {
                try {
                    const manager = createManager(config);
                    if (!manager) {
                        await original(...args);
                        return;
                    }

                    const focusedWindow = api.electron.BrowserWindow.getFocusedWindow();
                    const headers = await buildDownloadRequestHeaders(focusedWindow, url);

                    if (manager instanceof GopeedDownloadManager && manager.canUseDeepLink()) {
                        await original(manager.createDeepLink(url, headers));
                    } else {
                        await manager.createTask(url, headers);
                    }

                    await manager.bringToFront();
                    api.logger.log(`Queued openExternal download through ${config.manager}:`, url);
                } catch (error) {
                    api.logger.error("Failed to queue openExternal download, falling back to browser", error);
                    try {
                        await original(...args);
                    } catch (shellError) {
                        api.logger.error("Fallback openExternal failed", shellError);
                    }
                }
            })();
            return Promise.resolve(true);
        }

        return original(...args);
    });

    const onWindowCreated = (_event, window) => {
        attachWindow(window);
    };

    for (const window of api.electron.BrowserWindow.getAllWindows()) {
        attachWindow(window);
    }

    api.electron.app.on("browser-window-created", onWindowCreated);
    api.onCleanup(() => {
        unpatchShell();
        api.electron.app.off("browser-window-created", onWindowCreated);
        for (const [session, listener] of sessionListeners) {
            session.off("will-download", listener);
        }
        sessionListeners.clear();
        for (const [webContents, listener] of webContentsListeners) {
            if (!webContents.isDestroyed()) {
                webContents.off("will-navigate", listener);
            }
        }
        webContentsListeners.clear();
    });
}
