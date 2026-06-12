namespace HaStagingConsole.Services;

public static class EnvFile
{
    public static Dictionary<string, string> Read(string path)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path))
            return result;

        foreach (var line in File.ReadAllLines(path))
        {
            if (string.IsNullOrWhiteSpace(line) || line.TrimStart().StartsWith('#'))
                continue;
            var idx = line.IndexOf('=');
            if (idx <= 0)
                continue;
            result[line[..idx].Trim()] = line[(idx + 1)..].Trim();
        }

        return result;
    }

    public static string? Get(string path, string key) =>
        Read(path).TryGetValue(key, out var value) ? value : null;

    public static int GetInt(string path, string key, int fallback) =>
        int.TryParse(Get(path, key), out var n) ? n : fallback;
}
