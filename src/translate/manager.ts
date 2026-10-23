import { ITranslateOptions, TranslateManager } from "comment-translate-manager";
import { getConfig, onConfigChange } from "../configuration";
import { env, ExtensionContext, workspace } from "vscode";
import { ITranslateConfig, TranslateExtensionProvider } from "./translateExtension";
import { GoogleTranslate } from "./GoogleTranslate";
import { BingTranslate } from "./BingTranslate";
import { detectLanguage } from "../lang";
import { CopilotTranslate } from "./CopilotTranslate";
import { TranSmartTranslate } from "./TranSmartTranslate";
import * as fs from "fs";
import * as path from "path";


export let translateManager: TranslateManager;
export let translateExtensionProvider: TranslateExtensionProvider

const sessionTranslateCache = new Map<string, string>();
const pendingTranslateTasks = new Map<string, Promise<string>>();
const MAX_SESSION_CACHE_SIZE = 1000;
const persistentTranslateCache = new Map<string, string>();
let persistentCacheLoaded = false;
let persistentCacheWrite: Promise<void> = Promise.resolve();
let persistentCacheIndex = 0;
const PERSISTENT_CACHE_LIMIT = 30 * 1024 * 1024;
const PERSISTENT_CACHE_FILES = 3;

function persistentCachePath(index: number) {
    const root = workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    return path.join(root, "build", `Comment-Translate.${index}.db`);
}

export function getCachedTranslation(text: string, opts?: ITranslateOptions): string | undefined {
    loadPersistentCache();
    const key = buildTranslateCacheKey(text, opts);
    return sessionTranslateCache.get(key) ?? persistentTranslateCache.get(key);
}

function loadPersistentCache() {
    if (persistentCacheLoaded) return;
    persistentCacheLoaded = true;
    try {
        for (let index = 0; index < PERSISTENT_CACHE_FILES; index += 1) {
            const file = persistentCachePath(index);
            if (!fs.existsSync(file)) continue;
            const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
            Object.entries(data).forEach(([key, value]) => persistentTranslateCache.set(key, value));
            const currentFile = persistentCachePath(persistentCacheIndex);
            if (!fs.existsSync(currentFile) || fs.statSync(file).mtimeMs > fs.statSync(currentFile).mtimeMs) {
                persistentCacheIndex = index;
            }
        }
    } catch {
        // Missing or invalid cache files are treated as empty caches.
    }
}

function savePersistentCache() {
    const data = JSON.stringify(Object.fromEntries(persistentTranslateCache), null, 2);
    persistentCacheWrite = persistentCacheWrite.then(async () => {
        let file = persistentCachePath(persistentCacheIndex);
        if (Buffer.byteLength(data, "utf8") > PERSISTENT_CACHE_LIMIT) {
            persistentCacheIndex = (persistentCacheIndex + 1) % PERSISTENT_CACHE_FILES;
            file = persistentCachePath(persistentCacheIndex);
        }
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, data, "utf8");
    }).catch(() => undefined);
}

function trimSessionCache() {
    if (sessionTranslateCache.size <= MAX_SESSION_CACHE_SIZE) {
        return;
    }

    const removeCount = sessionTranslateCache.size - MAX_SESSION_CACHE_SIZE;
    let removed = 0;
    for (const key of sessionTranslateCache.keys()) {
        sessionTranslateCache.delete(key);
        removed += 1;
        if (removed >= removeCount) {
            break;
        }
    }
}

function buildTranslateCacheKey(text: string, opts?: ITranslateOptions) {
    const sourceProvider = getConfig<string>('source', '');
    const from = opts?.from || translateManager.opts.from || 'auto';
    const to = opts?.to || translateManager.opts.to || 'en';
    return `${sourceProvider}|${from}|${to}|${text}`;
}

export async function cachedTranslate(text: string, opts?: ITranslateOptions, persist = false): Promise<string> {
    loadPersistentCache();
    const key = buildTranslateCacheKey(text, opts);
    if (sessionTranslateCache.has(key)) {
        return sessionTranslateCache.get(key) || '';
    }

    if (persist && persistentTranslateCache.has(key)) {
        const result = persistentTranslateCache.get(key) || '';
        if (!(text.includes("\n") && !result.includes("\n"))) {
            sessionTranslateCache.set(key, result);
            return result;
        }
        persistentTranslateCache.delete(key);
    }

    if (pendingTranslateTasks.has(key)) {
        return pendingTranslateTasks.get(key)!;
    }

    const task = translateManager.translate(text, opts)
        .then((result) => {
            sessionTranslateCache.set(key, result);
            if (persist) {
                persistentTranslateCache.set(key, result);
                savePersistentCache();
            }
            trimSessionCache();
            return result;
        })
        .finally(() => {
            pendingTranslateTasks.delete(key);
        });

    pendingTranslateTasks.set(key, task);
    return task;
}

export function initTranslate(context: ExtensionContext) {

    let userLanguage = getUserLanguage();
    const targetLanguage = getConfig('targetLanguage', userLanguage);
    const sourceLanguage = getConfig('sourceLanguage', 'auto');
    // 最多单次可以翻译10000字符。 内部会分拆请求翻译服务。
    translateManager = new TranslateManager(context.workspaceState, getConfig<number>('maxTranslationLength', 10000), { from: sourceLanguage, to: targetLanguage });
    onConfigChange('maxTranslationLength', (maxLen: number) => {
        translateManager.maxLen = maxLen;
    });
    onConfigChange('targetLanguage', (targetLanguage: string) => {
        translateManager.opts.to = targetLanguage;
        sessionTranslateCache.clear();
        // Note: pendingTranslateTasks are NOT cleared intentionally.
        // In-flight tasks use keys that include the old language code, so they cannot
        // collide with new requests (which use new keys). Clearing would only cause
        // duplicate API calls for any requests that arrive while old tasks are still running.
    });
    onConfigChange('sourceLanguage', (sourceLanguage: string) => {
        translateManager.opts.from = sourceLanguage;
        sessionTranslateCache.clear();
        // See note above regarding pendingTranslateTasks.
    });
    onConfigChange('source', () => {
        sessionTranslateCache.clear();
        // See note above regarding pendingTranslateTasks.
    });

    const buildInTranslate: ITranslateConfig[] = [{
        title: 'Google translate',
        ctor: GoogleTranslate,
        translate: 'Google'
    },
    {
        title: 'Bing translate',
        ctor: BingTranslate,
        translate: 'Bing'
    },
    {
        title: 'Github Copilot translate',
        ctor: CopilotTranslate,
        translate: 'Copilot'
    },
    {
        title: 'Tencent TranSmart translate',
        ctor: TranSmartTranslate,
        translate: 'TranSmart'
    }];
    translateExtensionProvider = new TranslateExtensionProvider(translateManager, buildInTranslate);
    translateExtensionProvider.init(getConfig<string>('source', ''));

    return translateManager;
}


/**
 * Automatic translation, which automatically detects languages based on source code.
 * When `commentTranslate.mutualTranslate` is enabled and the detected language matches
 * the target language, the translation direction is swapped automatically (mutual translate).
 * When disabled, the text is always translated to the configured target language.
 * @param text Text to be translated
 * @param opts Select target and source languages for translation
 * @returns Translated text
 */
export async function autoMutualTranslate(text: string, opts?: ITranslateOptions, persist = false): Promise<string> {
    let targetLanguage = opts?.to || translateManager.opts.to || 'auto';
    let sourceLanguage = opts?.from || translateManager.opts.from || 'en';

    const isMutualTranslateEnabled = getConfig<boolean>('mutualTranslate', false);
    if (isMutualTranslateEnabled) {
        let detectedLanguage = await detectLanguage(text);
        if (targetLanguage.indexOf(detectedLanguage) === 0) {
            targetLanguage = sourceLanguage;
            // In the case of automatic detection, the target language for translation cannot be auto
            if (targetLanguage === 'auto') targetLanguage = 'en';
        }
    }

    return cachedTranslate(text, { from: opts?.from, to: targetLanguage }, persist);
}


export function getUserLanguage() {
    let userLanguage = env.language;

    let langMaps: Map<string, string> = new Map([
        ['zh-cn', 'zh-CN'],
        ['zh-tw', 'zh-TW'],
    ]);
    // 修复语言代码不一致
    if (langMaps.has(userLanguage)) {
        userLanguage = langMaps.get(userLanguage) || '';
    }

    return userLanguage;
}
