import * as vscode from 'vscode';

const MIX_TASK_TEMPLATE = `defmodule Mix.Tasks.Hologram.Introspect do
  use Mix.Task

  @shortdoc "Outputs Hologram/Ash module info as JSON for the VS Code extension"

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    watch? = "--watch" in args
    output_path = Path.join(File.cwd!(), ".hologram.json")

    dump(output_path)

    if watch? do
      IO.puts("Hologram introspection watching for changes... (#{output_path})")

      # Use recompile to detect changes
      loop(output_path)
    end
  end

  defp loop(output_path) do
    Process.sleep(3_000)

    try do
      Mix.Task.reenable("compile")
      Mix.Task.run("compile", ["--no-deps-check"])
    rescue
      _ -> :ok
    end

    dump(output_path)
    loop(output_path)
  end

  defp dump(output_path) do
    modules = :code.all_loaded() |> Enum.map(&elem(&1, 0))

    resources = extract_ash_resources(modules)
    pages = extract_hologram_modules(modules, :page)
    components = extract_hologram_modules(modules, :component)

    data = %{
      resources: resources,
      pages: pages,
      components: components,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    }

    json = Jason.encode!(data, pretty: true)
    File.write!(output_path, json)
  end

  # --- Ash Resources ---

  defp extract_ash_resources(modules) do
    modules
    |> Enum.filter(&ash_resource?/1)
    |> Enum.map(fn mod ->
      name = mod |> to_string() |> String.replace_leading("Elixir.", "")

      attributes =
        try do
          Ash.Resource.Info.attributes(mod)
          |> Enum.map(fn attr ->
            %{name: attr.name, type: inspect(attr.type), primary_key: attr.primary_key?}
          end)
        rescue
          _ -> []
        end

      relationships =
        try do
          Ash.Resource.Info.relationships(mod)
          |> Enum.map(fn rel ->
            %{name: rel.name, type: rel.type, destination: inspect(rel.destination)}
          end)
        rescue
          _ -> []
        end

      {name, %{attributes: attributes, relationships: relationships}}
    end)
    |> Enum.into(%{})
  end

  defp ash_resource?(mod) do
    Code.ensure_loaded?(mod) and
      function_exported?(mod, :spark_is, 0) and
      mod.spark_is() == Ash.Resource
  rescue
    _ -> false
  end

  # --- Hologram Pages & Components ---

  defp extract_hologram_modules(modules, kind) do
    target = if kind == :page, do: Hologram.Page, else: Hologram.Component

    modules
    |> Enum.filter(fn mod ->
      Code.ensure_loaded?(mod) and
        function_exported?(mod, :__using__, 0) and
        try do
          mod.__using__() == target
        rescue
          _ -> false
        end
    end)
    |> Enum.map(fn mod ->
      name = mod |> to_string() |> String.replace_leading("Elixir.", "")

      props =
        try do
          mod.__props__()
          |> Enum.map(fn {prop_name, prop_type, opts} ->
            %{
              name: prop_name,
              type: inspect(prop_type),
              required: !Keyword.has_key?(opts, :default)
            }
          end)
        rescue
          _ -> []
        end

      actions =
        try do
          extract_function_clauses(mod, :action, 3)
        rescue
          _ -> []
        end

      commands =
        try do
          extract_function_clauses(mod, :command, 3)
        rescue
          _ -> []
        end

      route =
        try do
          if function_exported?(mod, :route, 0), do: mod.route(), else: nil
        rescue
          _ -> nil
        end

      result = %{
        props: props,
        actions: actions,
        commands: commands
      }

      result = if route, do: Map.put(result, :route, route), else: result

      {name, result}
    end)
    |> Enum.into(%{})
  end

  defp extract_function_clauses(mod, func_name, arity) do
    # Get all clauses of action/3 or command/3 and extract the first arg (atom name)
    case Code.fetch_docs(mod) do
      {:docs_v1, _, _, _, _, _, docs} ->
        docs
        |> Enum.filter(fn
          {{:function, ^func_name, ^arity}, _, _, _, _} -> true
          _ -> false
        end)
        |> Enum.flat_map(fn {{:function, _, _}, _, signatures, _, _} ->
          signatures
          |> Enum.flat_map(fn sig ->
            case Regex.run(~r/#{func_name}\\(:(\w+)/, sig) do
              [_, name] -> [name]
              _ -> []
            end
          end)
        end)

      _ ->
        # Fallback: check if the function exists
        if function_exported?(mod, func_name, arity) do
          # We can't easily enumerate clauses without docs, return empty
          []
        else
          []
        end
    end
  end
end
`;

export async function createMixTask(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  let projectRoot: vscode.Uri | undefined;
  for (const folder of workspaceFolders) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, 'mix.exs'));
      projectRoot = folder.uri;
      break;
    } catch { /* no mix.exs here */ }
  }

  if (!projectRoot) {
    vscode.window.showErrorMessage('No mix.exs found in workspace.');
    return;
  }

  const taskDir = vscode.Uri.joinPath(projectRoot, 'lib', 'mix', 'tasks');
  const taskFile = vscode.Uri.joinPath(taskDir, 'hologram.introspect.ex');

  try {
    await vscode.workspace.fs.stat(taskFile);
    const overwrite = await vscode.window.showWarningMessage(
      'lib/mix/tasks/hologram.introspect.ex already exists. Overwrite?',
      'Overwrite', 'Cancel'
    );
    if (overwrite !== 'Overwrite') return;
  } catch { /* file doesn't exist */ }

  await vscode.workspace.fs.createDirectory(taskDir);
  await vscode.workspace.fs.writeFile(taskFile, Buffer.from(MIX_TASK_TEMPLATE, 'utf8'));

  // Add .hologram.json to .gitignore if not already there
  try {
    const gitignorePath = vscode.Uri.joinPath(projectRoot, '.gitignore');
    let gitignore = '';
    try {
      const bytes = await vscode.workspace.fs.readFile(gitignorePath);
      gitignore = Buffer.from(bytes).toString('utf8');
    } catch { /* no .gitignore */ }

    if (!gitignore.includes('.hologram.json')) {
      const updated = gitignore.trimEnd() + '\n\n# Hologram VS Code extension\n.hologram.json\n';
      await vscode.workspace.fs.writeFile(gitignorePath, Buffer.from(updated, 'utf8'));
    }
  } catch { /* ignore gitignore errors */ }

  const choice = await vscode.window.showInformationMessage(
    'Created lib/mix/tasks/hologram.introspect.ex',
    'Run once', 'Run in watch mode'
  );

  if (choice === 'Run once') {
    const terminal = vscode.window.createTerminal('Hologram Introspect');
    terminal.sendText('mix hologram.introspect');
    terminal.show();
  } else if (choice === 'Run in watch mode') {
    const terminal = vscode.window.createTerminal('Hologram Introspect');
    terminal.sendText('mix hologram.introspect --watch');
    terminal.show();
  }
}
