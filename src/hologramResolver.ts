import * as vscode from 'vscode';

export type CursorContext =
  | { kind: 'variable'; name: string }
  | { kind: 'action'; name: string }
  | { kind: 'component'; name: string }
  | { kind: 'function_call'; name: string }
  | { kind: 'page'; name: string }
  | { kind: 'field_access'; varName: string; fieldName: string; name: string };

export function getCursorContext(
  document: vscode.TextDocument,
  position: vscode.Position
): CursorContext | undefined {
  const line = document.lineAt(position.line).text;
  const char = position.character;

  // 0. @variable.field — field access on a state/prop
  const fieldAccessPattern = /@(\w+)\.(\w+)/g;
  let fieldMatch: RegExpExecArray | null;
  while ((fieldMatch = fieldAccessPattern.exec(line)) !== null) {
    const dotPos = fieldMatch.index + 1 + fieldMatch[1].length;
    const fieldStart = dotPos + 1;
    const fieldEnd = fieldStart + fieldMatch[2].length;
    if (char >= fieldStart && char <= fieldEnd) {
      return { kind: 'field_access', varName: fieldMatch[1], fieldName: fieldMatch[2], name: fieldMatch[2] };
    }
  }

  // 1. @variable
  const varResult = matchAtPosition(line, char, /@(\w+)/g);
  if (varResult) {
    return { kind: 'variable', name: varResult };
  }

  // 2. Any $ attribute — match on the value text itself
  const dollarStringValueResult = matchAtPosition(line, char, /\$\w+="(\w+)"/g, 1, true);
  if (dollarStringValueResult) {
    return { kind: 'action', name: dollarStringValueResult };
  }

  // $ attribute expression: $click={:name, ...}
  const dollarExprValueResult = matchAtPosition(line, char, /\$\w+=\{(?:action:\s*)?(:(\w+))/g, 2, false, 1);
  if (dollarExprValueResult) {
    return { kind: 'action', name: dollarExprValueResult };
  }

  // 3. layout MyApp.Layouts.Main
  const layoutPattern = /^\s*layout\s+([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)/g;
  let layoutMatch: RegExpExecArray | null;
  while ((layoutMatch = layoutPattern.exec(line)) !== null) {
    const nameStart = layoutMatch[0].indexOf(layoutMatch[1]) + layoutMatch.index;
    const nameEnd = nameStart + layoutMatch[1].length;
    if (char >= nameStart && char <= nameEnd) {
      return { kind: 'component', name: layoutMatch[1] };
    }
  }

  // 4. Link to={PageModule}
  const linkToPattern = /to=\{([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)/g;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkToPattern.exec(line)) !== null) {
    const nameStart = linkMatch.index + 4;
    const nameEnd = nameStart + linkMatch[1].length;
    if (char >= nameStart && char <= nameEnd) {
      return { kind: 'page', name: linkMatch[1] };
    }
  }

  // 5. Component tag: <ComponentName or </ComponentName
  const compPattern = /<\/?([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)/g;
  let compMatch: RegExpExecArray | null;
  while ((compMatch = compPattern.exec(line)) !== null) {
    const prefix = compMatch[0].startsWith('</') ? 2 : 1;
    const nameStart = compMatch.index + prefix;
    const nameEnd = nameStart + compMatch[1].length;
    if (char >= nameStart && char <= nameEnd) {
      return { kind: 'component', name: compMatch[1] };
    }
  }

  // 6. Function call in expression
  const funcResult = matchAtPosition(line, char, /\b([a-z_]\w*)\s*\(/g);
  if (funcResult && !isElixirBuiltin(funcResult)) {
    return { kind: 'function_call', name: funcResult };
  }

  return undefined;
}

function matchAtPosition(
  line: string,
  char: number,
  pattern: RegExp,
  groupIndex = 1,
  useValueRange = false,
  rangeGroupIndex?: number
): string | undefined {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    let hitStart: number;
    let hitEnd: number;

    if (useValueRange) {
      const valueStr = match[groupIndex];
      const valueOffset = match[0].lastIndexOf(valueStr);
      hitStart = match.index + valueOffset;
      hitEnd = hitStart + valueStr.length;
    } else if (rangeGroupIndex !== undefined) {
      const rangeStr = match[rangeGroupIndex];
      const rangeOffset = match[0].indexOf(rangeStr);
      hitStart = match.index + rangeOffset;
      hitEnd = hitStart + rangeStr.length;
    } else {
      hitStart = match.index;
      hitEnd = hitStart + match[0].length;
    }

    if (char >= hitStart && char <= hitEnd) {
      return match[groupIndex];
    }
  }
  return undefined;
}

function isElixirBuiltin(name: string): boolean {
  const builtins = new Set([
    'length', 'put_state', 'put_command', 'put_action', 'put_page',
    'put_context', 'put_session', 'put_cookie', 'if', 'unless',
    'for', 'case', 'cond', 'with', 'fn', 'raise', 'throw',
    'try', 'receive', 'send', 'spawn', 'import', 'require',
    'use', 'alias', 'defmodule', 'def', 'defp', 'is_nil',
    'is_map', 'is_list', 'is_atom', 'is_binary', 'is_integer',
    'is_float', 'is_boolean', 'is_tuple', 'hd', 'tl', 'elem',
    'map_size', 'tuple_size', 'byte_size', 'bit_size', 'rem',
    'div', 'abs', 'round', 'trunc', 'max', 'min', 'not',
    'inspect', 'to_string'
  ]);
  return builtins.has(name);
}

export function findEnclosingModule(
  document: vscode.TextDocument,
  position: vscode.Position
): { start: number; end: number } | undefined {
  let moduleStart = -1;

  for (let i = position.line; i >= 0; i--) {
    const line = document.lineAt(i).text;
    if (/^defmodule\b/.test(line)) {
      moduleStart = i;
      break;
    }
  }

  if (moduleStart === -1) {
    return undefined;
  }

  let moduleEnd = document.lineCount - 1;
  for (let i = moduleStart + 1; i < document.lineCount; i++) {
    const line = document.lineAt(i).text;
    if (/^defmodule\b/.test(line)) {
      moduleEnd = i - 1;
      break;
    }
  }

  return { start: moduleStart, end: moduleEnd };
}

export function findEnclosingModuleName(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  for (let i = position.line; i >= 0; i--) {
    const line = document.lineAt(i).text;
    const match = line.match(/^defmodule\s+(\S+)\s+do/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

export function resolveComponentName(
  componentName: string,
  document: vscode.TextDocument
): string | undefined {
  if (componentName.includes('.')) {
    return componentName;
  }

  const text = document.getText();

  const aliasPattern = new RegExp(`^\\s*alias\\s+(\\S+\\.${escapeRegex(componentName)})\\s*$`, 'm');
  const aliasMatch = aliasPattern.exec(text);
  if (aliasMatch) {
    return aliasMatch[1];
  }

  const aliasAsPattern = new RegExp(`^\\s*alias\\s+(\\S+),\\s*as:\\s*${escapeRegex(componentName)}\\s*$`, 'm');
  const aliasAsMatch = aliasAsPattern.exec(text);
  if (aliasAsMatch) {
    return aliasAsMatch[1];
  }

  const groupAliasPattern = /^\s*alias\s+(\S+)\.\{([^}]+)\}/gm;
  let groupMatch: RegExpExecArray | null;
  while ((groupMatch = groupAliasPattern.exec(text)) !== null) {
    const base = groupMatch[1];
    const names = groupMatch[2].split(',').map(n => n.trim());
    if (names.includes(componentName)) {
      return `${base}.${componentName}`;
    }
  }

  return undefined;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
