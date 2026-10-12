const assert = require('assert');
const {
  parseDocument,
  findMatchingDirectiveLines,
  filterInactiveLinesForActiveBlock,
  getDirectiveSpan,
  getDirectiveActivationSpan,
  isCharacterInDirectiveSpan
} = require('../parser');

const C_PREPROCESSOR_SOURCE = `
#ifndef __C_PREPROCESSOR_VISUALIZER_SAMPLE_H_
#define __C_PREPROCESSOR_VISUALIZER_SAMPLE_H_

#define AAAAAAAAAA 1
#define FEATURE_X 1
#define FEATURE_Y 0
#define TARGET_LEVEL 2
#define USE_FAST_PATH 1
#define TEMP_SWITCH 1

#ifdef AAAAAAAAAA
int a = 0;
#else
int b = 0;
#endif

#if defined(FEATURE_X) && TARGET_LEVEL >= 2
int feature_x_level = 2;
  #ifdef USE_FAST_PATH
  int fast_path_enabled = 1;
  #else
  int slow_path_enabled = 1;
  #endif
#elif defined(FEATURE_Y)
int feature_y_fallback = 1;
#else
int no_feature_enabled = 1;
#endif

#ifndef DISABLE_LOGGING
int logging_enabled = 1;
  #if FEATURE_Y
  int verbose_logging = 1;
  #else
  int compact_logging = 1;
  #endif
#endif

#undef TEMP_SWITCH

#ifdef TEMP_SWITCH
int temp_switch_enabled = 1;
#else
int temp_switch_disabled = 1;
#endif

#if defined(UNKNOWN_MACRO) || defined(USE_FAST_PATH)
int known_or_fast = 1;
#else
int neither_known_nor_fast = 1;
#endif

#define HARDWARE_TEST_DEBUG_MODE_CTRL 0

#if HARDWARE_TEST_DEBUG_MODE_CTRL == 0
  #define HARDWARE_TEST_TIMEOUT_START_RUN 1800 /* 30 minutes */
  #define HARDWARE_LOOPS 999
#else
  #define HARDWARE_TEST_TIMEOUT_START_RUN 10 /* 30 seconds */
  #define HARDWARE_LOOPS 3
#endif

#endif
`.trim();

function createDocument(text) {
  const lines = text.split(/\r?\n/);

  return {
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

const document = createDocument(C_PREPROCESSOR_SOURCE);
const parsed = parseDocument(document);

function findLine(text, occurrence = 1) {
  let seen = 0;
  for (let line = 0; line < document.lineCount; line++) {
    if (document.lineAt(line).text.trim() === text) {
      seen += 1;
      if (seen === occurrence) {
        return line;
      }
    }
  }

  throw new Error(`Line not found: ${text}`);
}

assert.deepStrictEqual(
  parsed.inactiveLines,
  [
    findLine('int b = 0;'),
    findLine('int slow_path_enabled = 1;'),
    findLine('int feature_y_fallback = 1;'),
    findLine('int no_feature_enabled = 1;'),
    findLine('int verbose_logging = 1;'),
    findLine('int temp_switch_enabled = 1;'),
    findLine('int neither_known_nor_fast = 1;'),
    findLine('#define HARDWARE_TEST_TIMEOUT_START_RUN 10 /* 30 seconds */'),
    findLine('#define HARDWARE_LOOPS 3')
  ],
  'inactive C preprocessor branch bodies should be marked inactive'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(document, findLine('#ifdef AAAAAAAAAA'), parsed.groups),
  [
    findLine('#ifdef AAAAAAAAAA'),
    findLine('#else'),
    findLine('#endif')
  ],
  'cursor on #ifdef should highlight that #ifdef, its matching #else, and #endif'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(document, findLine('#else'), parsed.groups),
  [
    findLine('#ifdef AAAAAAAAAA'),
    findLine('#else'),
    findLine('#endif')
  ],
  'cursor on #else should highlight the matching #ifdef, #else, and #endif'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(document, findLine('#endif'), parsed.groups),
  [
    findLine('#ifdef AAAAAAAAAA'),
    findLine('#else'),
    findLine('#endif')
  ],
  'cursor on #endif for a branch with #else should highlight the matching #ifdef, #else, and #endif'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(document, findLine('#if defined(FEATURE_X) && TARGET_LEVEL >= 2'), parsed.groups),
  [
    findLine('#if defined(FEATURE_X) && TARGET_LEVEL >= 2'),
    findLine('#elif defined(FEATURE_Y)'),
    findLine('#else', 3),
    findLine('#endif', 3)
  ],
  'cursor on a #if with #elif should highlight #if, #elif, #else, and #endif'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(document, findLine('#elif defined(FEATURE_Y)'), parsed.groups),
  [
    findLine('#if defined(FEATURE_X) && TARGET_LEVEL >= 2'),
    findLine('#elif defined(FEATURE_Y)'),
    findLine('#else', 3),
    findLine('#endif', 3)
  ],
  'cursor on #elif should highlight the full branch directive set'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(document, findLine('#if HARDWARE_TEST_DEBUG_MODE_CTRL == 0'), parsed.groups),
  [
    findLine('#if HARDWARE_TEST_DEBUG_MODE_CTRL == 0'),
    findLine('#else', 7),
    findLine('#endif', 8)
  ],
  'cursor on a numeric macro #if should highlight the full hardware control branch'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(document, findLine('#ifndef __C_PREPROCESSOR_VISUALIZER_SAMPLE_H_'), parsed.groups),
  [findLine('#ifndef __C_PREPROCESSOR_VISUALIZER_SAMPLE_H_'), document.lineCount - 1],
  'cursor on the outer #ifndef should highlight its matching #endif when there is no #else'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(document, document.lineCount - 1, parsed.groups),
  [findLine('#ifndef __C_PREPROCESSOR_VISUALIZER_SAMPLE_H_'), document.lineCount - 1],
  'cursor on the outer #endif should highlight the matching #ifndef when there is no #else'
);

assert.deepStrictEqual(
  getDirectiveSpan('#ifdef AAAAAAAAAA'),
  { start: 0, end: 6 },
  'only the #ifdef token should be highlighted, not the whole line'
);

assert.deepStrictEqual(
  getDirectiveSpan('    #   endif'),
  { start: 4, end: 13 },
  'directive spans should include the # and directive keyword with internal spacing'
);

assert.strictEqual(
  isCharacterInDirectiveSpan(getDirectiveSpan('#else'), 5),
  true,
  'cursor immediately after a directive keyword should still activate matching highlights'
);

assert.strictEqual(
  isCharacterInDirectiveSpan(getDirectiveSpan('#else'), 6),
  false,
  'cursor after the directive token boundary should not activate matching highlights'
);

assert.strictEqual(
  isCharacterInDirectiveSpan(getDirectiveActivationSpan('#ifdef AAAAAAAAAA'), 7),
  true,
  'cursor after whitespace following a directive keyword should still activate matching highlights'
);

assert.strictEqual(
  isCharacterInDirectiveSpan(getDirectiveActivationSpan('#ifdef AAAAAAAAAA'), 8),
  false,
  'cursor inside the directive argument should not activate matching highlights'
);

assert.strictEqual(
  isCharacterInDirectiveSpan(getDirectiveActivationSpan('#else   '), 8),
  true,
  'cursor after trailing whitespace following #else should still activate matching highlights'
);

const EDGE_CASE_SOURCE = `
#define MODE 2
#define BASE_ENABLED 1
#define COMMENTED_VALUE 0 /* disabled by default */
#define FUNCTION_LIKE(x) 1

#if MODE == 1
int mode_one = 1;
#elif MODE == 2
int mode_two = 1;
#endif

#if 0
#define BASE_ENABLED 0
#undef COMMENTED_VALUE
  #if 1
  int nested_active_but_parent_inactive = 1;
  #else
  int nested_else_parent_inactive = 1;
  #endif
#endif

#ifdef BASE_ENABLED
int base_still_enabled = 1;
#else
int base_was_modified_by_inactive_branch = 1;
#endif

#if COMMENTED_VALUE == 0
int commented_value_is_zero = 1;
#else
int commented_value_is_not_zero = 1;
#endif

#ifdef FUNCTION_LIKE
int function_like_macro_is_defined = 1;
#else
int function_like_macro_is_missing = 1;
#endif

#    ifdef BASE_ENABLED
int spaced_directive_active = 1;
#    else
int spaced_directive_inactive = 1;
#    endif
`.trim();

const edgeDocument = createDocument(EDGE_CASE_SOURCE);
const edgeParsed = parseDocument(edgeDocument);

function findEdgeLine(text, occurrence = 1) {
  let seen = 0;
  for (let line = 0; line < edgeDocument.lineCount; line++) {
    if (edgeDocument.lineAt(line).text.trim() === text) {
      seen += 1;
      if (seen === occurrence) {
        return line;
      }
    }
  }

  throw new Error(`Edge line not found: ${text}`);
}

assert.deepStrictEqual(
  edgeParsed.inactiveLines,
  [
    findEdgeLine('int mode_one = 1;'),
    findEdgeLine('#define BASE_ENABLED 0'),
    findEdgeLine('#undef COMMENTED_VALUE'),
    findEdgeLine('#if 1'),
    findEdgeLine('int nested_active_but_parent_inactive = 1;'),
    findEdgeLine('#else'),
    findEdgeLine('int nested_else_parent_inactive = 1;'),
    findEdgeLine('#endif', 2),
    findEdgeLine('int base_was_modified_by_inactive_branch = 1;'),
    findEdgeLine('int commented_value_is_not_zero = 1;'),
    findEdgeLine('int function_like_macro_is_missing = 1;'),
    findEdgeLine('int spaced_directive_inactive = 1;')
  ],
  'edge cases should keep inactive macro directives inactive and avoid mutating active macro state'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(edgeDocument, findEdgeLine('#if MODE == 1'), edgeParsed.groups),
  [
    findEdgeLine('#if MODE == 1'),
    findEdgeLine('#elif MODE == 2'),
    findEdgeLine('#endif')
  ],
  'a #if/#elif/#endif group without #else should still highlight all group directives'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(edgeDocument, findEdgeLine('#elif MODE == 2'), edgeParsed.groups),
  [
    findEdgeLine('#if MODE == 1'),
    findEdgeLine('#elif MODE == 2'),
    findEdgeLine('#endif')
  ],
  'cursor on #elif without #else should still resolve the whole group'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(edgeDocument, findEdgeLine('int mode_two = 1;'), edgeParsed.groups),
  [],
  'cursor on a normal C statement should not resolve directive matches'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(edgeDocument, findEdgeLine('#    ifdef BASE_ENABLED'), edgeParsed.groups),
  [
    findEdgeLine('#    ifdef BASE_ENABLED'),
    findEdgeLine('#    else'),
    findEdgeLine('#    endif')
  ],
  'directives with spaces after # should still match as one preprocessor group'
);

assert.deepStrictEqual(
  getDirectiveSpan('#    ifdef BASE_ENABLED'),
  { start: 0, end: 10 },
  'directive spans should include spaced #ifdef tokens'
);

const SINGLE_SPACED_DIRECTIVE_SOURCE = `
# if BASE_ENABLED
int single_spaced_directive_active = 1;
# else
int single_spaced_directive_inactive = 1;
# endif
`.trim();

const singleSpacedDirectiveDocument = createDocument(SINGLE_SPACED_DIRECTIVE_SOURCE);
const singleSpacedDirectiveParsed = parseDocument(singleSpacedDirectiveDocument, {
  initialMacros: [['BASE_ENABLED', '1']]
});

assert.deepStrictEqual(
  singleSpacedDirectiveParsed.inactiveLines,
  [3],
  '# if/# else/# endif should be parsed with a space between # and the directive'
);

assert.deepStrictEqual(
  findMatchingDirectiveLines(singleSpacedDirectiveDocument, 0, singleSpacedDirectiveParsed.groups),
  [0, 2, 4],
  '# if should match its # else and # endif'
);

const NESTED_IN_INACTIVE_SOURCE = `
#define CONFIG_ENABLE_LOG_DATE 0
#define CONFIG_ENABLE_LOG_TIME 0

#if CONFIG_ENABLE_LOG_DATE > 0 || CONFIG_ENABLE_LOG_TIME > 0
static int log_append_date_time_enabled(void)
{
#if CONFIG_ENABLE_LOG_DATE > 0 && CONFIG_ENABLE_LOG_TIME > 0
  #define convent_formater "date time"
#elif CONFIG_ENABLE_LOG_DATE > 0
  #define convent_formater "date"
#else
  #define convent_formater "time"
#endif
  return 1;
}
#else
static int log_append_date_time_disabled(void)
{
  return 0;
}
#endif
`.trim();

const nestedInactiveDocument = createDocument(NESTED_IN_INACTIVE_SOURCE);
const nestedInactiveParsed = parseDocument(nestedInactiveDocument);

function findNestedInactiveLine(text, occurrence = 1) {
  let seen = 0;
  for (let line = 0; line < nestedInactiveDocument.lineCount; line++) {
    if (nestedInactiveDocument.lineAt(line).text.trim() === text) {
      seen += 1;
      if (seen === occurrence) {
        return line;
      }
    }
  }

  throw new Error(`Nested inactive line not found: ${text}`);
}

assert.deepStrictEqual(
  nestedInactiveParsed.inactiveLines,
  [
    findNestedInactiveLine('static int log_append_date_time_enabled(void)'),
    findNestedInactiveLine('{'),
    findNestedInactiveLine('#if CONFIG_ENABLE_LOG_DATE > 0 && CONFIG_ENABLE_LOG_TIME > 0'),
    findNestedInactiveLine('#define convent_formater "date time"'),
    findNestedInactiveLine('#elif CONFIG_ENABLE_LOG_DATE > 0'),
    findNestedInactiveLine('#define convent_formater "date"'),
    findNestedInactiveLine('#else'),
    findNestedInactiveLine('#define convent_formater "time"'),
    findNestedInactiveLine('#endif'),
    findNestedInactiveLine('return 1;'),
    findNestedInactiveLine('}', 1)
  ],
  'nested preprocessor directives inside an inactive outer branch should also be marked inactive'
);

assert.deepStrictEqual(
  filterInactiveLinesForActiveBlock(nestedInactiveParsed.inactiveLines),
  nestedInactiveParsed.inactiveLines,
  'inactive branch markers should remain visible when the cursor enters an outer inactive block'
);

assert.deepStrictEqual(
  filterInactiveLinesForActiveBlock(nestedInactiveParsed.inactiveLines),
  nestedInactiveParsed.inactiveLines,
  'inactive branch markers should remain visible when the cursor enters a nested inactive branch'
);

assert.deepStrictEqual(
  filterInactiveLinesForActiveBlock([2, 3, 4, 8, 9], 3),
  [2, 3, 4, 8, 9],
  'inactive lines should remain marked when the cursor is inside inactive blocks'
);

assert.deepStrictEqual(
  filterInactiveLinesForActiveBlock([2, 3, 4, 8, 9], 7),
  [2, 3, 4, 8, 9],
  'inactive lines should remain colored when the cursor is outside inactive blocks'
);

const INACTIVE_REGION_WITH_BLANKS = `
#define SWITCH 0

#if SWITCH
int first_inactive_line = 1;

int second_inactive_line = 1;
#else
int active_line = 1;
#endif
`.trim();

const inactiveRegionDocument = createDocument(INACTIVE_REGION_WITH_BLANKS);
const inactiveRegionParsed = parseDocument(inactiveRegionDocument);

assert.deepStrictEqual(
  inactiveRegionParsed.inactiveLines,
  [3, 5],
  'blank lines inside inactive branches should not be decorated directly'
);

assert.deepStrictEqual(
  inactiveRegionParsed.inactiveRegions,
  [{ start: 3, end: 5 }],
  'inactive region should span through blank lines inside the same inactive branch'
);

assert.deepStrictEqual(
  filterInactiveLinesForActiveBlock(inactiveRegionParsed.inactiveLines),
  [3, 5],
  'cursor on a blank line inside an inactive region should not hide inactive markers'
);

console.log('C preprocessor visualizer tests passed');
