<p align="center">
  <img src="assets/logo.png" alt="Hologram" width="128" />
</p>

# Hologram for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/MDIS.vscode-hologram?label=version)](https://marketplace.visualstudio.com/items?itemName=MDIS.vscode-hologram)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/MDIS.vscode-hologram)](https://marketplace.visualstudio.com/items?itemName=MDIS.vscode-hologram)
[![License](https://img.shields.io/github/license/Neophen/vscode-hologram)](LICENSE)

Syntax highlighting, intelligent autocomplete, diagnostics, and Go to Definition for the [Hologram](https://hologram.page/) framework.

## Install

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=MDIS.vscode-hologram)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Registry-purple)](https://open-vsx.org/extension/MDIS/vscode-hologram)

- **VS Code**: [Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=MDIS.vscode-hologram)
- **Cursor / Open VSX** (VSCodium, Gitpod, etc.): [Install from Open VSX](https://open-vsx.org/extension/MDIS/vscode-hologram)

## Features

### Syntax Highlighting

Full syntax highlighting for `.holo` template files and `~HOLO"""` sigils in Elixir files:

- HTML tags and attributes
- Hologram control flow: `{%if}`, `{%else if}`, `{%else}`, `{%for}`, `{/if}`, `{/for}`
- Raw blocks: `{%raw}...{/raw}`
- Elixir expressions: `{expression}`
- Component tags: `<MyComponent>`
- Event bindings: `$click`, `$change`, `$submit`, etc.
- Expression attributes: `count={@count}`
- `<slot>` tags
- Embedded CSS in `<style>` blocks
- Embedded JavaScript in `<script>` blocks

### Autocomplete

#### Event Types

Type `$` inside an HTML tag to see all Hologram event types (`$click`, `$change`, `$submit`, etc.) sorted by usage frequency. The list is fully configurable.

#### Actions & Commands

After selecting an event type and typing `=`, the extension scans the current module and offers:

- **Actions** without params — inserts text syntax: `"my_action"`
- **Actions** with params — inserts expression shorthand: `{:my_action, key: value}`
- **Actions (longhand)** — inserts full syntax with target/params placeholders
- **Commands** — inserts longhand syntax: `{command: :my_command}`

The extension detects whether an action uses params by analyzing the function body.

#### State & Props (`@` completions)

Type `@` inside a `~HOLO` template to see all available state variables and props from the current module. State keys are extracted from `put_state` calls, props from `prop` declarations.

#### Field Access (`@prop.` completions)

Type `@place.` when `place` is a prop with a known Ash resource type — the extension resolves the module and suggests its attributes (`id`, `title`, `slug`, `inserted_at`, etc.).

Falls back to scanning existing `@var.field` usage patterns in the template.

#### Page Completions

Type `to={` inside a `<Link>` component or use `put_page(component, ` in an action to see all available page modules (`use Hologram.Page`). Shows route paths and uses aliased short names when available.

### Diagnostics

#### Unknown Fields

When a prop has a known Ash resource type, accessing a non-existent field shows a warning with "Did you mean?" suggestions and a list of available fields.

Quick fix actions let you replace the unknown field with a known one.

#### Invalid Page References

`to={NonExistentPage}` and `put_page(component, NonExistentPage)` show warnings when the page module doesn't exist, with suggestions for similar page names.

#### Component Prop Validation

- **Missing required props** — warns when a required prop (no default value) is not provided on a component tag
- **Unknown props** — warns when an attribute doesn't match any declared `prop` on the component

Built-in support for `Hologram.UI.Link` (requires `to` prop). Components from `deps/hologram/` are automatically indexed.

Quick fix actions: replace unknown props with suggestions, or add missing props.

### Go to Definition

Cmd+click (or Ctrl+click) navigation in both `.holo` and `.ex` files:

| Context | Jumps to |
|---|---|
| `@variable` | `put_state(...)` or `prop :name` declaration |
| `$click="action"` | `def action(...)` or `def command(...)` |
| `<Component>` | Component module (configurable target) |
| `to={PageModule}` | Page module's template |
| `@place.title` | `attribute :title` in the Ash resource |
| `function_call()` | `def`/`defp` definition in the current module |
| `layout ModuleName` | Layout module |

Component and alias resolution supports `alias Mod.{A, B}` grouped syntax.

### Workspace Index

The extension builds a workspace index on activation for fast lookups:

- Scans all `.ex/.exs` files once (including `deps/hologram/`)
- Updates incrementally via file watcher when files change
- Indexes: pages, components, props, Ash resource fields, routes
- Shared across all providers for consistent, fast results

### Mix Introspection (Optional)

For the most accurate data, scaffold a Mix task into your project:

1. Open Command Palette (`Cmd+Shift+P`)
2. Run **"Hologram: Create Mix Tasks"**
3. Choose "Run once" or "Run in watch mode"

This creates `lib/mix/tasks/hologram.introspect.ex` which uses Hologram's compiled module metadata to output a `.hologram.json` file. The extension watches this file and merges the introspected data into the workspace index — overriding regex results with accurate runtime data.

**Watch mode** (`mix hologram.introspect --watch`) re-introspects every 3 seconds on recompile, ideal for running alongside `mix phx.server`.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `hologram.defaultJumpTarget` | `template` | Where Cmd+click lands on component tags: `template`, `init`, or `module` |
| `hologram.eventTypes` | All 15 event types | Configurable list of event types for autocomplete. Order determines sort priority. |
| `hologram.customComponents` | `[]` | Define additional components (e.g. from deps) with their props for validation. |

### Custom Components Example

```json
"hologram.customComponents": [
  {
    "module": "MyLib.Components.Button",
    "props": [
      { "name": "label", "type": "string", "required": true },
      { "name": "variant", "type": "string" }
    ]
  }
]
```

## License

MIT
