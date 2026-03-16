import * as vscode from 'vscode';
import { findEnclosingModuleName, resolveComponentName } from './hologramResolver';
import { WorkspaceIndex } from './workspaceIndex';

interface EventType {
  name: string;
  description?: string;
}

const DEFAULT_EVENT_TYPES: EventType[] = [
  { name: '$click', description: 'Triggered when an element is clicked' },
  { name: '$change', description: 'Triggered when the value of an input element changes' },
  { name: '$submit', description: 'Triggered when a form is submitted' },
  { name: '$select', description: 'Triggered when text is selected in an input or textarea' },
  { name: '$blur', description: 'Triggered when an element loses focus' },
  { name: '$focus', description: 'Triggered when an element receives focus' },
  { name: '$mouse_move', description: 'Triggered when the mouse cursor moves over an element' },
  { name: '$pointer_down', description: 'Triggered when a pointer is pressed down on an element' },
  { name: '$pointer_up', description: 'Triggered when a pointer is released from an element' },
  { name: '$pointer_move', description: 'Triggered when a pointer moves while over an element' },
  { name: '$pointer_cancel', description: 'Triggered when a pointer event is cancelled' },
  { name: '$transition_end', description: 'Triggered when a CSS transition has finished' },
  { name: '$transition_start', description: 'Triggered when a CSS transition has started' },
  { name: '$transition_run', description: 'Triggered when a CSS transition is created' },
  { name: '$transition_cancel', description: 'Triggered when a CSS transition is cancelled' },
];

function getEventTypes(): EventType[] {
  const config = vscode.workspace.getConfiguration('hologram');
  return config.get<EventType[]>('eventTypes', DEFAULT_EVENT_TYPES);
}

function isInsideHtmlTag(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

  let lastOpenTag = -1;
  let lastCloseTag = -1;

  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === '<' && lastOpenTag === -1) {
      lastOpenTag = i;
    }
    if (text[i] === '>' && lastCloseTag === -1) {
      lastCloseTag = i;
    }
    if (lastOpenTag !== -1 && lastCloseTag !== -1) break;
  }

  return lastOpenTag > lastCloseTag;
}

function isInsideHoloSigil(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

  const sigilStart = text.lastIndexOf('~HOLO');
  if (sigilStart === -1) return false;

  const afterSigil = text.substring(sigilStart + 5);
  if (afterSigil.startsWith('"""')) {
    const rest = afterSigil.substring(3);
    const matches = rest.match(/"""/g);
    return !matches || matches.length % 2 === 0;
  }
  if (afterSigil.startsWith('"')) {
    const rest = afterSigil.substring(1);
    const matches = rest.match(/(?<!\\)"/g);
    return !matches || matches.length % 2 === 0;
  }

  return true;
}

function getCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position
): 'event_type' | 'event_value' | 'state_variable' | 'field_access' | null {
  const line = document.lineAt(position.line).text;
  const textBefore = line.substring(0, position.character);

  if (/\$\w*$/.test(textBefore) && isInsideHtmlTag(document, position)) {
    return 'event_type';
  }

  if (/\$\w+=["'{]?$/.test(textBefore) && isInsideHtmlTag(document, position)) {
    return 'event_value';
  }

  if (/@(\w+)\.(\w*)$/.test(textBefore)) {
    return 'field_access';
  }

  if (/@\w*$/.test(textBefore)) {
    return 'state_variable';
  }

  return null;
}

export class HologramEventCompletionProvider implements vscode.CompletionItemProvider {
  private outputChannel: vscode.OutputChannel;
  private index: WorkspaceIndex;

  constructor(outputChannel: vscode.OutputChannel, index: WorkspaceIndex) {
    this.outputChannel = outputChannel;
    this.index = index;
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | undefined> {
    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);
    this.outputChannel.appendLine(`--- Event Completion ---`);
    this.outputChannel.appendLine(`Language: ${document.languageId}, Trigger: "${context.triggerCharacter || 'none'}"`);
    this.outputChannel.appendLine(`Text before cursor: "${textBefore}"`);

    const isElixir = document.languageId === 'elixir';
    const isHologram = document.languageId === 'hologram';

    if (isElixir && !isInsideHoloSigil(document, position)) {
      return undefined;
    }

    if (!isElixir && !isHologram) {
      return undefined;
    }

    const ctx = getCompletionContext(document, position);
    if (!ctx) return undefined;

    if (ctx === 'event_type') {
      return this.getEventTypeCompletions(document, position);
    }

    if (ctx === 'event_value') {
      return this.getEventValueCompletions(document, position);
    }

    if (ctx === 'state_variable') {
      return this.getStateVariableCompletions(document, position);
    }

    if (ctx === 'field_access') {
      return this.getFieldAccessCompletions(document, position);
    }

    return undefined;
  }

  private getEventTypeCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);

    const dollarMatch = textBefore.match(/\$(\w*)$/);
    if (!dollarMatch) return [];

    const dollarStart = position.character - dollarMatch[0].length;
    const events = getEventTypes();

    const afterDollarRange = new vscode.Range(
      new vscode.Position(position.line, dollarStart + 1),
      position
    );

    return events.map((event, index) => {
      const nameWithoutDollar = event.name.replace(/^\$/, '');
      const item = new vscode.CompletionItem(event.name, vscode.CompletionItemKind.Event);
      item.detail = event.description || '';
      item.sortText = String(index).padStart(2, '0');
      item.filterText = nameWithoutDollar;
      item.range = { inserting: afterDollarRange, replacing: afterDollarRange };
      item.insertText = nameWithoutDollar;
      return item;
    });
  }

  private getEventValueCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const currentModuleName = findEnclosingModuleName(document, position);
    if (!currentModuleName) return [];

    const mod = this.index.getPageOrComponent(currentModuleName);
    if (!mod) return [];

    const items: vscode.CompletionItem[] = [];
    let sortIndex = 0;

    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);

    const afterEquals = textBefore.match(/\$\w+=(.*)$/);
    const typed = afterEquals ? afterEquals[1] : '';

    const equalsPos = textBefore.lastIndexOf('=');
    const replaceStart = equalsPos + 1;
    const range = new vscode.Range(
      new vscode.Position(position.line, replaceStart),
      position
    );

    for (const action of mod.actions) {
      if (action.usesParams && action.params.length > 0) {
        const paramSnippets = action.params
          .map((p, i) => `${p}: \${${i + 1}:value}`)
          .join(', ');

        const item = new vscode.CompletionItem(
          `:${action.name}`,
          vscode.CompletionItemKind.Function
        );
        item.detail = `Action (${action.params.join(', ')})`;
        item.documentation = new vscode.MarkdownString(
          `Expression Shorthand Syntax\n\n\`{:${action.name}, ${action.params.map(p => `${p}: value`).join(', ')}}\``
        );
        item.sortText = String(sortIndex++).padStart(3, '0');
        item.range = range;
        item.insertText = new vscode.SnippetString(
          `{:${action.name}, ${paramSnippets}}`
        );
        item.filterText = `${typed}{:${action.name}`;
        items.push(item);
      } else {
        const item = new vscode.CompletionItem(
          `:${action.name}`,
          vscode.CompletionItemKind.Function
        );
        item.detail = 'Action';
        item.documentation = new vscode.MarkdownString(
          `Text Syntax\n\n\`"${action.name}"\``
        );
        item.sortText = String(sortIndex++).padStart(3, '0');
        item.range = range;
        item.insertText = new vscode.SnippetString(`"${action.name}"`);
        item.filterText = `${typed}"${action.name}`;
        items.push(item);
      }

      const longhandItem = new vscode.CompletionItem(
        `:${action.name} (longhand)`,
        vscode.CompletionItemKind.Function
      );
      longhandItem.detail = 'Action (longhand)';
      longhandItem.documentation = new vscode.MarkdownString(
        `Expression Longhand Syntax\n\n\`{action: :${action.name}, target: "component", params: %{key: value}}\``
      );
      longhandItem.sortText = String(sortIndex++).padStart(3, '0');
      longhandItem.range = range;
      longhandItem.insertText = new vscode.SnippetString(
        `{action: :${action.name}\${1:, target: "\${2:page}"}\${3:, params: %{\${4:key}: \${5:value}}}}`
      );
      longhandItem.filterText = `${typed}{action:${action.name}`;
      items.push(longhandItem);
    }

    for (const command of mod.commands) {
      const item = new vscode.CompletionItem(
        `:${command.name}`,
        vscode.CompletionItemKind.Event
      );
      item.detail = 'Command';
      item.documentation = new vscode.MarkdownString(
        `Command Longhand Syntax\n\n\`{command: :${command.name}, params: %{key: value}}\``
      );
      item.sortText = String(sortIndex++).padStart(3, '0');
      item.range = range;

      if (command.usesParams && command.params.length > 0) {
        const paramSnippets = command.params
          .map((p, i) => `${p}: \${${i + 1}:value}`)
          .join(', ');
        item.insertText = new vscode.SnippetString(
          `{command: :${command.name}, params: %{${paramSnippets}}}`
        );
      } else {
        item.insertText = new vscode.SnippetString(
          `{command: :${command.name}\${1:, params: %{\${2:key}: \${3:value}}}}`
        );
      }
      item.filterText = `${typed}{command:${command.name}`;
      items.push(item);
    }

    for (const prop of mod.props) {
      const item = new vscode.CompletionItem(
        `@${prop.name}`,
        vscode.CompletionItemKind.Field
      );
      item.detail = `Prop (${prop.type})`;
      item.sortText = String(sortIndex++).padStart(3, '0');
      item.range = range;
      item.insertText = new vscode.SnippetString(`{@${prop.name}}`);
      item.filterText = `${typed}{@${prop.name}`;
      items.push(item);
    }

    return items;
  }

  private getStateVariableCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const currentModuleName = findEnclosingModuleName(document, position);
    if (!currentModuleName) return [];

    const mod = this.index.getPageOrComponent(currentModuleName);
    if (!mod) return [];

    const items: vscode.CompletionItem[] = [];
    let sortIndex = 0;

    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);

    const atMatch = textBefore.match(/@(\w*)$/);
    if (!atMatch) return [];

    const atStart = position.character - atMatch[0].length;
    const afterAtRange = new vscode.Range(
      new vscode.Position(position.line, atStart + 1),
      position
    );

    for (const prop of mod.props) {
      const item = new vscode.CompletionItem(
        `@${prop.name}`,
        vscode.CompletionItemKind.Property
      );
      item.detail = `Prop (${prop.type})`;
      item.sortText = String(sortIndex++).padStart(3, '0');
      item.filterText = prop.name;
      item.range = { inserting: afterAtRange, replacing: afterAtRange };
      item.insertText = prop.name;
      items.push(item);
    }

    const seenNames = new Set(mod.props.map(p => p.name));
    for (const stateKey of mod.stateKeys) {
      if (seenNames.has(stateKey)) continue;
      seenNames.add(stateKey);

      const item = new vscode.CompletionItem(
        `@${stateKey}`,
        vscode.CompletionItemKind.Variable
      );
      item.detail = 'State';
      item.sortText = String(sortIndex++).padStart(3, '0');
      item.filterText = stateKey;
      item.range = { inserting: afterAtRange, replacing: afterAtRange };
      item.insertText = stateKey;
      items.push(item);
    }

    return items;
  }

  private getFieldAccessCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const currentModuleName = findEnclosingModuleName(document, position);
    if (!currentModuleName) return [];

    const mod = this.index.getPageOrComponent(currentModuleName);
    if (!mod) return [];

    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);

    const fieldMatch = textBefore.match(/@(\w+)\.(\w*)$/);
    if (!fieldMatch) return [];

    const varName = fieldMatch[1];
    const partialField = fieldMatch[2];

    let fields: string[] = [];
    let source = '';

    const prop = mod.props.find(p => p.name === varName);
    if (prop && prop.type !== 'any' && /^[A-Z]/.test(prop.type)) {
      const fullName = resolveComponentName(prop.type, document) ?? prop.type;
      fields = this.index.getModuleFields(fullName);
      source = `Prop (${prop.type})`;
    }

    if (fields.length === 0) return [];

    const dotPos = position.character - partialField.length;
    const afterDotRange = new vscode.Range(
      new vscode.Position(position.line, dotPos),
      position
    );

    return fields.map((field, index) => {
      const item = new vscode.CompletionItem(
        field,
        vscode.CompletionItemKind.Field
      );
      item.detail = source;
      item.sortText = String(index).padStart(3, '0');
      item.filterText = field;
      item.range = { inserting: afterDotRange, replacing: afterDotRange };
      item.insertText = field;
      return item;
    });
  }
}
