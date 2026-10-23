const C_KEYWORDS = [
  'auto',
  'break',
  'case',
  'char',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extern',
  'float',
  'for',
  'goto',
  'if',
  'inline',
  'int',
  'long',
  'register',
  'restrict',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'typedef',
  'union',
  'unsigned',
  'void',
  'volatile',
  'while',
  'NULL'
];

const C_LIBRARY_FUNCTIONS = [
  { name: 'printf', parameterTypes: ['const char *restrict', '...'] },
  { name: 'fprintf', parameterTypes: ['FILE *restrict', 'const char *restrict', '...'] },
  { name: 'sprintf', parameterTypes: ['char *restrict', 'const char *restrict', '...'] },
  { name: 'snprintf', parameterTypes: ['char *restrict', 'size_t', 'const char *restrict', '...'] },
  { name: 'scanf', parameterTypes: ['const char *restrict', '...'] },
  { name: 'sscanf', parameterTypes: ['const char *restrict', 'const char *restrict', '...'] },
  { name: 'fscanf', parameterTypes: ['FILE *restrict', 'const char *restrict', '...'] },
  { name: 'malloc', parameterTypes: ['size_t'] },
  { name: 'calloc', parameterTypes: ['size_t', 'size_t'] },
  { name: 'realloc', parameterTypes: ['void *', 'size_t'] },
  { name: 'free', parameterTypes: ['void *'] },
  { name: 'memset', parameterTypes: ['void *', 'int', 'size_t'] },
  { name: 'memcpy', parameterTypes: ['void *restrict', 'const void *restrict', 'size_t'] },
  { name: 'memmove', parameterTypes: ['void *', 'const void *', 'size_t'] },
  { name: 'memcmp', parameterTypes: ['const void *', 'const void *', 'size_t'] },
  { name: 'strlen', parameterTypes: ['const char *'] },
  { name: 'strcmp', parameterTypes: ['const char *', 'const char *'] },
  { name: 'strncmp', parameterTypes: ['const char *', 'const char *', 'size_t'] },
  { name: 'strcpy', parameterTypes: ['char *restrict', 'const char *restrict'] },
  { name: 'strncpy', parameterTypes: ['char *restrict', 'const char *restrict', 'size_t'] },
  { name: 'strdup', parameterTypes: ['const char *'] },
  { name: 'fopen', parameterTypes: ['const char *restrict', 'const char *restrict'] },
  { name: 'fclose', parameterTypes: ['FILE *'] },
  { name: 'fread', parameterTypes: ['void *restrict', 'size_t', 'size_t', 'FILE *restrict'] },
  { name: 'fwrite', parameterTypes: ['const void *restrict', 'size_t', 'size_t', 'FILE *restrict'] },
  { name: 'fgets', parameterTypes: ['char *restrict', 'int', 'FILE *restrict'] },
  { name: 'fputs', parameterTypes: ['const char *restrict', 'FILE *restrict'] },
  { name: 'puts', parameterTypes: ['const char *'] },
  { name: 'putchar', parameterTypes: ['int'] },
  { name: 'getchar', parameterTypes: ['void'] },
  { name: 'localtime_r', parameterTypes: ['const time_t *restrict', 'struct tm *restrict'] }
];

function collectCompletionCandidates(document, position, context = {}) {
  const source = getCompletionSource(document, context);
  const lineText = document.lineAt(position.line).text;
  const memberAccess = getMemberAccess(lineText, position.character);
  const preprocessorCompletion = isPreprocessorConditionLine(lineText, position.character);
  const candidates = new Map();

  if (preprocessorCompletion) {
    for (const macro of collectMacros(source)) {
      addCandidate(candidates, macro.name, 'macro');
    }
    for (const macro of context.macros ?? []) {
      addCandidate(candidates, macro[0], 'macro');
    }
    return [...candidates.values()];
  }

  if (memberAccess) {
    const fields = collectMemberNamesForAccess(source, memberAccess) ?? collectMemberNames(source);
    for (const field of fields) {
      addCandidate(candidates, field, 'field');
    }
    return [...candidates.values()];
  }

  for (const keyword of C_KEYWORDS) {
    addCandidate(candidates, keyword, 'keyword');
  }

  for (const macro of collectMacros(source)) {
    addCandidate(candidates, macro.name, 'macro');
  }

  for (const macro of context.macros ?? []) {
    addCandidate(candidates, macro[0], 'macro');
  }

  for (const enumConstant of collectEnumConstants(source)) {
    addCandidate(candidates, enumConstant.name, 'enum');
  }

  for (const fn of collectFunctions(source)) {
    addCandidate(candidates, fn.name, 'function', fn.signature, `${fn.name}(${fn.parameterTypes.join(', ')})`);
  }

  for (const fn of C_LIBRARY_FUNCTIONS) {
    addCandidate(candidates, fn.name, 'function', functionSignature(fn), `${fn.name}(${fn.parameterTypes.join(', ')})`);
  }

  for (const identifier of collectIdentifiers(source)) {
    addCandidate(candidates, identifier, 'identifier');
  }

  return [...candidates.values()];
}

function isLineInInactiveRegion(inactiveRegions, line) {
  return inactiveRegions.some(({ start, end }) => line >= start && line <= end);
}

function getDocumentText(document) {
  const lines = [];
  for (let line = 0; line < document.lineCount; line++) {
    lines.push(document.lineAt(line).text);
  }
  return lines.join('\n');
}

function getCompletionSource(document, context) {
  const parts = [getDocumentText(document)];
  if (typeof context.extraSource === 'string' && context.extraSource) {
    parts.push(context.extraSource);
  }
  if (Array.isArray(context.sourceTexts)) {
    parts.push(...context.sourceTexts.filter((text) => typeof text === 'string' && text));
  }
  return parts.join('\n');
}

function collectMacros(source) {
  return [...source.matchAll(/^\s*#\s*define\s+([A-Za-z_]\w*)/gm)]
    .map((match) => {
      const line = source.slice(match.index, source.indexOf('\n', match.index) === -1 ? undefined : source.indexOf('\n', match.index));
      const value = line
        .replace(/^\s*#\s*define\s+[A-Za-z_]\w*(?:\([^)]*\))?\s*/, '')
        .replace(/\/\*.*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .trim();
      return {
        name: match[1],
        value: value || undefined
      };
    });
}

function collectFunctions(source) {
  const functions = [];

  for (const match of source.matchAll(/^\s*(?!if\b|for\b|while\b|switch\b)([A-Za-z_][\w\s*]*?)\s+([A-Za-z_]\w*)\s*\(([^;{}#]*)\)\s*(?:\{|;)/gm)) {
    const returnType = normalizeType(match[1]);
    const name = match[2];
    if (!returnType || C_KEYWORDS.includes(name)) {
      continue;
    }

      const parameterTypes = parseParameterTypes(match[3]);
      functions.push({
        name,
        parameterTypes,
        signature: functionSignature({ name, parameterTypes })
      });
  }

  return functions;
}

function collectIdentifiers(source) {
  return [...source.matchAll(/\b[A-Za-z_]\w*\b/g)]
    .map((match) => match[0])
    .filter((name) => name.length > 1)
    .filter((name) => !C_KEYWORDS.includes(name));
}

function collectEnumConstants(source) {
  const constants = [];

  for (const match of source.matchAll(/\benum\s+\w*\s*\{([\s\S]*?)\}\s*\w*\s*;/g)) {
    let nextValue = 0;
    for (const rawEntry of match[1].split(',')) {
      const entry = rawEntry
        .replace(/\/\*.*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .trim();
      if (!entry) {
        continue;
      }

      const enumMatch = entry.match(/^([A-Za-z_]\w*)(?:\s*=\s*(.+))?$/);
      if (!enumMatch) {
        continue;
      }

      const explicitValue = enumMatch[2]?.trim();
      constants.push({
        name: enumMatch[1],
        value: explicitValue ?? String(nextValue)
      });

      nextValue = explicitValue && /^-?\d+$/.test(explicitValue)
        ? Number(explicitValue) + 1
        : nextValue + 1;
    }
  }

  return constants;
}

function parseParameterTypes(parameters) {
  const trimmed = parameters.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed === 'void') {
    return ['void'];
  }

  return splitParameters(trimmed).map(toParameterType).filter(Boolean);
}

function functionSignature(fn) {
  return `${fn.name}(${fn.parameterTypes.join(', ')})`;
}

function splitParameters(parameters) {
  const result = [];
  let current = '';
  let depth = 0;

  for (const char of parameters) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    }

    if (char === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

function toParameterType(parameter) {
  const cleaned = parameter
    .replace(/\s+/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .trim();

  if (cleaned === '...') {
    return '...';
  }

  const functionPointer = cleaned.match(/(.+?\(\s*\*)\s*[A-Za-z_]\w*(\s*\)\s*\(.+\))/);
  if (functionPointer) {
    return `${functionPointer[1]}${functionPointer[2]}`.replace(/\s+/g, ' ');
  }

  return normalizeType(cleaned
    .replace(/\s*\*+\s*([A-Za-z_]\w*)$/, (match, name) => match.replace(name, '').trim())
    .replace(/\s+([A-Za-z_]\w*)$/, ''));
}

function normalizeType(type) {
  return type
    .replace(/\s+/g, ' ')
    .replace(/\s*\*+\s*$/, (stars) => ` ${stars.trim()}`)
    .trim();
}

function collectMemberNames(source) {
  const fields = new Set();

  for (const match of source.matchAll(/\b(?:struct|union)\s+\w*\s*\{([\s\S]*?)\}\s*\w*\s*;/g)) {
    collectFieldsFromBlock(match[1], fields);
  }

  for (const match of source.matchAll(/(?:->|\.)\s*([A-Za-z_]\w*)/g)) {
    fields.add(match[1]);
  }

  return [...fields];
}

function collectMemberNamesForAccess(source, access) {
  const structName = findStructTypeForVariable(source, access.object);
  if (!structName) {
    return undefined;
  }

  const fields = collectStructFields(source).get(structName);
  return fields ? [...fields] : undefined;
}

function collectStructFields(source) {
  const structs = new Map();

  for (const match of source.matchAll(/\b(?:typedef\s+)?(struct|union)\s+(\w+)?\s*\{([\s\S]*?)\}\s*(\w+)?\s*;/g)) {
    const tagName = match[2];
    const typedefName = match[4];
    const fields = new Set();
    collectFieldsFromBlock(match[3], fields);

    if (tagName) {
      structs.set(tagName, fields);
    }
    if (typedefName) {
      structs.set(typedefName, fields);
    }
  }

  return structs;
}

function findStructTypeForVariable(source, variableName) {
  const escaped = escapeRegExp(variableName);
  const structPattern = new RegExp(`\\bstruct\\s+(\\w+)\\s*\\*?\\s*${escaped}\\b`);
  const structMatch = source.match(structPattern);
  if (structMatch) {
    return structMatch[1];
  }

  const typedefPattern = new RegExp(`\\b(\\w+)\\s*\\*?\\s*${escaped}\\b`);
  for (const match of source.matchAll(typedefPattern)) {
    if (!C_KEYWORDS.includes(match[1])) {
      return match[1];
    }
  }

  return undefined;
}

function collectFieldsFromBlock(block, fields) {
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine
      .replace(/\/\*.*?\*\//g, '')
      .replace(/\/\/.*$/, '')
      .trim();
    if (!line || !line.endsWith(';') || line.includes('(')) {
      continue;
    }

    const declaration = line.slice(0, -1);
    for (const part of declaration.split(',')) {
      const match = part.trim().match(/(?:\*|\s)([A-Za-z_]\w*)(?:\s*\[[^\]]*\])?$/);
      if (match) {
        fields.add(match[1]);
      }
    }
  }
}

function isMemberAccess(lineText, character) {
  return Boolean(getMemberAccess(lineText, character));
}

function getMemberAccess(lineText, character) {
  const prefix = lineText.slice(0, character);
  const match = prefix.match(/([A-Za-z_]\w*)\s*(->|\.)\s*(?:[A-Za-z_]\w*)?$/);
  if (!match) {
    return undefined;
  }

  return {
    object: match[1],
    operator: match[2]
  };
}

function isPreprocessorConditionLine(lineText, character) {
  const prefix = lineText.slice(0, character);
  return /^\s*#\s*(?:if|ifdef|ifndef|elif)\b/.test(prefix);
}

function addCandidate(candidates, label, kind, detail, insertText = label) {
  if (!label || candidates.has(label)) {
    return;
  }

  candidates.set(label, {
    label,
    kind,
    detail,
    insertText
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  collectCompletionCandidates,
  collectMemberNamesForAccess,
  isLineInInactiveRegion,
  isMemberAccess
};
