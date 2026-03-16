import * as vscode from 'vscode';

const MIX_TASK_TEMPLATE = `defmodule Mix.Tasks.Hologram.Introspect do
  use Mix.Task

  @shortdoc "Outputs Hologram/Ash module info as JSON for the VS Code extension"

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    watch? = "--watch" in args
    output_dir = Path.join(File.cwd!(), ".hologram")
    File.mkdir_p!(output_dir)

    dump(output_dir)

    if watch? do
      IO.puts("Hologram introspection watching for changes... (#{output_dir}/)")
      loop(output_dir)
    end
  end

  defp loop(output_dir) do
    Process.sleep(3_000)

    try do
      Mix.Task.reenable("compile")
      Mix.Task.run("compile", ["--no-deps-check"])
    rescue
      _ -> :ok
    end

    dump(output_dir)
    loop(output_dir)
  end

  defp dump(output_dir) do
    modules = :code.all_loaded() |> Enum.map(&elem(&1, 0))

    resources = extract_ash_resources(modules)
    pages = extract_hologram_modules(modules, :page)
    components = extract_hologram_modules(modules, :component)
    module_locations = extract_module_locations(modules)

    write_json(output_dir, "pages.json", pages)
    write_json(output_dir, "components.json", components)
    write_json(output_dir, "resources.json", resources)
    write_json(output_dir, "modules.json", module_locations)

    IO.puts("Hologram introspection updated at #{DateTime.utc_now() |> DateTime.to_iso8601()}")
  end

  defp write_json(output_dir, filename, data) do
    path = Path.join(output_dir, filename)
    json = Jason.encode!(data, pretty: true)
    File.write!(path, json)
  end

  # --- Module Locations ---

  defp extract_module_locations(modules) do
    modules
    |> Enum.filter(&Code.ensure_loaded?/1)
    |> Enum.map(fn mod ->
      name = mod |> to_string() |> String.replace_leading("Elixir.", "")
      {file, line} = get_module_location(mod)
      {name, %{file: file, line: line}}
    end)
    |> Enum.filter(fn {_name, %{file: file}} -> file != nil end)
    |> Enum.filter(fn {_name, %{file: file}} -> String.starts_with?(file, "lib/") end)
    |> Enum.into(%{})
  end

  defp get_module_location(mod) do
    source = get_source_file(mod)

    case source do
      nil ->
        {nil, 0}

      path ->
        relative = make_relative(path)
        line = find_defmodule_line(path, mod)
        {relative, line}
    end
  end

  defp get_source_file(mod) do
    case mod.__info__(:compile)[:source] do
      nil -> nil
      source -> to_string(source)
    end
  rescue
    _ -> nil
  end

  defp make_relative(path) do
    cwd = File.cwd!()

    if String.starts_with?(path, cwd) do
      path |> String.replace_leading(cwd <> "/", "")
    else
      path
    end
  end

  defp find_defmodule_line(path, mod) do
    mod_name = mod |> to_string() |> String.replace_leading("Elixir.", "")

    case File.read(path) do
      {:ok, content} ->
        content
        |> String.split("\\n")
        |> Enum.with_index(1)
        |> Enum.find_value(1, fn {line, idx} ->
          if String.match?(line, ~r/^\\s*defmodule\\s+#{Regex.escape(mod_name)}\\s+do/) do
            idx
          end
        end)

      _ ->
        1
    end
  end

  # --- Ash Resources ---

  defp extract_ash_resources(modules) do
    modules
    |> Enum.filter(&ash_resource?/1)
    |> Enum.map(fn mod ->
      name = mod |> to_string() |> String.replace_leading("Elixir.", "")
      source = get_source_file(mod)
      relative_path = if source, do: make_relative(source), else: nil
      mod_line = if source, do: find_defmodule_line(source, mod), else: 1

      attributes =
        try do
          Ash.Resource.Info.attributes(mod)
          |> Enum.map(fn attr ->
            line = if source, do: find_pattern_line(source, ~r/^\\s*attribute\\s+:#{attr.name}/), else: nil
            %{
              name: attr.name,
              type: inspect(attr.type),
              line: line || 0,
              primaryKey: attr.primary_key?
            }
          end)
        rescue
          _ -> []
        end

      relationships =
        try do
          Ash.Resource.Info.relationships(mod)
          |> Enum.map(fn rel ->
            dest = rel.destination |> to_string() |> String.replace_leading("Elixir.", "")
            line = if source, do: find_pattern_line(source, ~r/^\\s*#{rel.type}\\s+:#{rel.name}/), else: nil
            %{
              name: rel.name,
              type: to_string(rel.type),
              destination: dest,
              line: line || 0
            }
          end)
        rescue
          _ -> []
        end

      {name, %{
        file: relative_path,
        line: mod_line,
        attributes: attributes,
        relationships: relationships
      }}
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
      source = get_source_file(mod)
      relative_path = if source, do: make_relative(source), else: nil
      mod_line = if source, do: find_defmodule_line(source, mod), else: 1

      props =
        try do
          mod.__props__()
          |> Enum.map(fn {prop_name, prop_type, opts} ->
            resolved_type =
              case prop_type do
                type when is_atom(type) ->
                  if function_exported?(type, :__info__, 1) do
                    type |> to_string() |> String.replace_leading("Elixir.", "")
                  else
                    inspect(type)
                  end

                other ->
                  inspect(other)
              end

            %{
              name: prop_name,
              type: resolved_type,
              required: !Keyword.has_key?(opts, :default)
            }
          end)
        rescue
          _ -> []
        end

      actions = extract_action_command_info(mod, source, :action)
      commands = extract_action_command_info(mod, source, :command)

      template_line = if source, do: find_pattern_line(source, ~r/^\\s*def\\s+template\\b/), else: nil
      init_line = if source, do: find_pattern_line(source, ~r/^\\s*def\\s+init\\b/), else: nil

      state_keys =
        if source do
          extract_state_keys(source)
        else
          []
        end

      functions = extract_functions(mod, source)

      route =
        try do
          if function_exported?(mod, :route, 0), do: mod.route(), else: nil
        rescue
          _ -> nil
        end

      result = %{
        file: relative_path,
        line: mod_line,
        props: props,
        actions: actions,
        commands: commands,
        stateKeys: state_keys,
        functions: functions
      }

      result = if template_line, do: Map.put(result, :templateLine, template_line), else: result
      result = if init_line, do: Map.put(result, :initLine, init_line), else: result
      result = if route, do: Map.put(result, :route, route), else: result

      {name, result}
    end)
    |> Enum.into(%{})
  end

  defp extract_action_command_info(mod, source, func_name) do
    arity = 3

    names =
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
          []
      end

    Enum.map(names, fn name ->
      line =
        if source do
          find_pattern_line(source, ~r/^\\s*def\\s+#{func_name}\\s*\\(\\s*:#{name}\\b/)
        else
          nil
        end

      {uses_params, params} =
        if source do
          extract_params_info(source, func_name, name)
        else
          {false, []}
        end

      %{
        name: name,
        line: line || 0,
        usesParams: uses_params,
        params: params
      }
    end)
  end

  defp extract_params_info(source_path, func_name, action_name) do
    case File.read(source_path) do
      {:ok, content} ->
        lines = String.split(content, "\\n")
        pattern = ~r/^\\s*def\\s+#{func_name}\\s*\\(\\s*:#{action_name}\\s*,\\s*(\\w+)/

        case Enum.find_value(lines, fn line ->
          case Regex.run(pattern, line) do
            [_, params_var] -> params_var
            _ -> nil
          end
        end) do
          nil ->
            {false, []}

          params_var when params_var in ["_params", "_"] ->
            {false, []}

          params_var ->
            # Find the function body and extract param access patterns
            params = extract_param_keys_from_source(lines, func_name, action_name, params_var)
            {length(params) > 0, params}
        end

      _ ->
        {false, []}
    end
  end

  defp extract_param_keys_from_source(lines, func_name, action_name, params_var) do
    # Find the function start and extract body
    func_pattern = ~r/^\\s*def\\s+#{func_name}\\s*\\(\\s*:#{action_name}\\b/
    start_idx = Enum.find_index(lines, fn line -> Regex.match?(func_pattern, line) end)

    if start_idx do
      body =
        lines
        |> Enum.slice((start_idx + 1)..-1//1)
        |> Enum.take_while(fn line -> !Regex.match?(~r/^\\s*def(p)?\\s+/, line) end)
        |> Enum.join("\\n")

      dot_keys =
        Regex.scan(~r/#{Regex.escape(params_var)}\\.(\\w+)/, body)
        |> Enum.map(fn [_, key] -> key end)
        |> Enum.reject(& &1 == "event")

      bracket_keys =
        Regex.scan(~r/#{Regex.escape(params_var)}\\[\\s*:(\\w+)\\s*\\]/, body)
        |> Enum.map(fn [_, key] -> key end)

      (dot_keys ++ bracket_keys) |> Enum.uniq()
    else
      []
    end
  end

  defp extract_state_keys(source_path) do
    case File.read(source_path) do
      {:ok, content} ->
        # put_state(component, :key, value) or |> put_state(:key, value)
        atom_keys =
          Regex.scan(~r/put_state\\s*\\([^,]*,\\s*:(\\w+)/, content)
          |> Enum.map(fn [_, key] -> key end)

        # put_state(component, key: value) keyword list
        kw_keys =
          Regex.scan(~r/put_state\\s*\\([^,]+,\\s*((?:\\w+:\\s*[^,)]+,?\\s*)+)/, content)
          |> Enum.flat_map(fn [_, kw_str] ->
            Regex.scan(~r/(\\w+):/, kw_str) |> Enum.map(fn [_, k] -> k end)
          end)

        # put_state(component, %{key: value})
        map_keys =
          Regex.scan(~r/put_state\\s*\\([^,]+,\\s*%\\{([^}]+)\\}/, content)
          |> Enum.flat_map(fn [_, map_str] ->
            Regex.scan(~r/(\\w+):/, map_str) |> Enum.map(fn [_, k] -> k end)
          end)

        (atom_keys ++ kw_keys ++ map_keys) |> Enum.uniq()

      _ ->
        []
    end
  end

  defp extract_functions(mod, source) do
    # Get public and private functions from module info
    functions =
      try do
        # Get public functions
        pub = mod.__info__(:functions)
        # Filter out framework callbacks and internal functions
        skip = [:__using__, :__props__, :route, :template, :init, :action, :command]

        pub
        |> Enum.reject(fn {name, _arity} -> name in skip end)
        |> Enum.reject(fn {name, _arity} -> String.starts_with?(to_string(name), "__") end)
        |> Enum.map(fn {name, arity} ->
          line =
            if source do
              find_pattern_line(source, ~r/^\\s*def\\s+#{name}\\s*[\\(]/)
            else
              nil
            end

          %{name: to_string(name), line: line || 0, arity: arity}
        end)
      rescue
        _ -> []
      end

    functions
  end

  defp find_pattern_line(source_path, pattern) do
    case File.read(source_path) do
      {:ok, content} ->
        content
        |> String.split("\\n")
        |> Enum.with_index(1)
        |> Enum.find_value(fn {line, idx} ->
          if Regex.match?(pattern, line), do: idx
        end)

      _ ->
        nil
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

  // Add .hologram/ to .gitignore if not already there
  try {
    const gitignorePath = vscode.Uri.joinPath(projectRoot, '.gitignore');
    let gitignore = '';
    try {
      const bytes = await vscode.workspace.fs.readFile(gitignorePath);
      gitignore = Buffer.from(bytes).toString('utf8');
    } catch { /* no .gitignore */ }

    if (!gitignore.includes('.hologram/')) {
      const updated = gitignore.trimEnd() + '\n\n# Hologram VS Code extension\n.hologram/\n';
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
