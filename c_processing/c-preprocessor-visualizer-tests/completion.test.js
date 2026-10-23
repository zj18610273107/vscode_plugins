const assert = require('assert');
const {
  collectCompletionCandidates,
  collectMemberNamesForAccess,
  isLineInInactiveRegion,
  isMemberAccess
} = require('../completion');
const { parseDocument } = require('../parser');

function createDocument(text) {
  const lines = text.split(/\r?\n/);
  return {
    lineCount: lines.length,
    lineAt(line) {
      return {
        text: lines[line],
        isEmptyOrWhitespace: lines[line].trim().length === 0
      };
    }
  };
}

const source = `
#define ENABLE_BLOCK 0
#define FEATURE_NAME 1
#define FEATURE_TEXT "enabled"

enum log_level {
  LOG_INFO = 3,
  LOG_WARN,
  LOG_ERROR = 8
};

struct log_context {
  int level;
  const char *message;
};

struct other_context {
  int unrelated;
};

static int append_log(struct log_context *ctx);
void reset_log(void);
int printf(const char *restrict format, ...);

#if ENABLE_BLOCK
static int disabled_code(struct log_context *ctx)
{
  ctx->
  return FEATURE_NAME;
  snprintf(buf, sizeof(buf), "launcherd: ");
  printf("version: %s\\n", GIT_VERSION);
}
#endif
`.trim();

const document = createDocument(source);
const parsed = parseDocument(document);

function findLine(text) {
  for (let line = 0; line < document.lineCount; line++) {
    if (document.lineAt(line).text.trim() === text) {
      return line;
    }
  }

  throw new Error(`Line not found: ${text}`);
}

const memberAccessLine = findLine('ctx->');
const returnLine = findLine('return FEATURE_NAME;');
const ifLine = findLine('#if ENABLE_BLOCK');

assert.ok(
  isLineInInactiveRegion(parsed.inactiveRegions, memberAccessLine),
  'completion should only be enabled inside inactive regions'
);

assert.strictEqual(isMemberAccess('  ctx->', 7), true);
assert.strictEqual(isMemberAccess('  ctx', 5), false);

const labels = collectCompletionCandidates(document, { line: returnLine, character: 9 })
  .map((candidate) => candidate.label);
assert.ok(labels.includes('return'));
assert.ok(labels.includes('FEATURE_NAME'));
assert.ok(labels.includes('append_log'));
assert.ok(labels.includes('disabled_code'));
assert.ok(labels.includes('LOG_WARN'));

const candidates = collectCompletionCandidates(document, { line: returnLine, character: 9 });
assert.strictEqual(
  candidates.find((candidate) => candidate.label === 'FEATURE_TEXT').detail,
  undefined,
  'macro completions should not expose object-like macro values'
);
assert.strictEqual(
  candidates.find((candidate) => candidate.label === 'LOG_WARN').detail,
  undefined,
  'enum completions should not expose inferred enum values'
);
assert.strictEqual(
  candidates.find((candidate) => candidate.label === 'append_log').insertText,
  'append_log(struct log_context *)',
  'function completions should insert function name with parameter types'
);
assert.strictEqual(
  candidates.find((candidate) => candidate.label === 'printf').insertText,
  'printf(const char *restrict, ...)',
  'variadic function completions should insert parameter types instead of call argument values'
);
assert.strictEqual(
  candidates.find((candidate) => candidate.label === 'snprintf').insertText,
  'snprintf(char *restrict, size_t, const char *restrict, ...)',
  'common C library functions should be available as inactive completions'
);
assert.strictEqual(
  candidates.find((candidate) => candidate.label === 'reset_log').insertText,
  'reset_log(void)',
  'void parameter functions should insert void explicitly'
);

const headerCandidates = collectCompletionCandidates(
  document,
  { line: returnLine, character: 9 },
  { sourceTexts: ['int header_log_append(const char *message, size_t size);'] }
);
assert.strictEqual(
  headerCandidates.find((candidate) => candidate.label === 'header_log_append').insertText,
  'header_log_append(const char *, size_t)',
  'function completions should include declarations from included headers'
);

const memberLabels = collectCompletionCandidates(document, { line: memberAccessLine, character: 7 })
  .map((candidate) => candidate.label);
assert.ok(memberLabels.includes('level'));
assert.ok(memberLabels.includes('message'));
assert.ok(!memberLabels.includes('unrelated'));

assert.deepStrictEqual(
  collectMemberNamesForAccess(source, { object: 'ctx', operator: '->' }),
  ['level', 'message'],
  'member completion should prefer fields from the inferred struct type'
);

const preprocessorLabels = collectCompletionCandidates(
  document,
  { line: ifLine, character: '#if ENABLE'.length },
  { macros: new Map([['EXTERNAL_CONFIG', '1']]) }
).map((candidate) => candidate.label);
assert.ok(preprocessorLabels.includes('ENABLE_BLOCK'));
assert.ok(preprocessorLabels.includes('FEATURE_NAME'));
assert.ok(preprocessorLabels.includes('EXTERNAL_CONFIG'));
assert.ok(!preprocessorLabels.includes('return'));

console.log('completion tests passed');
