import * as vscode from 'vscode';
import { resolveComponentName } from './hologramResolver';
import { WorkspaceIndex, ModuleInfo } from './workspaceIndex';

interface ComponentUsage {
  tagName: string;
  attrs: { name: string; start: number; end: number }[];
  tagStart: number;
  tagEnd: number;
  selfClosing: boolean;
}

function findComponentUsages(text: string): ComponentUsage[] {
  const usages: ComponentUsage[] = [];

  const tagPattern = /<([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)(\s[^>]*)?\s*(\/?)\s*>/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagPattern.exec(text)) !== null) {
    const tagName = tagMatch[1];
    const attrsStr = tagMatch[2] || '';
    const selfClosing = tagMatch[3] === '/';
    const attrs: { name: string; start: number; end: number }[] = [];

    const attrPattern = /([a-zA-Z_$][a-zA-Z0-9_]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+))?/g;
    let attrMatch: RegExpExecArray | null;

    const attrsStart = tagMatch.index + 1 + tagName.length;

    while ((attrMatch = attrPattern.exec(attrsStr)) !== null) {
      const attrName = attrMatch[1];
      if (['class', 'id', 'style', 'href', 'src', 'type', 'name', 'value',
           'placeholder', 'alt', 'title', 'role', 'tabindex', 'for',
           'action', 'method', 'target', 'rel', 'disabled', 'checked',
           'selected', 'readonly', 'required', 'autofocus', 'width', 'height',
           'colspan', 'rowspan'].includes(attrName)) {
        continue;
      }
      if (attrName.startsWith('$')) continue;

      const attrAbsStart = attrsStart + attrMatch.index;
      attrs.push({
        name: attrName,
        start: attrAbsStart,
        end: attrAbsStart + attrName.length,
      });
    }

    usages.push({
      tagName,
      attrs,
      tagStart: tagMatch.index,
      tagEnd: tagMatch.index + tagMatch[0].length,
      selfClosing,
    });
  }

  return usages;
}

export class ComponentPropsDiagnosticsProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private index: WorkspaceIndex;
  private disposables: vscode.Disposable[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(_outputChannel: vscode.OutputChannel, index: WorkspaceIndex) {
    this.index = index;
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('hologram-component-props');

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => this.scheduleCheck(e.document)),
      vscode.workspace.onDidSaveTextDocument(doc => this.checkDocument(doc)),
      vscode.workspace.onDidOpenTextDocument(doc => this.checkDocument(doc)),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) this.checkDocument(editor.document);
      })
    );

    this.disposables.push(
      this.index.onDidUpdate(() => {
        if (vscode.window.activeTextEditor) {
          this.checkDocument(vscode.window.activeTextEditor.document);
        }
      })
    );

    if (vscode.window.activeTextEditor) {
      this.checkDocument(vscode.window.activeTextEditor.document);
    }
  }

  private scheduleCheck(document: vscode.TextDocument): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.checkDocument(document), 500);
  }

  async checkDocument(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== 'elixir') {
      return;
    }

    const text = document.getText();

    // Only check Hologram modules
    if (!/^\s*use\s+Hologram\.(Component|Page)\s*$/m.test(text)) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const components = this.index.getAllComponents();

    // Find template regions
    const templateRegions: { start: number; end: number }[] = [];
    const openPattern = /~HOLO"""/g;
    let openMatch: RegExpExecArray | null;
    while ((openMatch = openPattern.exec(text)) !== null) {
      const start = openMatch.index + openMatch[0].length;
      const closingIndex = text.indexOf('"""', start);
      if (closingIndex !== -1) {
        templateRegions.push({ start, end: closingIndex });
      }
    }

    const usages = findComponentUsages(text);

    for (const usage of usages) {
      const inTemplate = templateRegions.some(r => usage.tagStart >= r.start && usage.tagEnd <= r.end);
      if (!inTemplate) continue;

      const fullName = resolveComponentName(usage.tagName, document) ?? usage.tagName;
      const componentInfo = components.get(fullName) || findByShortName(components, usage.tagName);

      if (!componentInfo || componentInfo.props.length === 0) continue;

      const definedPropNames = componentInfo.props.map(p => p.name);
      const providedPropNames = usage.attrs.map(a => a.name);

      for (const attr of usage.attrs) {
        if (!definedPropNames.includes(attr.name)) {
          const startPos = document.positionAt(attr.start);
          const endPos = document.positionAt(attr.end);
          const range = new vscode.Range(startPos, endPos);

          const similar = findSimilarProps(attr.name, definedPropNames);
          let message = `Unknown prop "${attr.name}" on <${usage.tagName}>.`;
          if (similar.length > 0) {
            message += ` Did you mean: ${similar.join(', ')}?`;
          }
          message += `\nDefined props: ${definedPropNames.join(', ')}`;

          const diagnostic = new vscode.Diagnostic(
            range,
            message,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostic.source = 'Hologram';
          diagnostic.code = 'unknown-prop';
          diagnostics.push(diagnostic);
        }
      }

      for (const prop of componentInfo.props) {
        if (prop.hasDefault) continue;
        if (!providedPropNames.includes(prop.name)) {
          const tagNameStart = usage.tagStart + 1;
          const tagNameEnd = tagNameStart + usage.tagName.length;
          const startPos = document.positionAt(tagNameStart);
          const endPos = document.positionAt(tagNameEnd);
          const range = new vscode.Range(startPos, endPos);

          const diagnostic = new vscode.Diagnostic(
            range,
            `Missing required prop "${prop.name}" (${prop.type}) on <${usage.tagName}>.`,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostic.source = 'Hologram';
          diagnostic.code = 'missing-prop';
          diagnostics.push(diagnostic);
        }
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function findByShortName(components: Map<string, ModuleInfo>, shortName: string): ModuleInfo | undefined {
  for (const [, info] of components) {
    const parts = info.fullName.split('.');
    if (parts[parts.length - 1] === shortName) {
      return info;
    }
  }
  return undefined;
}

function findSimilarProps(name: string, props: string[]): string[] {
  const nameLower = name.toLowerCase();
  return props
    .map(prop => {
      const propLower = prop.toLowerCase();
      let score = 0;
      if (propLower.includes(nameLower) || nameLower.includes(propLower)) score += 50;
      let shared = 0;
      for (let i = 0; i < Math.min(propLower.length, nameLower.length); i++) {
        if (propLower[i] === nameLower[i]) shared++;
        else break;
      }
      score += shared * 10;
      return { prop, score };
    })
    .filter(({ score }) => score > 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ prop }) => prop);
}
