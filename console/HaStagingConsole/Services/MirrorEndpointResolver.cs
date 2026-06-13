using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

/// <summary>
/// Derives MQTT mirror endpoints from prod/staging URLs, topology, and kit .env.
/// Mosquitto runs inside the kit container; staging HA needs the host IP where MIRROR_PORT is published.
/// </summary>
public sealed class MirrorEndpointResolver(KitPaths paths)
{
    public MirrorSettings Resolve(OnboardingState state)
    {
        if (!state.Mirror.Enabled)
            return state.Mirror;

        var env = EnvFile.Read(paths.EnvFile);
        var sidecar = EnvFile.Read(paths.ConfigEnvFile);
        var hostEnv = File.Exists(paths.HostEnvFile) ? EnvFile.Read(paths.HostEnvFile) : env;

        var prodHost = ResolveProdMqttHost(state.Prod.Url, env);
        var prodPort = ParsePort(env.GetValueOrDefault("PROD_MQTT_PORT"), 1883);
        var (stagingBroker, stagingPort) = ResolveStagingMqttBroker(state, env, sidecar, hostEnv);

        return state.Mirror with
        {
            ProdMqttHost = prodHost ?? "",
            ProdMqttPort = prodPort,
            StagingMqttBrokerHost = stagingBroker ?? "",
            StagingMqttPort = stagingPort
        };
    }

    public bool ApplyIfEnabled(OnboardingState state)
    {
        if (!state.Mirror.Enabled)
            return false;

        var resolved = Resolve(state);
        if (resolved == state.Mirror)
            return false;

        state.Mirror = resolved;
        return true;
    }

    static string? ResolveProdMqttHost(string prodUrl, IReadOnlyDictionary<string, string> env)
    {
        var configured = env.GetValueOrDefault("PROD_MQTT_HOST")?.Trim();
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        return PreferLanHost(HostFromHttpUrl(prodUrl));
    }

    static (string? Broker, int Port) ResolveStagingMqttBroker(
        OnboardingState state,
        IReadOnlyDictionary<string, string> env,
        IReadOnlyDictionary<string, string> sidecar,
        IReadOnlyDictionary<string, string> hostEnv)
    {
        var port = ParsePort(
            FirstNonEmpty(env.GetValueOrDefault("STAGING_MQTT_PORT"), env.GetValueOrDefault("MIRROR_PORT")),
            1883);

        var kitLan = FirstNonEmpty(
            hostEnv.GetValueOrDefault("KIT_LAN_IP"),
            env.GetValueOrDefault("KIT_LAN_IP"),
            hostEnv.GetValueOrDefault("KIT_HOST_IP"),
            env.GetValueOrDefault("KIT_HOST_IP"));

        var stagingUrlHost = PreferLanHost(
            HostFromHttpUrl(state.Staging.Url),
            HostFromHttpUrl(sidecar.GetValueOrDefault("STAGING_HA_URL")),
            HostFromHttpUrl(env.GetValueOrDefault("STAGING_HA_URL")));

        // Same-host Docker: staging reaches the kit broker via the host LAN IP (published MIRROR_PORT).
        if (state.Topology.SameHostAsKit)
        {
            var broker = FirstNonEmpty(stagingUrlHost, kitLan, DetectKitLanIp());
            return (broker, port);
        }

        // Remote staging: kit broker is still on the kit host — prefer explicit KIT_LAN_IP, else staging URL if it points at kit.
        var remoteBroker = FirstNonEmpty(kitLan, stagingUrlHost, DetectKitLanIp());
        return (remoteBroker, port);
    }

    static int ParsePort(string? value, int fallback) =>
        int.TryParse(value, out var port) && port > 0 ? port : fallback;

    static string? DetectKitLanIp()
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo("bash")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            psi.ArgumentList.Add("-lc");
            psi.ArgumentList.Add("hostname -I 2>/dev/null");

            using var proc = System.Diagnostics.Process.Start(psi);
            if (proc is null)
                return null;

            var output = proc.StandardOutput.ReadToEnd().Trim();
            proc.WaitForExit();
            if (proc.ExitCode != 0 || string.IsNullOrWhiteSpace(output))
                return null;

            return PreferLanHost(output.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        }
        catch
        {
            return null;
        }
    }

    static string? PreferLanHost(params string?[] hosts)
    {
        foreach (var host in hosts)
        {
            if (string.IsNullOrWhiteSpace(host) || IsLocalHostHost(host) || IsLikelyContainerBridgeIp(host))
                continue;
            if (host.StartsWith("192.168.", StringComparison.Ordinal))
                return host.Trim();
        }

        foreach (var host in hosts)
        {
            if (string.IsNullOrWhiteSpace(host) || IsLocalHostHost(host) || IsLikelyContainerBridgeIp(host))
                continue;
            if (host.StartsWith("10.", StringComparison.Ordinal))
                return host.Trim();
        }

        foreach (var host in hosts)
        {
            if (string.IsNullOrWhiteSpace(host) || IsLocalHostHost(host) || IsLikelyContainerBridgeIp(host))
                continue;
            return host.Trim();
        }

        return null;
    }

    static bool IsLocalHostHost(string? host) =>
        host is "127.0.0.1" or "localhost" or "::1";

    static bool IsLikelyContainerBridgeIp(string? host)
    {
        if (string.IsNullOrWhiteSpace(host) || !System.Net.IPAddress.TryParse(host, out var ip))
            return false;

        var bytes = ip.GetAddressBytes();
        return bytes.Length == 4 && bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31;
    }

    static string? HostFromHttpUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return null;
        return Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri) ? uri.Host : null;
    }

    static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }

        return null;
    }
}
