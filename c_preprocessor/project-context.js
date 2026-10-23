const fs = require('fs');
const path = require('path');
const { parseDocument, parseMacroDefinition } = require('./parser');

const CACHE_VERSION = 1;
const CACHE_FILE_NAME = 'c-preprocessor-visualizer-cache.json';
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_INCLUDE_CACHE_ENTRIES = 128;

function createParseOptionsForFile(fileName, workspaceFolder) {
  const root = workspaceFolder ?? path.dirname(fileName);
  const projectData = loadProjectData(root);
  const compileContext = findCompileContext(projectData.entries, fileName);
  const includeDirs = uniquePaths([
    path.dirname(fileName),
    ...compileContext.includeDirs,
    root
  ]);
  const includeCache = new Map();
  const includedTexts = [];
  const capturedIncludes = new Set();

  return {
    initialMacros: compileContext.macros,
    includedTexts,
    resolveInclude: createIncludeResolver({
      root,
      includeDirs,
      includeCache,
      visited: new Set(),
      includedTexts,
      capturedIncludes
    }),
    signature: [
      projectData.signature,
      serializeMacros(compileContext.macros),
      includeDirs.join('|')
    ].join('::')
  };
}

function loadProjectData(root) {
  const buildDir = path.join(root, 'build');
  const compileCommandsPath = path.join(buildDir, 'compile_commands.json');
  const cachePath = path.join(buildDir, CACHE_FILE_NAME);
  const compileCommandsMtimeMs = getMtimeMs(compileCommandsPath);
  const cached = readCache(cachePath);

  if (
    cached &&
    cached.version === CACHE_VERSION &&
    cached.compileCommandsPath === compileCommandsPath &&
    cached.compileCommandsMtimeMs === compileCommandsMtimeMs &&
    !isExpired(cached.updatedAt)
  ) {
    return {
      entries: deserializeEntries(cached.entries),
      signature: `${compileCommandsPath}:${compileCommandsMtimeMs}:cached`
    };
  }

  const entries = compileCommandsMtimeMs === undefined
    ? []
    : parseCompileCommands(compileCommandsPath, root);

  writeCache(cachePath, {
    version: CACHE_VERSION,
    updatedAt: Date.now(),
    compileCommandsPath,
    compileCommandsMtimeMs,
    entries: serializeEntries(entries)
  });

  return {
    entries,
    signature: `${compileCommandsPath}:${compileCommandsMtimeMs}:fresh`
  };
}

function readCache(cachePath) {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (isExpired(cached.updatedAt)) {
      fs.rmSync(cachePath, { force: true });
      return undefined;
    }
    return cached;
  } catch {
    return undefined;
  }
}

function writeCache(cachePath, data) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(data, null, 2)}\n`);
  } catch {
    // Cache failures should not affect editor decorations.
  }
}

function getMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
}

function isExpired(updatedAt) {
  return typeof updatedAt !== 'number' || Date.now() - updatedAt > CACHE_TTL_MS;
}

function parseCompileCommands(compileCommandsPath, root) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(compileCommandsPath, 'utf8'));
  } catch {
    return [];
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((entry) => parseCompileCommandEntry(entry, root));
}

function parseCompileCommandEntry(entry, root) {
  const directory = path.resolve(entry.directory || root);
  const file = path.resolve(directory, entry.file || '');
  const args = Array.isArray(entry.arguments)
    ? entry.arguments
    : tokenizeCommandLine(entry.command || '');
  const macros = new Map();
  const includeDirs = [];

  for (let index = 1; index < args.length; index++) {
    const arg = args[index];

    if (arg === '-D' || arg === '/D') {
      applyMacroDefine(macros, args[++index]);
      continue;
    }

    if (arg.startsWith('-D')) {
      applyMacroDefine(macros, arg.slice(2));
      continue;
    }

    if (arg.startsWith('/D')) {
      applyMacroDefine(macros, arg.slice(2));
      continue;
    }

    if (arg === '-U' || arg === '/U') {
      macros.delete(firstIdentifier(args[++index] || ''));
      continue;
    }

    if (arg.startsWith('-U')) {
      macros.delete(firstIdentifier(arg.slice(2)));
      continue;
    }

    if (arg.startsWith('/U')) {
      macros.delete(firstIdentifier(arg.slice(2)));
      continue;
    }

    if (arg === '-I' || arg === '-iquote' || arg === '-isystem') {
      includeDirs.push(resolveCompilePath(directory, args[++index]));
      continue;
    }

    if (arg.startsWith('-I') && arg.length > 2) {
      includeDirs.push(resolveCompilePath(directory, arg.slice(2)));
    }
  }

  return {
    file,
    directory,
    macros,
    includeDirs: uniquePaths(includeDirs)
  };
}

function applyMacroDefine(macros, value) {
  if (!value) {
    return;
  }

  const equalsIndex = value.indexOf('=');
  const definition = equalsIndex === -1
    ? value
    : `${value.slice(0, equalsIndex)} ${value.slice(equalsIndex + 1)}`;
  const macro = parseMacroDefinition(definition);
  if (macro) {
    macros.set(macro.name, macro.value);
  }
}

function firstIdentifier(text) {
  return text.match(/[A-Za-z_]\w*/)?.[0] ?? '';
}

function resolveCompilePath(directory, includePath) {
  if (!includePath) {
    return directory;
  }

  const unquoted = stripQuotes(includePath);
  return path.isAbsolute(unquoted)
    ? path.normalize(unquoted)
    : path.resolve(directory, unquoted);
}

function findCompileContext(entries, fileName) {
  const normalizedFile = normalizePath(fileName);
  const exact = entries.find((entry) => normalizePath(entry.file) === normalizedFile);
  if (exact) {
    return {
      macros: new Map(exact.macros),
      includeDirs: [...exact.includeDirs]
    };
  }

  const macros = new Map();
  const includeDirs = [];
  for (const entry of entries) {
    for (const [name, value] of entry.macros) {
      macros.set(name, value);
    }
    includeDirs.push(...entry.includeDirs);
  }

  return {
    macros,
    includeDirs: uniquePaths(includeDirs)
  };
}

function createIncludeResolver({ root, includeDirs, includeCache, visited, includedTexts, capturedIncludes }) {
  return function resolveInclude(argument, context) {
    const includePath = parseIncludeArgument(argument);
    if (!includePath) {
      return context.macros;
    }

    const currentDir = context.document?.fileName
      ? path.dirname(context.document.fileName)
      : root;
    const resolved = resolveIncludePath(includePath, [currentDir, ...includeDirs]);
    if (!resolved || visited.has(resolved)) {
      return context.macros;
    }

    const mtimeMs = getMtimeMs(resolved);
    const cacheKey = `${resolved}:${mtimeMs}:${serializeMacros(context.macros)}`;
    const cached = includeCache.get(cacheKey);
    if (cached) {
      return new Map(cached);
    }

    let text;
    try {
      text = fs.readFileSync(resolved, 'utf8');
    } catch {
      return context.macros;
    }

    if (includedTexts && capturedIncludes && !capturedIncludes.has(resolved)) {
      capturedIncludes.add(resolved);
      includedTexts.push(text);
    }

    visited.add(resolved);
    const document = createTextDocument(resolved, text);
    const parsed = parseDocument(document, {
      initialMacros: context.macros,
      resolveInclude: createIncludeResolver({
        root,
        includeDirs: [path.dirname(resolved), ...includeDirs],
        includeCache,
        visited,
        includedTexts,
        capturedIncludes
      })
    });
    visited.delete(resolved);

    rememberIncludeCache(includeCache, cacheKey, new Map(parsed.macros));
    return parsed.macros;
  };
}

function rememberIncludeCache(cache, key, value) {
  if (cache.size >= MAX_INCLUDE_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
}

function parseIncludeArgument(argument) {
  const match = argument.match(/^(?:"([^"]+)"|<([^>]+)>)/);
  return match?.[1] ?? match?.[2];
}

function resolveIncludePath(includePath, searchDirs) {
  for (const dir of uniquePaths(searchDirs)) {
    const candidate = path.resolve(dir, includePath);
    if (fs.existsSync(candidate)) {
      return path.normalize(candidate);
    }
  }

  return undefined;
}

function createTextDocument(fileName, text) {
  const lines = text.split(/\r?\n/);
  return {
    fileName,
    lineCount: lines.length,
    lineAt(line) {
      const text = lines[line];
      return {
        text,
        isEmptyOrWhitespace: text.trim().length === 0
      };
    }
  };
}

function tokenizeCommandLine(command) {
  const tokens = [];
  let token = '';
  let quote;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        token += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
      continue;
    }

    token += char;
  }

  if (token) {
    tokens.push(token);
  }

  return tokens;
}

function serializeEntries(entries) {
  return entries.map((entry) => ({
    file: entry.file,
    directory: entry.directory,
    macros: [...entry.macros],
    includeDirs: entry.includeDirs
  }));
}

function deserializeEntries(entries = []) {
  return entries.map((entry) => ({
    file: entry.file,
    directory: entry.directory,
    macros: new Map(entry.macros ?? []),
    includeDirs: entry.includeDirs ?? []
  }));
}

function serializeMacros(macros) {
  return [...macros]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join(';');
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((value) => path.normalize(value)))];
}

function normalizePath(filePath) {
  return path.normalize(filePath).toLowerCase();
}

function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, '');
}

module.exports = {
  createParseOptionsForFile,
  parseCompileCommandEntry,
  tokenizeCommandLine,
  createTextDocument
};
