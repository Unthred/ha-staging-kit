using System.Diagnostics;

namespace HaStagingConsole.Services;

/// <summary>Git-over-SSH for GitHub using the kit secrets key + known_hosts.</summary>
public sealed class GitSshConfigurator(KitPaths paths)
{
    public void Apply(ProcessStartInfo psi)
    {
        if (!File.Exists(paths.SshKeyFile))
            return;

        var knownHosts = Path.Combine(paths.SecretsDir, "known_hosts");
        EnsureGitHubKnownHosts(knownHosts);
        var sshCommand =
            $"ssh -i {ShellQuote(paths.SshKeyFile)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile={ShellQuote(knownHosts)} -o BatchMode=yes -o ConnectTimeout=15";
        psi.Environment["GIT_SSH_COMMAND"] = sshCommand;
        psi.Environment["GIT_SSH"] = sshCommand;
    }

    public static void EnsureGitHubKnownHosts(string knownHostsPath)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(knownHostsPath)!);
            if (File.Exists(knownHostsPath))
            {
                var existing = File.ReadAllText(knownHostsPath);
                if (existing.Contains("github.com", StringComparison.OrdinalIgnoreCase))
                    return;
            }

            var psi = new ProcessStartInfo("ssh-keyscan")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            psi.ArgumentList.Add("-t");
            psi.ArgumentList.Add("ed25519");
            psi.ArgumentList.Add("github.com");
            using var process = Process.Start(psi);
            if (process is null)
                return;

            var output = process.StandardOutput.ReadToEnd().Trim();
            process.WaitForExit();
            if (process.ExitCode != 0 || string.IsNullOrWhiteSpace(output))
                return;

            File.AppendAllText(knownHostsPath, output + Environment.NewLine);
        }
        catch
        {
            // Git operations will surface SSH errors if known_hosts cannot be prepared.
        }
    }

    static string ShellQuote(string value) => "'" + value.Replace("'", "'\\''") + "'";
}
