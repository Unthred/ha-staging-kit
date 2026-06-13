namespace HaStagingConsole.Services;

public static class TokenFile
{
    public static (string Url, string Token) Read(string path)
    {
        if (!File.Exists(path))
            return ("", "");

        var lines = File.ReadAllLines(path);
        return (lines.ElementAtOrDefault(0)?.Trim() ?? "", lines.ElementAtOrDefault(1)?.Trim() ?? "");
    }
}
