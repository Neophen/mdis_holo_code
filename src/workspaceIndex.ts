import * as vscode from 'vscode';

export interface PropInfo {
  name: string;
  type: string;
  required: boolean;
}

export interface ActionInfo {
  name: string;
  line: number;
  usesParams: boolean;
  params: string[];
}

export interface CommandInfo {
  name: string;
  line: number;
  usesParams: boolean;
  params: string[];
}

export interface FunctionInfo {
  name: string;
  line: number;
  arity: number;
}

export interface PageInfo {
  file: string;
  line: number;
  route?: string;
  templateLine?: number;
  initLine?: number;
  props: PropInfo[];
  actions: ActionInfo[];
  commands: CommandInfo[];
  stateKeys: string[];
  functions: FunctionInfo[];
}

export interface ComponentInfo {
  file: string;
  line: number;
  templateLine?: number;
  initLine?: number;
  props: PropInfo[];
  actions: ActionInfo[];
  commands: CommandInfo[];
  functions: FunctionInfo[];
}

export interface ResourceInfo {
  file: string;
  line: number;
  attributes: { name: string; type: string; line: number; primaryKey?: boolean }[];
  relationships: { name: string; type: string; destination: string; line: number }[];
}

export interface ModuleLocation {
  file: string;
  line: number;
}

export interface ModuleInfo {
  fullName: string;
  uri: vscode.Uri;
  defmoduleLine: number;
  kind: 'page' | 'component' | 'module';
  route?: string;
  props: { name: string; type: string; hasDefault: boolean }[];
  fields: string[];
  actions: ActionInfo[];
  commands: CommandInfo[];
  stateKeys: string[];
  functions: FunctionInfo[];
  templateLine?: number;
  initLine?: number;
}

export class WorkspaceIndex implements vscode.Disposable {
  private modules = new Map<string, ModuleInfo>();
  private pages = new Map<string, PageInfo>();
  private components = new Map<string, ComponentInfo>();
  private resources = new Map<string, ResourceInfo>();
  private moduleLocations = new Map<string, ModuleLocation>();
  private disposables: vscode.Disposable[] = [];

  private _onDidUpdate = new vscode.EventEmitter<void>();
  readonly onDidUpdate = this._onDidUpdate.event;

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private initialized = false;
  private workspaceRoot: vscode.Uri | undefined;

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this._onDidUpdate.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      this.workspaceRoot = folders[0].uri;
    }

    // Load existing .hologram/ files
    await this.loadAllFiles();

    // Watch .hologram/*.json for changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/.hologram/*.json');
    watcher.onDidCreate(uri => this.onJsonChanged(uri));
    watcher.onDidChange(uri => this.onJsonChanged(uri));
    watcher.onDidDelete(uri => this.onJsonDeleted(uri));
    this.disposables.push(watcher);
  }

  private async loadAllFiles(): Promise<void> {
    const files = await vscode.workspace.findFiles('.hologram/*.json', '**/node_modules/**');
    for (const file of files) {
      await this.loadJsonFile(file);
    }
    this.rebuildModules();
    this._onDidUpdate.fire();
  }

  private async onJsonChanged(uri: vscode.Uri): Promise<void> {
    await this.loadJsonFile(uri);
    this.rebuildModules();
    this.fireUpdate();
  }

  private onJsonDeleted(uri: vscode.Uri): void {
    const name = uri.fsPath.split('/').pop();
    switch (name) {
      case 'pages.json': this.pages.clear(); break;
      case 'components.json': this.components.clear(); break;
      case 'resources.json': this.resources.clear(); break;
      case 'modules.json': this.moduleLocations.clear(); break;
    }
    this.rebuildModules();
    this.fireUpdate();
  }

  private async loadJsonFile(uri: vscode.Uri): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      const data = JSON.parse(text);
      const name = uri.fsPath.split('/').pop();

      switch (name) {
        case 'pages.json':
          this.pages.clear();
          for (const [moduleName, info] of Object.entries(data)) {
            this.pages.set(moduleName, info as PageInfo);
          }
          break;
        case 'components.json':
          this.components.clear();
          for (const [moduleName, info] of Object.entries(data)) {
            this.components.set(moduleName, info as ComponentInfo);
          }
          break;
        case 'resources.json':
          this.resources.clear();
          for (const [moduleName, info] of Object.entries(data)) {
            this.resources.set(moduleName, info as ResourceInfo);
          }
          break;
        case 'modules.json':
          this.moduleLocations.clear();
          for (const [moduleName, info] of Object.entries(data)) {
            this.moduleLocations.set(moduleName, info as ModuleLocation);
          }
          break;
      }
    } catch {
      // Invalid JSON or read error — ignore
    }
  }

  private rebuildModules(): void {
    this.modules.clear();

    // Build from pages
    for (const [name, page] of this.pages) {
      this.modules.set(name, {
        fullName: name,
        uri: this.resolveUri(page.file),
        defmoduleLine: page.line,
        kind: 'page',
        route: page.route,
        props: page.props.map(p => ({ name: p.name, type: p.type, hasDefault: !p.required })),
        fields: [],
        actions: page.actions,
        commands: page.commands,
        stateKeys: page.stateKeys,
        functions: page.functions,
        templateLine: page.templateLine,
        initLine: page.initLine,
      });
    }

    // Build from components
    for (const [name, comp] of this.components) {
      this.modules.set(name, {
        fullName: name,
        uri: this.resolveUri(comp.file),
        defmoduleLine: comp.line,
        kind: 'component',
        props: comp.props.map(p => ({ name: p.name, type: p.type, hasDefault: !p.required })),
        fields: [],
        actions: comp.actions,
        commands: comp.commands,
        stateKeys: [],
        functions: comp.functions,
        templateLine: comp.templateLine,
        initLine: comp.initLine,
      });
    }

    // Build from resources (as 'module' kind with fields)
    for (const [name, resource] of this.resources) {
      const existing = this.modules.get(name);
      const fields = [
        ...resource.attributes.map(a => a.name),
        ...resource.relationships.map(r => r.name),
      ];

      if (existing) {
        existing.fields = fields;
      } else {
        this.modules.set(name, {
          fullName: name,
          uri: this.resolveUri(resource.file),
          defmoduleLine: resource.line,
          kind: 'module',
          props: [],
          fields,
          actions: [],
          commands: [],
          stateKeys: [],
          functions: [],
          templateLine: undefined,
          initLine: undefined,
        });
      }
    }

    // Fill in module locations for modules not yet in the map
    for (const [name, loc] of this.moduleLocations) {
      if (!this.modules.has(name)) {
        this.modules.set(name, {
          fullName: name,
          uri: this.resolveUri(loc.file),
          defmoduleLine: loc.line,
          kind: 'module',
          props: [],
          fields: [],
          actions: [],
          commands: [],
          stateKeys: [],
          functions: [],
          templateLine: undefined,
          initLine: undefined,
        });
      }
    }
  }

  private resolveUri(filePath: string): vscode.Uri {
    if (this.workspaceRoot) {
      return vscode.Uri.joinPath(this.workspaceRoot, filePath);
    }
    return vscode.Uri.file(filePath);
  }

  private fireUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this._onDidUpdate.fire();
    }, 100);
  }

  // --- Queries ---

  getAllPages(): ModuleInfo[] {
    const result: ModuleInfo[] = [];
    for (const mod of this.modules.values()) {
      if (mod.kind === 'page') {
        result.push(mod);
      }
    }
    return result;
  }

  getAllComponents(): Map<string, ModuleInfo> {
    const result = new Map<string, ModuleInfo>();
    for (const [name, mod] of this.modules) {
      if (mod.kind === 'component' || mod.kind === 'page') {
        result.set(name, mod);
      }
    }
    return result;
  }

  getModule(fullName: string): ModuleInfo | undefined {
    return this.modules.get(fullName);
  }

  getModuleByShortName(shortName: string): ModuleInfo | undefined {
    for (const mod of this.modules.values()) {
      const parts = mod.fullName.split('.');
      if (parts[parts.length - 1] === shortName) {
        return mod;
      }
    }
    return undefined;
  }

  getModuleFields(fullName: string): string[] {
    return this.modules.get(fullName)?.fields ?? [];
  }

  getResource(fullName: string): ResourceInfo | undefined {
    return this.resources.get(fullName);
  }

  getPageOrComponent(fullName: string): ModuleInfo | undefined {
    const mod = this.modules.get(fullName);
    if (mod && (mod.kind === 'page' || mod.kind === 'component')) {
      return mod;
    }
    return undefined;
  }

  getAllModules(): Map<string, ModuleInfo> {
    return this.modules;
  }

  hasData(): boolean {
    return this.modules.size > 0;
  }
}
