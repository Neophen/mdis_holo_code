# Issue Title
Proposal: Mix task for IDE introspection of pages, components, and their metadata

# Issue Body

## Summary

I'm building [a VS Code/Cursor extension for Hologram](https://github.com/Neophen/vscode-hologram) and I've hit the limits of what static regex parsing can do for editor features like autocomplete, diagnostics, and go-to-definition.

I'd like to propose shipping a `mix hologram.introspect` task with Hologram that outputs structured JSON about the project's pages, components, and their metadata. This would enable any editor tooling to provide rich, accurate IntelliSense without reimplementing Elixir parsing.

## The Problem

Editor extensions currently have to regex-parse `.ex` files to discover:
- Pages (`use Hologram.Page`) with their routes
- Components (`use Hologram.Component`) with their props
- Actions and commands defined on pages/components
- State keys from `put_state` calls

This is fragile — it breaks on custom `use` wrappers, multiline expressions, and can't see runtime-resolved values.

## Proposed Solution

A Mix task that starts the app and uses Hologram's own APIs to dump accurate metadata:

```bash
# One-shot: outputs .hologram.json
mix hologram.introspect

# Watch mode: re-dumps on recompile (for use alongside phx.server)
mix hologram.introspect --watch
```

### Output format (`.hologram.json`)

```json
{
  "pages": {
    "MyApp.PlacePage": {
      "route": "/places/:id",
      "props": [{"name": "id", "type": "integer", "required": true}],
      "actions": ["increment", "toggle"],
      "commands": ["save_place"]
    }
  },
  "components": {
    "MyApp.Components.PlacePreview": {
      "props": [{"name": "place", "type": "Place", "required": true}],
      "actions": ["like"],
      "commands": []
    }
  },
  "timestamp": "2026-03-16T..."
}
```

### How it works

The task would use Hologram's compiled module metadata:
- `Module.__props__/0` — for component/page props
- `Module.route/0` — for page routes
- `Code.fetch_docs/1` — for action/command clause names

### Editor integration

The extension watches `.hologram.json` for changes. When the file updates (from watch mode or manual run), the editor instantly picks up the new metadata — no restart needed.

I've prototyped this in my extension: [mixTaskScaffolder.ts](https://github.com/Neophen/vscode-hologram/blob/main/src/mixTaskScaffolder.ts). Currently the extension scaffolds the Mix task into the user's project via a command, but shipping it with Hologram would be much better because:

1. **No scaffolding step** — it just works
2. **Could hook into compilation callbacks** instead of polling
3. **Stays in sync** with Hologram's internal APIs as they evolve
4. **Benefits any editor** — not just VS Code (Neovim, Emacs, Zed, etc.)

## What this enables in editors

With accurate introspected data, editors can provide:
- **Prop validation** on `<PlacePreview wrong_prop={...}>` → "Unknown prop, did you mean: place?"
- **Missing prop warnings** on `<Link>` → "Missing required prop: to"
- **Page completions** in `to={` and `put_page()` with routes
- **Action/command completions** in `$click=` with correct syntax inference
- **State variable completions** via `@` in templates

## Questions

1. Would you be open to including something like this in Hologram?
2. Is `Module.__props__/0` the right way to get props, or is there a better API?
3. For detecting Hologram pages vs components at runtime, is checking `__using__/0` reliable, or is there a canonical way?
4. Should this live in Hologram core or as a separate `hologram_devtools` package?

Happy to implement this as a PR if the approach makes sense.
