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

let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL_MS = 1000;

function readConfig(app, logger) {
    const now = Date.now();
    if (configCache && now - configCacheTime < CONFIG_CACHE_TTL_MS) {
        return configCache;
    }

    const storageConfigPath = ensureConfig(app, logger);
    try {
        const config = normalizeConfig(readJson(storageConfigPath));
        configCache = config;
        configCacheTime = now;
        return config;
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

const requestHeadersCache = new Map();

function trackRequestHeaders(url, headers) {
    if (url && headers) {
        requestHeadersCache.set(url, headers);
        if (requestHeadersCache.size > 512) {
            const oldest = requestHeadersCache.keys().next().value;
            if (oldest) requestHeadersCache.delete(oldest);
        }
    }
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

    // Merge live captured request headers if available
    const tracked = requestHeadersCache.get(url);
    if (tracked) {
        for (const [key, val] of Object.entries(tracked)) {
            if (typeof val === "string" && val.length > 0 && !headers[key]) {
                headers[key] = val;
            }
        }
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
const DOWNLOAD_FILENAME_QUERY_KEYS = ["filename", "file", "name", "attachment"];

const DOWNLOAD_EXTENSIONS = new Set([
    // Archives & Compressed Files
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "tbz2", "xz", "txz", "zst", "tzst",
    "iso", "cab", "dmg", "img", "vhd", "vhdx", "wim", "lzh", "lha", "arj", "ace", "uue",
    "bz", "lz", "lzma", "lzo", "rz", "sz", "z", "7z.001", "zip.001", "rar.001", "part1.rar",

    // Executables, Installers & Packages
    "exe", "msi", "pkg", "deb", "rpm", "appimage", "apk", "xapk", "apks", "ipa", "jar",
    "bin", "run", "msix", "appx", "appxbundle", "msixbundle", "gadget", "bat", "cmd",
    "ps1", "vbs", "sh", "command",

    // Documents & E-books
    "pdf", "epub", "mobi", "azw", "azw3", "djvu",

    // Audio Files
    "mp3", "flac", "wav", "aac", "ogg", "m4a", "wma", "opus", "aiff", "alac", "mid", "midi",

    // Video Files
    "mp4", "mkv", "avi", "mov", "wmv", "webm", "flv", "m4v", "ts", "mts", "m2ts", "vob", "3gp",

    // Disk Images & Game/ROM Data
    "nrg", "cdi", "cue", "gcm", "xci", "nsp", "chd", "vpk", "pak", "wad",

    // Torrent & Hash/Patch Files
    "torrent", "patch", "diff"
]);

function getRelevantQueryFilename(searchParams) {
    for (const key of DOWNLOAD_FILENAME_QUERY_KEYS) {
        const value = searchParams.get(key);
        if (value) {
            return value;
        }
    }
    return "";
}

function extractFilenameFromUrl(url) {
    try {
        const parsed = new URL(url);
        const pathname = parsed.pathname;
        const filename = pathname.split("/").pop();
        if (filename && filename.includes(".")) {
            return decodeURIComponent(filename);
        }
        const queryFilename = getRelevantQueryFilename(parsed.searchParams);
        if (queryFilename) {
            return decodeURIComponent(queryFilename);
        }
    } catch {
        // Ignore extraction errors.
    }
    return "";
}

function isDownloadUrlSync(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname;
        const lowerPath = pathname.toLowerCase();

        if (lowerPath.includes("/attachments/") || DISCORD_DOWNLOAD_HOSTS.has(hostname)) {
            return true;
        }

        const filename = pathname.split("/").pop() || "";
        if (filename.includes(".")) {
            const ext = filename.split(".").pop().toLowerCase();
            if (DOWNLOAD_EXTENSIONS.has(ext)) {
                return true;
            }
        }

        const searchParams = parsed.searchParams;
        if (
            searchParams.has("download") ||
            searchParams.has("response-content-disposition") ||
            searchParams.has("attachment") ||
            searchParams.get("dl") === "1" ||
            searchParams.get("export") === "download" ||
            searchParams.get("action") === "download"
        ) {
            return true;
        }

        const queryFilename = getRelevantQueryFilename(searchParams);
        if (queryFilename) {
            if (queryFilename.includes(".")) {
                const queryExt = queryFilename.split(".").pop().toLowerCase();
                if (DOWNLOAD_EXTENSIONS.has(queryExt)) {
                    return true;
                }
            } else {
                return true;
            }
        }

        if (
            (lowerPath.includes("/releases/download/") ||
                lowerPath.includes("/file-download/") ||
                lowerPath.includes("/get-download/")) &&
            filename.length > 0 &&
            filename !== "download" &&
            filename !== "downloads"
        ) {
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

const downloadDecisionCache = new Map();
const DECISION_CACHE_TTL_MS = 5 * 60 * 1000;

async function isDownloadUrl(url) {
    if (isDownloadUrlSync(url)) {
        return true;
    }

    const now = Date.now();
    const cached = downloadDecisionCache.get(url);
    if (cached && now - cached.timestamp < DECISION_CACHE_TTL_MS) {
        return cached.result;
    }

    const evaluate = async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            let response;
            try {
                response = await fetch(url, {
                    method: "HEAD",
                    redirect: "follow",
                    signal: controller.signal,
                });
            } catch {
                const getController = new AbortController();
                const getTimeoutId = setTimeout(() => getController.abort(), 3000);
                try {
                    response = await fetch(url, {
                        method: "GET",
                        headers: { Range: "bytes=0-0" },
                        redirect: "follow",
                        signal: getController.signal,
                    });
                } finally {
                    clearTimeout(getTimeoutId);
                }
            } finally {
                clearTimeout(timeoutId);
            }

            if (!response || (!response.ok && response.status !== 206)) {
                return false;
            }

            if (response.url && response.url !== url) {
                if (isDownloadUrlSync(response.url)) {
                    return true;
                }
            }

            const contentDisposition = response.headers.get("content-disposition") || "";
            if (/attachment/i.test(contentDisposition) || /filename=/i.test(contentDisposition)) {
                return true;
            }

            const contentTypeHeader = response.headers.get("content-type") || "";
            const contentType = contentTypeHeader.toLowerCase().split(";")[0].trim();

            if (contentType) {
                const webPageTypes = [
                    "text/html",
                    "application/xhtml+xml",
                    "application/json",
                    "text/css",
                    "text/javascript",
                    "application/javascript",
                    "text/plain",
                    "image/svg+xml",
                ];

                if (!webPageTypes.includes(contentType)) {
                    return true;
                }
            }

            return false;
        } catch {
            return false;
        }
    };

    const result = await evaluate();
    downloadDecisionCache.set(url, { result, timestamp: now });
    if (downloadDecisionCache.size > 512) {
        const oldest = downloadDecisionCache.keys().next().value;
        if (oldest) downloadDecisionCache.delete(oldest);
    }

    return result;
}

class GopeedDownloadManager {
    constructor(config) {
        this.config = config;
        this.usedDeepLinkFallback = false;
    }

    isLocalHost() {
        try {
            const parsed = new URL(normalizeHost(this.config.host));
            const hostname = parsed.hostname.toLowerCase();
            return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
        } catch {
            return false;
        }
    }

    createDeepLink(url, headers, filename) {
        const cleanHeaders = {};
        if (headers && typeof headers === "object") {
            for (const [key, val] of Object.entries(headers)) {
                if (typeof val === "string" && val.trim().length > 0) {
                    cleanHeaders[key] = val.trim();
                }
            }
        }

        const extra = Object.keys(cleanHeaders).length > 0 ? { header: cleanHeaders } : undefined;
        const req = { url, extra };
        const opts = filename ? { name: filename } : {};
        const payload = { req, opts, opt: opts };
        const encodedParams = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
        return `gopeed:///create?params=${encodeURIComponent(encodedParams)}`;
    }

    async bringToFront() {
        if (this.usedDeepLinkFallback) return;
        try {
            await shell.openExternal("gopeed://");
        } catch {
            // Ignore foreground failures.
        }
    }

    async getInfo() {
        const host = normalizeHost(this.config.host);
        const token = typeof this.config.token === "string" ? this.config.token.trim() : "";
        const response = await fetch(`${host}/api/v1/info`, {
            method: "GET",
            headers: token ? { "X-Api-Token": token } : {},
            signal: AbortSignal.timeout(4_000),
        });

        if (!response.ok) {
            throw new Error(`Gopeed API returned HTTP ${response.status}`);
        }
        return response.json();
    }

    async postTaskApi(url, headers, filename) {
        const host = normalizeHost(this.config.host);
        const token = typeof this.config.token === "string" ? this.config.token.trim() : "";

        const cleanHeaders = {};
        if (headers && typeof headers === "object") {
            for (const [key, val] of Object.entries(headers)) {
                if (typeof val === "string" && val.trim().length > 0) {
                    cleanHeaders[key] = val.trim();
                }
            }
        }

        const req = {
            url,
            ...(Object.keys(cleanHeaders).length > 0 ? { extra: { header: cleanHeaders } } : {}),
        };
        const opts = filename ? { name: filename } : {};
        const body = { req, opts, opt: opts };

        const response = await fetch(`${host}/api/v1/tasks`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { "X-Api-Token": token } : {}),
            },
            body: JSON.stringify(body),
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

    async createTask(url, headers, filename) {
        this.usedDeepLinkFallback = false;

        try {
            await this.postTaskApi(url, headers, filename);
            return;
        } catch (apiError) {
            if (this.isLocalHost()) {
                try {
                    await shell.openExternal("gopeed://");
                } catch {
                    // Ignore foreground / launch errors
                }

                await new Promise((resolve) => setTimeout(resolve, 1200));

                try {
                    await this.postTaskApi(url, headers, filename);
                    return;
                } catch {
                    this.usedDeepLinkFallback = true;
                    const deepLink = this.createDeepLink(url, headers, filename);
                    await shell.openExternal(deepLink);
                    return;
                }
            }
            throw apiError;
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

                        await manager.createTask(sourceUrl, headers, item.getFilename());

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

            try {
                session.webRequest.onBeforeSendHeaders({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
                    if (details.url && details.requestHeaders) {
                        trackRequestHeaders(details.url, details.requestHeaders);
                    }
                    callback({ cancel: false, requestHeaders: details.requestHeaders });
                });
            } catch {
                // Best-effort webRequest header tracking
            }

            session.on("will-download", downloadListener);
            sessionListeners.set(session, downloadListener);
        }

        if (!webContentsListeners.has(webContents)) {
            const handleNavOrRedirect = (event, url, sourceName) => {
                if (!isHttpUrl(url)) return;

                const config = readConfig(api.electron.app, api.logger);
                if (config.manager === "browser") return;

                if (!isDownloadUrlSync(url)) return;

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
                        const filename = extractFilenameFromUrl(url);

                        await manager.createTask(url, headers, filename);

                        await manager.bringToFront();
                        api.logger.log(`Queued ${sourceName} download through ${config.manager}:`, url);
                    } catch (error) {
                        api.logger.error(`Failed to queue ${sourceName} download, falling back to browser`, error);
                        try {
                            await originalOpenExternal(url);
                        } catch (shellError) {
                            api.logger.error("Fallback openExternal failed", shellError);
                        }
                    }
                })();
            };

            const navigateListener = (event, url) => handleNavOrRedirect(event, url, "navigated");
            const redirectListener = (event, url) => handleNavOrRedirect(event, url, "redirected");

            try {
                webContents.setWindowOpenHandler(({ url }) => {
                    if (isHttpUrl(url)) {
                        const config = readConfig(api.electron.app, api.logger);
                        if (config.manager !== "browser" && isDownloadUrlSync(url)) {
                            void (async () => {
                                try {
                                    const manager = createManager(config);
                                    if (manager) {
                                        const headers = await buildDownloadRequestHeaders(window, url);
                                        const filename = extractFilenameFromUrl(url);
                                        await manager.createTask(url, headers, filename);
                                        await manager.bringToFront();
                                        api.logger.log(`Queued window.open download through ${config.manager}:`, url);
                                        return;
                                    }
                                } catch (error) {
                                    api.logger.error("Failed to queue window.open download", error);
                                }
                                try {
                                    await originalOpenExternal(url);
                                } catch (shellError) {
                                    api.logger.error("Fallback window.open openExternal failed", shellError);
                                }
                            })();
                            return { action: "deny" };
                        }
                    }
                    return { action: "allow" };
                });
            } catch {
                // Best-effort setWindowOpenHandler
            }

            webContents.on("will-navigate", navigateListener);
            webContents.on("will-redirect", redirectListener);
            webContentsListeners.set(webContents, { navigateListener, redirectListener });
            webContents.once("destroyed", () => {
                webContentsListeners.delete(webContents);
            });
        }
    };

    const unpatchShell = api.patcher.instead("openExternal", api.electron.shell, async (args, original) => {
        const url = args[0];

        if (bypassUrls.has(url)) {
            bypassUrls.delete(url);
            return original(...args);
        }

        const config = readConfig(api.electron.app, api.logger);
        if (config.manager !== "browser" && isHttpUrl(url)) {
            let isDownload = false;
            try {
                isDownload = await isDownloadUrl(url);
            } catch (error) {
                api.logger.error("Failed to evaluate download URL", error);
            }

            if (isDownload) {
                try {
                    const manager = createManager(config);
                    if (!manager) {
                        return original(...args);
                    }

                    const focusedWindow = api.electron.BrowserWindow.getFocusedWindow();
                    const headers = await buildDownloadRequestHeaders(focusedWindow, url);
                    const filename = extractFilenameFromUrl(url);

                    await manager.createTask(url, headers, filename);

                    await manager.bringToFront();
                    api.logger.log(`Queued openExternal download through ${config.manager}:`, url);
                    return Promise.resolve(true);
                } catch (error) {
                    api.logger.error("Failed to queue openExternal download, falling back to browser", error);
                    try {
                        return await original(...args);
                    } catch (shellError) {
                        api.logger.error("Fallback openExternal failed", shellError);
                    }
                }
            }
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
        for (const [webContents, listeners] of webContentsListeners) {
            if (!webContents.isDestroyed()) {
                if (listeners?.navigateListener) webContents.off("will-navigate", listeners.navigateListener);
                if (listeners?.redirectListener) webContents.off("will-redirect", listeners.redirectListener);
            }
        }
        webContentsListeners.clear();
        requestHeadersCache.clear();
        downloadDecisionCache.clear();
        configCache = null;
    });
}

export { isDownloadUrlSync, isDownloadUrl, extractFilenameFromUrl };

