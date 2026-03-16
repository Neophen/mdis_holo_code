import * as vscode from 'vscode';

export interface ModuleInfo {
  fullName: string;
  uri: vscode.Uri;
  defmoduleLine: number;
  kind: 'page' | 'component' | 'module';
  route?: string;
  props: { name: string; type: string; hasDefault: boolean }[];
  fields: string[];
  actions?: string[];
  commands?: string[];
  templateLine?: number;
  initLine?: number;
}

export class WorkspaceIndex implements vscode.Disposable {
  private modules = new Map<string, ModuleInfo>();
  private uriToModules = new Map<string, string[]>(); // uri.toString() -> module names
  private watcher: vscode.FileSystemWatcher | undefined;
  private disposables: vscode.Disposable[] = [];

  private _onDidUpdate = new vscode.EventEmitter<void>();
  readonly onDidUpdate = this._onDidUpdate.event;

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private initialized = false;

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this._onDidUpdate.dispose();
    this.watcher?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Register built-in Hologram UI components
    this.registerBuiltinComponents();

    // Load custom components from settings
    this.loadCustomComponents();

    // Scan all project files + deps/hologram/
    const [projectFiles, hologramDepFiles] = await Promise.all([
      vscode.workspace.findFiles('**/*.{ex,exs}', '{**/deps/**,**/node_modules/**,**/_build/**}'),
      vscode.workspace.findFiles('**/deps/hologram/**/*.{ex,exs}'),
    ]);

    const allFiles = [...projectFiles, ...hologramDepFiles];

    // Batch: process files in chunks to avoid opening too many documents at once
    const BATCH_SIZE = 50;
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(uri => this.indexFile(uri)));
    }

    // Set up file watcher for incremental updates
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{ex,exs}');
    this.watcher.onDidCreate(uri => this.onFileChanged(uri));
    this.watcher.onDidChange(uri => this.onFileChanged(uri));
    this.watcher.onDidDelete(uri => this.onFileDeleted(uri));
    this.disposables.push(this.watcher);

    // Reload custom components when settings change
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('hologram.customComponents')) {
          this.loadCustomComponents();
          this.fireUpdate();
        }
      })
    );

    // Watch for .hologram.json (written by mix hologram.introspect)
    const jsonWatcher = vscode.workspace.createFileSystemWatcher('**/.hologram.json');
    jsonWatcher.onDidCreate(uri => this.loadIntrospectionFile(uri));
    jsonWatcher.onDidChange(uri => this.loadIntrospectionFile(uri));
    this.disposables.push(jsonWatcher);

    // Try to load existing .hologram.json on startup
    this.loadExistingIntrospectionFiles();
  }

  private registerBuiltinComponents(): void {
    // Hologram.UI.Link — hardcoded since it's a core framework component
    const linkUri = vscode.Uri.parse('hologram-builtin:Hologram.UI.Link');
    this.modules.set('Hologram.UI.Link', {
      fullName: 'Hologram.UI.Link',
      uri: linkUri,
      defmoduleLine: 0,
      kind: 'component',
      props: [
        { name: 'to', type: 'module', hasDefault: false },
        { name: 'class', type: 'string', hasDefault: true },
        { name: 'rel', type: 'string', hasDefault: true },
        { name: 'style', type: 'string', hasDefault: true },
      ],
      fields: [],
      templateLine: undefined,
      initLine: undefined,
    });
  }

  private loadCustomComponents(): void {
    const config = vscode.workspace.getConfiguration('hologram');
    const customComponents = config.get<{
      module: string;
      props: { name: string; type?: string; required?: boolean }[];
    }[]>('customComponents', []);

    for (const comp of customComponents) {
      const uri = vscode.Uri.parse(`hologram-custom:${comp.module}`);
      this.modules.set(comp.module, {
        fullName: comp.module,
        uri,
        defmoduleLine: 0,
        kind: 'component',
        props: comp.props.map(p => ({
          name: p.name,
          type: p.type || 'any',
          hasDefault: !(p.required ?? false),
        })),
        fields: [],
        templateLine: undefined,
        initLine: undefined,
      });
    }
  }

  // --- Queries ---

  getAllPages(): ModuleInfo[] {
    const pages: ModuleInfo[] = [];
    for (const mod of this.modules.values()) {
      if (mod.kind === 'page') {
        pages.push(mod);
      }
    }
    return pages;
  }

  getAllComponents(): Map<string, ModuleInfo> {
    const components = new Map<string, ModuleInfo>();
    for (const [name, mod] of this.modules) {
      if (mod.kind === 'component' || mod.kind === 'page') {
        components.set(name, mod);
      }
    }
    return components;
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

  getAllModules(): Map<string, ModuleInfo> {
    return this.modules;
  }

  // --- File parsing ---

  private async indexFile(uri: vscode.Uri): Promise<void> {
    // Skip non-hologram deps (but allow deps/hologram/)
    const path = uri.fsPath;
    if (path.includes('/deps/') && !path.includes('/deps/hologram/')) {
      return;
    }

    let text: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(bytes).toString('utf8');
    } catch {
      return;
    }

    // Remove old modules from this file
    const uriKey = uri.toString();
    const oldModules = this.uriToModules.get(uriKey);
    if (oldModules) {
      for (const name of oldModules) {
        this.modules.delete(name);
      }
    }

    const newModuleNames: string[] = [];
    const lines = text.split('\n');

    // Find all defmodule declarations
    const moduleStarts: { name: string; line: number; startIdx: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\s*defmodule\s+(\S+)\s+do/);
      if (match) {
        moduleStarts.push({ name: match[1], line: i, startIdx: i });
      }
    }

    for (let mi = 0; mi < moduleStarts.length; mi++) {
      const { name: fullName, line: defmoduleLine } = moduleStarts[mi];
      const endLine = mi + 1 < moduleStarts.length
        ? moduleStarts[mi + 1].line - 1
        : lines.length - 1;

      // Determine kind
      let kind: 'page' | 'component' | 'module' = 'module';
      let route: string | undefined;
      const props: { name: string; type: string; hasDefault: boolean }[] = [];
      const fields: string[] = [];
      let templateLine: number | undefined;
      let initLine: number | undefined;

      for (let i = defmoduleLine; i <= endLine; i++) {
        const line = lines[i];
        if (!line) continue;

        // use Hologram.Page / use Hologram.Component
        if (/^\s*use\s+Hologram\.Page\s*$/.test(line)) {
          kind = 'page';
          continue;
        }
        if (/^\s*use\s+Hologram\.Component\s*$/.test(line)) {
          kind = 'component';
          continue;
        }

        // route("/path")
        const routeMatch = line.match(/^\s*route\s*\(\s*"([^"]+)"/);
        if (routeMatch) {
          route = routeMatch[1];
          continue;
        }

        // prop :name, :type, default: val
        const propMatch = line.match(/^\s*prop[\s(]+:(\w+)(?:\s*,\s*:?(\w[\w.\[\], :]*))?(?:\s*,\s*(default:.+))?/);
        if (propMatch) {
          const hasDefault = !!propMatch[3] || /,\s*default:/.test(propMatch[0]);
          props.push({ name: propMatch[1], type: propMatch[2]?.trim() || 'any', hasDefault });
          continue;
        }

        // attribute :name, :type (Ash)
        const attrMatch = line.match(/^\s*attribute\s+:(\w+)/);
        if (attrMatch) {
          fields.push(attrMatch[1]);
          continue;
        }

        // uuid_v7_primary_key(:id) etc (Ash)
        const pkMatch = line.match(/^\s*(?:uuid_v7_primary_key|uuid_primary_key|integer_primary_key)\s*\(\s*:(\w+)/);
        if (pkMatch) {
          fields.push(pkMatch[1]);
          continue;
        }

        // timestamps() -> inserted_at, updated_at
        if (/^\s*timestamps\(\)/.test(line)) {
          fields.push('inserted_at', 'updated_at');
          continue;
        }

        // def template
        if (/^\s*def\s+template\b/.test(line)) {
          templateLine = i;
          continue;
        }

        // def init
        if (/^\s*def\s+init\b/.test(line)) {
          initLine = i;
          continue;
        }
      }

      const info: ModuleInfo = {
        fullName,
        uri,
        defmoduleLine,
        kind,
        route,
        props,
        fields,
        templateLine,
        initLine,
      };

      this.modules.set(fullName, info);
      newModuleNames.push(fullName);
    }

    this.uriToModules.set(uriKey, newModuleNames);
  }

  // --- Incremental updates ---

  private onFileChanged(uri: vscode.Uri): void {
    // Skip non-hologram deps
    const path = uri.fsPath;
    if (path.includes('/deps/') && !path.includes('/deps/hologram/')) {
      return;
    }

    this.indexFile(uri).then(() => this.fireUpdate());
  }

  private onFileDeleted(uri: vscode.Uri): void {
    const uriKey = uri.toString();
    const oldModules = this.uriToModules.get(uriKey);
    if (oldModules) {
      for (const name of oldModules) {
        this.modules.delete(name);
      }
      this.uriToModules.delete(uriKey);
      this.fireUpdate();
    }
  }

  private fireUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this._onDidUpdate.fire();
    }, 100);
  }

  // --- .hologram.json introspection ---

  private async loadExistingIntrospectionFiles(): Promise<void> {
    const files = await vscode.workspace.findFiles('.hologram.json', '**/node_modules/**');
    for (const uri of files) {
      await this.loadIntrospectionFile(uri);
    }
  }

  private async loadIntrospectionFile(uri: vscode.Uri): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      const data = JSON.parse(text) as IntrospectionData;

      this.mergeIntrospectionData(data);
      this.fireUpdate();
    } catch {
      // Invalid JSON or read error — ignore silently
    }
  }

  private mergeIntrospectionData(data: IntrospectionData): void {
    // Merge Ash resource fields
    if (data.resources) {
      for (const [moduleName, info] of Object.entries(data.resources)) {
        const existing = this.modules.get(moduleName);
        if (existing) {
          // Override regex-detected fields with introspected ones
          existing.fields = [
            ...info.attributes.map(a => typeof a === 'string' ? a : a.name),
            ...info.relationships.map(r => typeof r === 'string' ? r : r.name),
          ];
        } else {
          // Create a synthetic entry for resources not found by regex scan
          this.modules.set(moduleName, {
            fullName: moduleName,
            uri: vscode.Uri.parse(`hologram-introspected:${moduleName}`),
            defmoduleLine: 0,
            kind: 'module',
            props: [],
            fields: [
              ...info.attributes.map(a => typeof a === 'string' ? a : a.name),
              ...info.relationships.map(r => typeof r === 'string' ? r : r.name),
            ],
            templateLine: undefined,
            initLine: undefined,
          });
        }
      }
    }

    // Merge Hologram pages
    if (data.pages) {
      for (const [moduleName, info] of Object.entries(data.pages)) {
        const existing = this.modules.get(moduleName);
        if (existing) {
          existing.kind = 'page';
          if (info.route) existing.route = info.route;
          if (info.props && info.props.length > 0) {
            existing.props = info.props.map(p => ({
              name: typeof p === 'string' ? p : p.name,
              type: (typeof p !== 'string' && p.type) || 'any',
              hasDefault: typeof p !== 'string' ? !p.required : false,
            }));
          }
          if (info.actions) existing.actions = info.actions;
          if (info.commands) existing.commands = info.commands;
        }
      }
    }

    // Merge Hologram components
    if (data.components) {
      for (const [moduleName, info] of Object.entries(data.components)) {
        const existing = this.modules.get(moduleName);
        if (existing) {
          existing.kind = 'component';
          if (info.props && info.props.length > 0) {
            existing.props = info.props.map(p => ({
              name: typeof p === 'string' ? p : p.name,
              type: (typeof p !== 'string' && p.type) || 'any',
              hasDefault: typeof p !== 'string' ? !p.required : false,
            }));
          }
          if (info.actions) existing.actions = info.actions;
          if (info.commands) existing.commands = info.commands;
        }
      }
    }
  }
}

// Types for .hologram.json data
interface IntrospectionData {
  resources?: Record<string, {
    attributes: (string | { name: string; type?: string; primary_key?: boolean })[];
    relationships: (string | { name: string; type?: string; destination?: string })[];
  }>;
  pages?: Record<string, {
    route?: string;
    props?: (string | { name: string; type?: string; required?: boolean })[];
    actions?: string[];
    commands?: string[];
  }>;
  components?: Record<string, {
    props?: (string | { name: string; type?: string; required?: boolean })[];
    actions?: string[];
    commands?: string[];
  }>;
  timestamp?: string;
}
