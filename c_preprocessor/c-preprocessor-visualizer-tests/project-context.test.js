const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createParseOptionsForFile,
  createTextDocument,
  parseCompileCommandEntry,
  tokenizeCommandLine
} = require('../project-context');
const { parseDocument } = require('../parser');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c-preprocessor-visualizer-'));
const includeDir = path.join(tempRoot, 'include');
const srcDir = path.join(tempRoot, 'src');
const buildDir = path.join(tempRoot, 'build');
fs.mkdirSync(includeDir, { recursive: true });
fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

const headerPath = path.join(includeDir, 'feature_config.h');
const sourcePath = path.join(srcDir, 'main.c');
const compileCommandsPath = path.join(buildDir, 'compile_commands.json');

fs.writeFileSync(headerPath, [
  '#ifndef FEATURE_CONFIG_H',
  '#define FEATURE_CONFIG_H',
  '#define HEADER_FEATURE 1',
  'int header_configure_runtime(const char *name);',
  '#endif',
  ''
].join('\n'));

fs.writeFileSync(sourcePath, [
  '#include <feature_config.h>',
  '',
  '#if HEADER_FEATURE && COMMAND_LINE_FEATURE == 7',
  'int enabled_from_header_and_compile_command = 1;',
  '#else',
  'int inactive_without_external_context = 1;',
  '#endif',
  ''
].join('\n'));

fs.writeFileSync(compileCommandsPath, JSON.stringify([
  {
    directory: srcDir,
    command: `clang -I${includeDir} -DCOMMAND_LINE_FEATURE=7 -c ${sourcePath}`,
    file: sourcePath
  }
], null, 2));

const args = tokenizeCommandLine('clang -I"include path" -DNAME=1 -UOLD file.c');
assert.deepStrictEqual(
  args,
  ['clang', '-Iinclude path', '-DNAME=1', '-UOLD', 'file.c'],
  'command tokenizer should preserve quoted include paths'
);

const parsedEntry = parseCompileCommandEntry({
  directory: srcDir,
  command: 'clang -I../include -DFOO=42 -DBAR -UOLD main.c',
  file: sourcePath
}, tempRoot);
assert.strictEqual(parsedEntry.macros.get('FOO'), '42');
assert.strictEqual(parsedEntry.macros.get('BAR'), '1');
assert.deepStrictEqual(parsedEntry.includeDirs, [includeDir]);

const text = fs.readFileSync(sourcePath, 'utf8');
const document = createTextDocument(sourcePath, text);
const options = createParseOptionsForFile(sourcePath, tempRoot);
const parsed = parseDocument(document, options);

assert.deepStrictEqual(
  parsed.inactiveLines,
  [5],
  'headers and compile command macros should make only the #else branch inactive'
);
assert.ok(
  options.includedTexts.join('\n').includes('header_configure_runtime'),
  'include resolver should expose included header text for inactive completions'
);

const cachePath = path.join(buildDir, 'c-preprocessor-visualizer-cache.json');
assert.ok(fs.existsSync(cachePath), 'project data cache should be written under build');

const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
cache.updatedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
fs.writeFileSync(cachePath, JSON.stringify(cache));
createParseOptionsForFile(sourcePath, tempRoot);
const refreshedCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
assert.ok(
  Date.now() - refreshedCache.updatedAt < 60 * 1000,
  'expired project data cache should be refreshed'
);

fs.rmSync(tempRoot, { recursive: true, force: true });

console.log('project context tests passed');
