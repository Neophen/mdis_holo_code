import * as vscode from 'vscode';
import {
  getCursorContext,
  findEnclosingModuleName,
  resolveComponentName,
} from './hologramResolver';
import { WorkspaceIndex } from './workspaceIndex';

export class HologramDefinitionProvider implements vscode.DefinitionProvider {
  private index: WorkspaceIndex;
  private outputChannel: vscode.OutputChannel;

  constructor(index: WorkspaceIndex, outputChannel: vscode.OutputChannel) {
    this.index = index;
    this.outputChannel = outputChannel;
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location | vscode.Location[] | undefined> {
    const line = document.lineAt(position.line).text;
    this.outputChannel.appendLine(`--- Go to Definition ---`);
    this.outputChannel.appendLine(`File: ${document.uri.fsPath}`);
    this.outputChannel.appendLine(`Line ${position.line}: "${line}"`);

    const ctx = getCursorContext(document, position);
    if (!ctx) {
      return undefined;
    }

    this.outputChannel.appendLine(`Context: ${ctx.kind} = "${ctx.name}"`);

    const currentModuleName = findEnclosingModuleName(document, position);
    const currentModule = currentModuleName ? this.index.getModule(currentModuleName) : undefined;

    switch (ctx.kind) {
      case 'variable': {
        if (!currentModule) return undefined;

        // Check props
        const prop = currentModule.props.find(p => p.name === ctx.name);
        if (prop) {
          // Jump to defmodule line (prop is defined in the module)
          return new vscode.Location(currentModule.uri, new vscode.Position(currentModule.defmoduleLine, 0));
        }

        // Check stateKeys — no line info available, jump to module
        if (currentModule.stateKeys.includes(ctx.name)) {
          return new vscode.Location(currentModule.uri, new vscode.Position(currentModule.defmoduleLine, 0));
        }

        return undefined;
      }

      case 'action': {
        if (!currentModule) return undefined;

        const action = currentModule.actions.find(a => a.name === ctx.name);
        if (action && action.line > 0) {
          return new vscode.Location(currentModule.uri, new vscode.Position(action.line - 1, 0));
        }

        const command = currentModule.commands.find(c => c.name === ctx.name);
        if (command && command.line > 0) {
          return new vscode.Location(currentModule.uri, new vscode.Position(command.line - 1, 0));
        }

        return undefined;
      }

      case 'component': {
        const fullName = resolveComponentName(ctx.name, document) ?? ctx.name;
        const mod = this.index.getModule(fullName) || this.index.getModuleByShortName(ctx.name);

        if (!mod) {
          this.outputChannel.appendLine(`Component not found in index`);
          return undefined;
        }

        const config = vscode.workspace.getConfiguration('hologram');
        const target = config.get<string>('defaultJumpTarget', 'template');

        if (target === 'template' && mod.templateLine !== undefined) {
          return new vscode.Location(mod.uri, new vscode.Position(mod.templateLine - 1, 0));
        }
        if (target === 'init' && mod.initLine !== undefined) {
          return new vscode.Location(mod.uri, new vscode.Position(mod.initLine - 1, 0));
        }
        if (mod.templateLine !== undefined) {
          return new vscode.Location(mod.uri, new vscode.Position(mod.templateLine - 1, 0));
        }
        return new vscode.Location(mod.uri, new vscode.Position(mod.defmoduleLine - 1, 0));
      }

      case 'function_call': {
        if (!currentModule) return undefined;

        const func = currentModule.functions.find(f => f.name === ctx.name);
        if (func && func.line > 0) {
          return new vscode.Location(currentModule.uri, new vscode.Position(func.line - 1, 0));
        }

        return undefined;
      }

      case 'page': {
        const fullName = resolveComponentName(ctx.name, document) ?? ctx.name;
        const mod = this.index.getModule(fullName) || this.index.getModuleByShortName(ctx.name);

        if (mod && mod.kind === 'page') {
          if (mod.templateLine !== undefined) {
            return new vscode.Location(mod.uri, new vscode.Position(mod.templateLine - 1, 0));
          }
          return new vscode.Location(mod.uri, new vscode.Position(mod.defmoduleLine - 1, 0));
        }

        return undefined;
      }

      case 'field_access': {
        if (!currentModule) return undefined;

        const prop = currentModule.props.find(p => p.name === ctx.varName);
        if (!prop || prop.type === 'any' || !/^[A-Z]/.test(prop.type)) {
          return undefined;
        }

        const resolvedFullName = resolveComponentName(prop.type, document) ?? prop.type;
        const resource = this.index.getResource(resolvedFullName);

        if (resource) {
          const attr = resource.attributes.find(a => a.name === ctx.fieldName);
          if (attr && attr.line > 0) {
            const uri = this.index.getModule(resolvedFullName)?.uri;
            if (uri) {
              return new vscode.Location(uri, new vscode.Position(attr.line - 1, 0));
            }
          }

          const rel = resource.relationships.find(r => r.name === ctx.fieldName);
          if (rel && rel.line > 0) {
            const uri = this.index.getModule(resolvedFullName)?.uri;
            if (uri) {
              return new vscode.Location(uri, new vscode.Position(rel.line - 1, 0));
            }
          }
        }

        return undefined;
      }
    }
  }
}
