# Changelog

## 0.4.13

### Improvements
- Migrate to **mdis_holo_dev** dependency

## 0.4.12

### Improvements
- Rebrand to **Holo Dev** with updated branding and repository references
- Remove **Mix task scaffolder** command and related functionality

## 0.4.11

### Improvements
- Optimized **logo** asset and removed legacy SVG variant
- Simplified release tooling

## 0.4.10

### Improvements
- **Consolidated providers** – refactored definition, completion, and diagnostics to leverage workspace index for improved accuracy and performance
- **Enhanced Mix scaffolding** – improved Mix task template detection and formatting
- Removed `hologram.customComponents` configuration setting (no longer needed)

## 0.4.9

### Improvements
- Consolidated release automation into single script

## 0.4.8

### Improvements

- Automated release workflow with AI-generated commit messages and changelogs
- Release notes extraction handles multiple header formats
- VSIX file attached to GitHub releases as downloadable asset

## 0.4.7

- Removed explicit `activationEvents` — VS Code infers these automatically
- Replaced manual release script with npm lifecycle hooks for automated releases

## 0.4.6

### New Features

- **"Hologram: Create Mix Tasks" command** (Cmd+Shift+P) — scaffolds `mix hologram.introspect` into your Elixir project for runtime introspection of pages, components, props, actions, and commands
- **Watch mode** — run `mix hologram.introspect --watch` alongside `phx.server` to auto-update editor data on recompile
- **`.holo_dev/*.json` file watcher** — extension picks up introspected data and merges it into the workspace index

### Improvements

- Simplified field resolution — removed fragile map/struct inference, kept Ash resource scanning
- Workspace index supports `actions` and `commands` on module entries

## 0.4.4

- Added extension icon to VS Code Marketplace and Open VSX
- Updated extension description
- Added version/installs/license badges to README

## 0.4.3

- Fixed `.vscodeignore` to exclude dev files from VSIX
- Updated GitHub Actions to Node LTS and actions v5
- Fixed Open VSX publish command

## 0.3.0

### New Features

- Event type completions (`$click`, `$change`, etc.) sorted by usage frequency
- Action/command completions with smart syntax detection (text, shorthand, longhand)
- State variable and prop completions via `@` in templates
- Ash resource field completions via `@prop.`
- Page module completions in `<Link to={` and `put_page()`
- Diagnostics for unknown fields, invalid pages, missing/unknown component props
- Quick fix code actions for all diagnostics
- Shared workspace index with file watcher for fast lookups
- Configurable event types and custom components

### Improvements

- Go to Definition for `@prop.field` — jumps to Ash resource attribute
- All providers share a single workspace index

## 0.2.0

- Go to Definition for `@variable`, `$click="action"`, `<Component>`, `to={PageModule}`, `function_call()`
- Alias resolution including grouped syntax
- Configurable jump target for components

## 0.1.0

- Initial release with syntax highlighting for `.holo` files and `~HOLO` sigils
- Hologram control flow, components, events, expressions, embedded CSS/JS
