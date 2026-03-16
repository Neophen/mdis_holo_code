import * as vscode from 'vscode';
import { resolveComponentName } from './hologramResolver';
import { WorkspaceIndex } from './workspaceIndex';

export class FieldDiagnosticsProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private index: WorkspaceIndex;
  private disposables: vscode.Disposable[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(_outputChannel: vscode.OutputChannel, index: WorkspaceIndex) {
    this.index = index;
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('hologram-fields');

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

    // Find the module name from defmodule
    const defmoduleMatch = text.match(/^\s*defmodule\s+(\S+)\s+do/m);
    if (!defmoduleMatch) return;

    const moduleName = defmoduleMatch[1];
    const mod = this.index.getPageOrComponent(moduleName);
    if (!mod) return;

    const diagnostics: vscode.Diagnostic[] = [];

    // Build a map of known fields per prop variable
    const fieldMap = new Map<string, { fields: string[]; source: string }>();

    for (const prop of mod.props) {
      if (prop.type !== 'any' && /^[A-Z]/.test(prop.type)) {
        const fullName = resolveComponentName(prop.type, document) ?? prop.type;
        const fields = this.index.getModuleFields(fullName);

        if (fields.length > 0) {
          fieldMap.set(prop.name, { fields, source: `Prop (${prop.type})` });
        }
      }
    }

    if (fieldMap.size === 0) return;

    // Find template regions (inside ~HOLO""" ... """)
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

    const fieldAccessPattern = /@(\w+)\.(\w+)/g;
    let match: RegExpExecArray | null;

    while ((match = fieldAccessPattern.exec(text)) !== null) {
      const varName = match[1];
      const fieldName = match[2];
      const matchPos = match.index;

      const inTemplate = templateRegions.some(r => matchPos >= r.start && matchPos <= r.end);
      if (!inTemplate) continue;

      const known = fieldMap.get(varName);
      if (!known) continue;

      if (!known.fields.includes(fieldName)) {
        const fieldStart = matchPos + 1 + varName.length + 1;
        const startPos = document.positionAt(fieldStart);
        const endPos = document.positionAt(fieldStart + fieldName.length);
        const range = new vscode.Range(startPos, endPos);

        const similar = findSimilarFields(fieldName, known.fields);
        let message = `Unknown field "${fieldName}" on @${varName} (${known.source}).`;
        if (similar.length > 0) {
          message += ` Did you mean: ${similar.join(', ')}?`;
        }
        message += `\nAvailable fields: ${known.fields.join(', ')}`;

        const diagnostic = new vscode.Diagnostic(
          range,
          message,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = 'Hologram';
        diagnostic.code = 'unknown-field';
        diagnostics.push(diagnostic);
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

function findSimilarFields(name: string, fields: string[]): string[] {
  const nameLower = name.toLowerCase();
  return fields
    .map(field => {
      const fieldLower = field.toLowerCase();
      let score = 0;
      if (fieldLower.includes(nameLower) || nameLower.includes(fieldLower)) score += 50;
      let shared = 0;
      for (let i = 0; i < Math.min(fieldLower.length, nameLower.length); i++) {
        if (fieldLower[i] === nameLower[i]) shared++;
        else break;
      }
      score += shared * 10;
      return { field, score };
    })
    .filter(({ score }) => score > 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ field }) => field);
}
