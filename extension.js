const vscode = require('vscode');
const {
  parseDocument,
  parseDirective,
  findMatchingDirectiveLines,
  getDirectiveSpan,
  getDirectiveActivationSpan,
  isCharacterInDirectiveSpan
} = require('./parser');
const {
  collectCompletionCandidates,
  isLineInInactiveRegion
} = require('./completion');
const { createParseOptionsForFile } = require('./project-context');

let matchDecoration;
let inactiveDecoration;
let inactiveCodeDecoration;
let activeEditor;
let refreshTimer;
const parseCache = new Map();

function activate(context) {
  createDecorations();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      activeEditor = editor;
      updateDecorations();
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === activeEditor) {
        updateDecorations();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isCOrCppDocument(event.document)) {
        invalidateParseCache();
        scheduleUpdateDecorations();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('cPreprocessorVisualizer.inactiveColor') ||
        event.affectsConfiguration('cPreprocessorVisualizer.inactiveOpacity') ||
        event.affectsConfiguration('cPreprocessorVisualizer.showInactiveRegions') ||
        event.affectsConfiguration('cPreprocessorVisualizer.inactiveCodeOpacity')
      ) {
        createDecorations();
        updateDecorations();
      }
    }),
    vscode.languages.registerCompletionItemProvider(
      [
        { language: 'c' },
        { language: 'cpp' },
        { language: 'objective-c' },
        { language: 'objective-cpp' }
      ],
      {
        provideCompletionItems(document, position) {
          return provideInactiveRegionCompletions(document, position);
        }
      },
      '.',
      '>'
    ),
    createWorkspaceWatcher('**/*.{c,cc,cpp,cxx,h,hh,hpp,hxx}'),
    createWorkspaceWatcher('**/build/compile_commands.json')
  );

  activeEditor = vscode.window.activeTextEditor;
  updateDecorations();
}

function deactivate() {}

function createWorkspaceWatcher(globPattern) {
  const watcher = vscode.workspace.createFileSystemWatcher(globPattern);
  watcher.onDidCreate(handleProjectInputChanged);
  watcher.onDidChange(handleProjectInputChanged);
  watcher.onDidDelete(handleProjectInputChanged);
  return watcher;
}

function handleProjectInputChanged() {
  invalidateParseCache();
  scheduleUpdateDecorations();
}

function invalidateParseCache() {
  parseCache.clear();
}

function scheduleUpdateDecorations() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(updateDecorations, 80);
}

function createDecorations() {
  matchDecoration?.dispose();
  inactiveDecoration?.dispose();
  inactiveCodeDecoration?.dispose();

  const inactiveColor = vscode.workspace
    .getConfiguration('cPreprocessorVisualizer')
    .get('inactiveColor', '#5ac83cd9');
  const inactiveOpacity = vscode.workspace
    .getConfiguration('cPreprocessorVisualizer')
    .get('inactiveOpacity', 1);
  const inactiveCodeOpacity = vscode.workspace
    .getConfiguration('cPreprocessorVisualizer')
    .get('inactiveCodeOpacity', 1);

  matchDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 214, 102, 0.22)',
    border: '1px solid rgba(255, 193, 7, 0.85)',
    overviewRulerColor: 'rgba(255, 193, 7, 0.85)',
    overviewRulerLane: vscode.OverviewRulerLane.Right
  });

  inactiveDecoration = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: applyOpacityToColor(inactiveColor, 0.85),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    gutterIconPath: createInactiveGutterIconUri(inactiveColor, clamp(inactiveOpacity, 0.1, 1)),
    gutterIconSize: 'contain'
  });

  inactiveCodeDecoration = vscode.window.createTextEditorDecorationType({
    opacity: String(clamp(inactiveCodeOpacity, 0.1, 1))
  });
}

function updateDecorations() {
  const editor = activeEditor;
  if (!editor || !isCOrCppDocument(editor.document)) {
    return;
  }

  const parsed = getParsedDocument(editor.document);
  const showInactiveRegions = vscode.workspace
    .getConfiguration('cPreprocessorVisualizer')
    .get('showInactiveRegions', true);
  editor.setDecorations(
    inactiveDecoration,
    showInactiveRegions
      ? createInactiveRegionRanges(editor.document, parsed.inactiveRegions)
      : []
  );
  editor.setDecorations(
    inactiveCodeDecoration,
    createInactiveCodeRanges(editor.document, parsed.inactiveRegions)
  );
  editor.setDecorations(matchDecoration, findMatchingDirectiveRanges(editor, parsed.groups));
}

function getParsedDocument(document) {
  const cacheKey = document.uri.toString();
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  const parseOptions = createParseOptionsForFile(document.fileName, workspaceFolder);
  const cached = parseCache.get(cacheKey);
  if (
    cached &&
    cached.version === document.version &&
    cached.signature === parseOptions.signature
  ) {
    return cached.parsed;
  }

  const parsed = parseDocument(document, parseOptions);
  parsed.includedTexts = parseOptions.includedTexts ?? [];
  parseCache.set(cacheKey, {
    version: document.version,
    signature: parseOptions.signature,
    parsed
  });
  return parsed;
}

function isCOrCppDocument(document) {
  if (['c', 'cpp', 'objective-c', 'objective-cpp'].includes(document.languageId)) {
    return true;
  }

  return /\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(document.fileName);
}

function provideInactiveRegionCompletions(document, position) {
  const enabled = vscode.workspace
    .getConfiguration('cPreprocessorVisualizer')
    .get('enableInactiveCompletions', true);
  if (!enabled || !isCOrCppDocument(document)) {
    return undefined;
  }

  const parsed = getParsedDocument(document);
  if (!isLineInInactiveRegion(parsed.inactiveRegions, position.line)) {
    return undefined;
  }

  return collectCompletionCandidates(document, position, {
    macros: parsed.macros,
    sourceTexts: parsed.includedTexts
  }).map(toCompletionItem);
}

function toCompletionItem(candidate) {
  const item = new vscode.CompletionItem(candidate.label, toCompletionItemKind(candidate.kind));
  item.insertText = candidate.insertText;
  item.detail = toCompletionDetail(candidate);
  if (candidate.detail !== undefined) {
    item.documentation = new vscode.MarkdownString(`\`${candidate.detail}\``);
  }
  return item;
}

function toCompletionDetail(candidate) {
  if (candidate.kind === 'function' && candidate.detail !== undefined) {
    return `函数 ${candidate.detail}`;
  }

  return 'C 预处理可视化 inactive 补全';
}

function toCompletionItemKind(kind) {
  if (kind === 'keyword') {
    return vscode.CompletionItemKind.Keyword;
  }

  if (kind === 'macro') {
    return vscode.CompletionItemKind.Constant;
  }

  if (kind === 'function') {
    return vscode.CompletionItemKind.Function;
  }

  if (kind === 'enum') {
    return vscode.CompletionItemKind.EnumMember;
  }

  if (kind === 'field') {
    return vscode.CompletionItemKind.Field;
  }

  return vscode.CompletionItemKind.Variable;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return max;
  }

  return Math.min(max, Math.max(min, number));
}

function applyOpacityToColor(color, opacity) {
  const parsed = parseHexColor(color);
  if (!parsed) {
    return color;
  }

  const alpha = Math.round(parsed.alpha * opacity * 1000) / 1000;
  return `rgba(${parsed.red}, ${parsed.green}, ${parsed.blue}, ${alpha})`;
}

function createInactiveGutterIconUri(color, opacity) {
  const parsed = parseHexColor(color) ?? parseHexColor('#5ac83cd9');
  const alpha = Math.round(parsed.alpha * opacity * 1000) / 1000;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="18" viewBox="0 0 16 18">',
    `<rect x="7" y="0" width="3" height="18" fill="rgb(${parsed.red}, ${parsed.green}, ${parsed.blue})" fill-opacity="${alpha}"/>`,
    '</svg>'
  ].join('');
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function parseHexColor(color) {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!match) {
    return undefined;
  }

  const hex = match[1];
  if (hex.length === 3) {
    return {
      red: parseInt(hex[0] + hex[0], 16),
      green: parseInt(hex[1] + hex[1], 16),
      blue: parseInt(hex[2] + hex[2], 16),
      alpha: 1
    };
  }

  return {
    red: parseInt(hex.slice(0, 2), 16),
    green: parseInt(hex.slice(2, 4), 16),
    blue: parseInt(hex.slice(4, 6), 16),
    alpha: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
  };
}

function findMatchingDirectiveRanges(editor, groups) {
  const cursorLine = editor.selection.active.line;
  const activeSpan = getDirectiveActivationSpan(editor.document.lineAt(cursorLine).text);
  if (!isCharacterInDirectiveSpan(activeSpan, editor.selection.active.character)) {
    return [];
  }

  return findMatchingDirectiveLines(editor.document, cursorLine, groups)
    .map((line) => {
      const textLine = editor.document.lineAt(line);
      const span = getDirectiveSpan(textLine.text);
      if (!span) {
        return undefined;
      }

      return new vscode.Range(line, span.start, line, span.end);
    })
    .filter(Boolean);
}

function createInactiveRegionRanges(document, inactiveRegions = []) {
  const ranges = [];
  for (const { start, end } of inactiveRegions) {
    const lastLine = Math.min(end, document.lineCount - 1);
    for (let line = Math.max(start, 0); line <= lastLine; line++) {
      ranges.push(document.lineAt(line).range);
    }
  }
  return ranges;
}

function createInactiveCodeRanges(document, inactiveRegions = []) {
  const ranges = [];
  for (const { start, end } of inactiveRegions) {
    const lastLine = Math.min(end, document.lineCount - 1);
    for (let line = Math.max(start, 0); line <= lastLine; line++) {
      const textLine = document.lineAt(line);
      if (parseDirective(textLine.text) || textLine.isEmptyOrWhitespace) {
        continue;
      }
      ranges.push(textLine.range);
    }
  }
  return ranges;
}

module.exports = {
  activate,
  deactivate
};
