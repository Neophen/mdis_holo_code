# Changelog

Looking at the diff, the changes are:

1. Removed explicit `activationEvents` from `package.json` (VS Code infers these automatically now)
2. Replaced the manual `release` script with proper `preversion`/`version`/`postversion` lifecycle hooks
3. Added `scripts/generate-changelog.js` and `scripts/extract-changelog.js` for automated changelog generation
4. Updated `.github/workflows/publish.yml`

Here's the changelog entry for v0.4.7:

---

## [0.4.7]

### Changed
- Removed explicit `activationEvents` from `package.json`; VS Code now infers activation from language contributions automatically
- Improved release workflow: replaced manual `release` script with npm lifecycle hooks (`preversion`, `version`, `postversion`) for automated changelog generation and publishing

## 0.4.6

### New Features

- **"Hologram: Create Mix Tasks" command** (Cmd+Shift+P) — scaffolds `mix hologram.introspect` into your Elixir project for accurate runtime introspection of pages, components, props, actions, commands, and Ash resources
- **Watch mode** — run `mix hologram.introspect --watch` alongside `phx.server` to auto-update editor data on recompile
- **`.hologram.json` file watcher** — extension automatically picks up introspected data and merges it into the workspace index, overriding regex-detected fields with accurate compiled metadata

### Improvements

- Simplified field resolution — removed fragile map literal and defstruct inference, kept Ash resource scanning
- Workspace index now supports `actions` and `commands` on module entries
- Added `.hologram.json` to `.gitignore` when scaffolding the Mix task

## 0.4.4

- Added extension icon to VS Code Marketplace and Open VSX
- Updated extension description
- Added version/installs/license badges to README

## 0.4.3

- Fixed `.vscodeignore` to exclude `.claude/`, `.github/`, `.tool-versions` from VSIX
- Updated GitHub Actions to Node LTS and actions v5
- Fixed Open VSX publish command

## 0.3.0

### New Features

**Intelligent Autocomplete**
- Event type completions (`$click`, `$change`, etc.) triggered by typing `$` in HTML tags, sorted by usage frequency
- Action/command completions after event binding `=` — detects params usage and picks the right syntax (text, shorthand, or longhand)
- State variable and prop completions via `@` inside templates
- Ash resource field completions via `@prop.` for typed props
- Page module completions in `<Link to={` and `put_page()` calls

**Diagnostics & Quick Fixes**
- Warning on unknown Ash resource fields (`@place.nonexistent`) with "Did you mean?" suggestions
- Warning on invalid page references in `to={...}` and `put_page()` with similar page suggestions
- Warning on missing required component props
- Warning on unknown component props with suggestions
- Quick fix code actions to replace unknown fields/props or add missing props

**Workspace Index**
- One-time scan on activation for fast lookups across all providers
- Incremental updates via file watcher — no more repeated full workspace scans
- Indexes pages, components, props, Ash resource fields, and routes
- Built-in `Hologram.UI.Link` component support

**Configuration**
- `hologram.eventTypes` — customize and reorder the event type autocomplete list
- `hologram.customComponents` — define additional components from deps with their props

### Improvements

- Go to Definition now works on `@prop.field` — jumps to `attribute :field` in the Ash resource
- Go to Definition uses the workspace index for instant component/page lookups with full-scan fallback
- All providers share a single workspace index instead of independently scanning files

## 0.2.0

- Go to Definition for `@variable`, `$click="action"`, `<Component>`, `to={PageModule}`, `function_call()`
- Alias resolution including grouped syntax `alias Mod.{A, B}`
- Configurable jump target for components (`template`, `init`, or `module`)

## 0.1.0

- Initial release
- Syntax highlighting for `.holo` template files
- Syntax highlighting for `~HOLO` sigils in Elixir files
- Support for Hologram control flow: `{%if}`, `{%for}`, `{%raw}`
- Component tag highlighting (PascalCase)
- Event binding highlighting (`$click`, `$change`, etc.)
- Expression interpolation (`{expression}`)
- Embedded CSS and JavaScript support
- HTML entity recognition
