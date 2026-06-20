using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace HaStagingConsole.Services;

/// <summary>One-shot Home Assistant WebSocket admin calls (config entry disable).</summary>
public sealed class HaConfigEntryAdminClient(ILogger<HaConfigEntryAdminClient> logger)
{
    public async Task<(int Disabled, IReadOnlyList<string> Log)> DisableConfigEntriesAsync(
        string url,
        string token,
        IReadOnlyList<string> entryIds,
        CancellationToken ct)
    {
        if (entryIds.Count == 0)
            return (0, Array.Empty<string>());

        var logs = new List<string>();
        var disabled = 0;
        using var socket = new ClientWebSocket();
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);
        await socket.ConnectAsync(BuildWebSocketUri(url), ct);

        var buffer = new byte[32 * 1024];
        if (!await AuthenticateAsync(socket, buffer, token, logs, ct))
            return (0, logs);

        var msgId = 1;
        foreach (var entryId in entryIds)
        {
            var id = msgId++;
            await SendAsync(socket, JsonSerializer.Serialize(new
            {
                id,
                type = "config_entries/disable",
                entry_id = entryId,
                disabled_by = "user"
            }), ct);

            var ok = await WaitForResultAsync(socket, buffer, id, ct);
            if (ok)
            {
                disabled++;
                logs.Add($"Disabled config entry {entryId}");
            }
            else
                logs.Add($"WARN: failed to disable config entry {entryId}");
        }

        if (socket.State == WebSocketState.Open)
        {
            try
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "WebSocket close after config entry disable");
            }
        }

        return (disabled, logs);
    }

    static async Task<bool> AuthenticateAsync(
        ClientWebSocket socket,
        byte[] buffer,
        string token,
        List<string> logs,
        CancellationToken ct)
    {
        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var json = await ReceiveTextAsync(socket, buffer, ct);
            if (json is null)
                return false;

            using var doc = JsonDocument.Parse(json);
            var type = doc.RootElement.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : null;
            switch (type)
            {
                case "auth_required":
                    await SendAsync(socket, JsonSerializer.Serialize(new { type = "auth", access_token = token }), ct);
                    break;
                case "auth_ok":
                    return true;
                case "auth_invalid":
                    logs.Add("WARN: staging API token rejected for config entry disable");
                    return false;
            }
        }

        return false;
    }

    static async Task<bool> WaitForResultAsync(ClientWebSocket socket, byte[] buffer, int expectedId, CancellationToken ct)
    {
        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var json = await ReceiveTextAsync(socket, buffer, ct);
            if (json is null)
                return false;

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "result"
                && root.TryGetProperty("id", out var idProp) && idProp.GetInt32() == expectedId)
            {
                return root.TryGetProperty("success", out var okProp) && okProp.GetBoolean();
            }
        }

        return false;
    }

    static async Task SendAsync(ClientWebSocket socket, string payload, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(payload);
        await socket.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }

    static async Task<string?> ReceiveTextAsync(ClientWebSocket socket, byte[] buffer, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close)
                return null;
            ms.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);

        return Encoding.UTF8.GetString(ms.ToArray());
    }

    static Uri BuildWebSocketUri(string httpUrl)
    {
        var uri = new Uri(httpUrl.TrimEnd('/') + "/");
        var scheme = uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws";
        return new UriBuilder(uri) { Scheme = scheme, Path = "/api/websocket" }.Uri;
    }
}
