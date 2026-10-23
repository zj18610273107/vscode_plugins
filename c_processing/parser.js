const directivePattern = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif|define|undef|include)\b(.*)$/;

function parseDocument(document, options = {}) {
  const macros = new Map(options.initialMacros ?? []);
  const inactiveLines = [];
  const inactiveRegions = [];
  const groups = [];
  const stack = [];
  let inactiveRegionStart;

  for (let line = 0; line < document.lineCount; line++) {
    const textLine = document.lineAt(line);
    const directive = parseDirective(textLine.text);
    const parentActive = stack.length === 0 ? true : stack[stack.length - 1].currentActive;
    let lineInInactiveRegion = false;

    if (!directive) {
      if (!parentActive) {
        lineInInactiveRegion = true;
        if (!textLine.isEmptyOrWhitespace) {
          inactiveLines.push(line);
        }
      }
      updateInactiveRegion(lineInInactiveRegion, line);
      continue;
    }

    if (directive.kind === 'if' || directive.kind === 'ifdef' || directive.kind === 'ifndef') {
      if (!parentActive) {
        lineInInactiveRegion = true;
        inactiveLines.push(line);
      }
      const condition = evaluateCondition(directive, macros);
      stack.push({
        start: line,
        elifLines: [],
        elseLine: undefined,
        parentActive,
        currentActive: parentActive && condition,
        branchTaken: condition
      });
      updateInactiveRegion(lineInInactiveRegion, line);
      continue;
    }

    if (directive.kind === 'elif') {
      const frame = stack[stack.length - 1];
      if (!frame) {
        continue;
      }

      if (!frame.parentActive) {
        lineInInactiveRegion = true;
        inactiveLines.push(line);
      }
      const condition = evaluateExpression(directive.argument, macros);
      frame.elifLines.push(line);
      const branchActive = !frame.branchTaken && condition;
      frame.currentActive = frame.parentActive && branchActive;
      frame.branchTaken = frame.branchTaken || condition;
      updateInactiveRegion(lineInInactiveRegion, line);
      continue;
    }

    if (directive.kind === 'else') {
      const frame = stack[stack.length - 1];
      if (!frame) {
        continue;
      }

      if (!frame.parentActive) {
        lineInInactiveRegion = true;
        inactiveLines.push(line);
      }
      const branchActive = !frame.branchTaken;
      frame.elseLine = line;
      frame.currentActive = frame.parentActive && branchActive;
      frame.branchTaken = true;
      updateInactiveRegion(lineInInactiveRegion, line);
      continue;
    }

    if (directive.kind === 'endif') {
      const frame = stack.pop();
      if (frame) {
        if (!frame.parentActive) {
          lineInInactiveRegion = true;
          inactiveLines.push(line);
        }
        frame.end = line;
        groups.push(frame);
      }
      updateInactiveRegion(lineInInactiveRegion, line);
      continue;
    }

    if (directive.kind === 'include') {
      if (parentActive && options.resolveInclude) {
        const includedMacros = options.resolveInclude(directive.argument, {
          document,
          line,
          macros: new Map(macros)
        });
        if (includedMacros) {
          macros.clear();
          for (const [name, value] of includedMacros) {
            macros.set(name, value);
          }
        }
      }
      updateInactiveRegion(lineInInactiveRegion, line);
      continue;
    }

    if (directive.kind === 'define') {
      if (!parentActive) {
        lineInInactiveRegion = true;
        inactiveLines.push(line);
        updateInactiveRegion(lineInInactiveRegion, line);
        continue;
      }

      const macro = parseMacroDefinition(directive.argument);
      if (macro) {
        macros.set(macro.name, macro.value);
      }
      updateInactiveRegion(lineInInactiveRegion, line);
      continue;
    }

    if (directive.kind === 'undef') {
      if (!parentActive) {
        lineInInactiveRegion = true;
        inactiveLines.push(line);
        updateInactiveRegion(lineInInactiveRegion, line);
        continue;
      }

      const name = directive.argument.match(/^([A-Za-z_]\w*)/);
      if (name) {
        macros.delete(name[1]);
      }
    }
    updateInactiveRegion(lineInInactiveRegion, line);
  }

  closeInactiveRegion(document.lineCount - 1);

  return { inactiveLines, inactiveRegions, groups, macros };

  function updateInactiveRegion(isInactive, line) {
    if (isInactive) {
      if (inactiveRegionStart === undefined) {
        inactiveRegionStart = line;
      }
      return;
    }

    closeInactiveRegion(line - 1);
  }

  function closeInactiveRegion(end) {
    if (inactiveRegionStart === undefined) {
      return;
    }

    inactiveRegions.push({
      start: inactiveRegionStart,
      end
    });
    inactiveRegionStart = undefined;
  }

}

function parseDirective(text) {
  const match = text.match(directivePattern);
  if (!match) {
    return undefined;
  }

  return {
    kind: match[1],
    argument: match[2].trim()
  };
}

function evaluateCondition(directive, macros) {
  if (directive.kind === 'ifdef') {
    return macros.has(firstIdentifier(directive.argument));
  }

  if (directive.kind === 'ifndef') {
    return !macros.has(firstIdentifier(directive.argument));
  }

  return evaluateExpression(directive.argument, macros);
}

function firstIdentifier(text) {
  return text.match(/[A-Za-z_]\w*/)?.[0] ?? '';
}

function parseMacroDefinition(argument) {
  const match = argument.match(/^([A-Za-z_]\w*)(.*)$/);
  if (!match) {
    return undefined;
  }

  const rawValue = stripInlineComments(match[2]).trim();
  return {
    name: match[1],
    value: normalizeMacroValue(rawValue)
  };
}

function stripInlineComments(text) {
  return text
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\/\/.*$/, '');
}

function normalizeMacroValue(value) {
  if (!value || value.startsWith('(')) {
    return '1';
  }

  return isSafeExpression(value) ? value : '1';
}

function evaluateExpression(expression, macros) {
  const normalized = expression
    .replace(/defined\s*\(\s*([A-Za-z_]\w*)\s*\)/g, (_, name) => (macros.has(name) ? '1' : '0'))
    .replace(/defined\s+([A-Za-z_]\w*)/g, (_, name) => (macros.has(name) ? '1' : '0'))
    .replace(/[A-Za-z_]\w*/g, (name) => (macros.has(name) ? `(${macros.get(name)})` : '0'));

  if (!isSafeExpression(normalized)) {
    return false;
  }

  try {
    // The expression is restricted to numbers and C-like boolean/arithmetic operators above.
    return Boolean(Function(`"use strict"; return Number(${normalized});`)());
  } catch {
    return false;
  }
}

function isSafeExpression(expression) {
  return /^[\d\s!<>=&|()+\-*/%]+$/.test(expression);
}

function findMatchingDirectiveLines(document, cursorLine, groups) {
  const directive = parseDirective(document.lineAt(cursorLine).text);
  if (!directive || !['if', 'ifdef', 'ifndef', 'elif', 'else', 'endif'].includes(directive.kind)) {
    return [];
  }

  const group = groups.find((candidate) => (
    cursorLine === candidate.start ||
    candidate.elifLines.includes(cursorLine) ||
    cursorLine === candidate.elseLine ||
    cursorLine === candidate.end
  ));
  if (!group) {
    return [];
  }

  if (group.elseLine !== undefined) {
    return [group.start, ...group.elifLines, group.elseLine, group.end];
  }

  if (group.elseLine === undefined) {
    return [group.start, ...group.elifLines, group.end];
  }

  return [];
}

function filterInactiveLinesForActiveBlock(inactiveLines) {
  return inactiveLines;
}

function getDirectiveSpan(text) {
  const match = text.match(/^(\s*)(#\s*(?:if|ifdef|ifndef|elif|else|endif|define|undef))\b/);
  if (!match) {
    return undefined;
  }

  return {
    start: match[1].length,
    end: match[1].length + match[2].length
  };
}

function getDirectiveActivationSpan(text) {
  const span = getDirectiveSpan(text);
  if (!span) {
    return undefined;
  }

  const trailingWhitespace = text.slice(span.end).match(/^\s*/)?.[0].length ?? 0;
  return {
    start: span.start,
    end: span.end + trailingWhitespace
  };
}

function isCharacterInDirectiveSpan(span, character) {
  return Boolean(span && character >= span.start && character <= span.end);
}

module.exports = {
  parseDocument,
  parseDirective,
  parseMacroDefinition,
  findMatchingDirectiveLines,
  filterInactiveLinesForActiveBlock,
  getDirectiveSpan,
  getDirectiveActivationSpan,
  isCharacterInDirectiveSpan
};
