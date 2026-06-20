using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace HaStagingConsole.Services;

/// <summary>One-shot Home Assistant WebSocket request/response helper.</summary>
public sealed class HaWebSocketClient(ILogger<HaWebSocketClient> logger)
{
    public async Task<JsonElement?> RequestAsync(
        string url,
        string token,
        string type,
        object? payload,
        CancellationToken ct)
    {
        using var socket = new ClientWebSocket();
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);
        await socket.ConnectAsync(BuildWebSocketUri(url), ct);

        var buffer = new byte[64 * 1024];
        if (!await AuthenticateAsync(socket, buffer, token, ct))
            return null;

        var msgId = 1;
        var body = new Dictionary<string, object?> { ["id"] = msgId, ["type"] = type };
        if (payload is IDictionary<string, object?> dict)
        {
            foreach (var kv in dict)
                body[kv.Key] = kv.Value;
        }
        else if (payload is not null)
        {
            foreach (var prop in payload.GetType().GetProperties())
                body[prop.Name] = prop.GetValue(payload);
        }

        await SendAsync(socket, JsonSerializer.Serialize(body), ct);
        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var json = await ReceiveTextAsync(socket, buffer, ct);
            if (json is null)
                return null;

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var msgType = root.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : null;
            if (msgType == "result" && root.TryGetProperty("id", out var idProp) && idProp.GetInt32() == msgId)
            {
                if (root.TryGetProperty("success", out var okProp) && okProp.GetBoolean()
                    && root.TryGetProperty("result", out var resultProp))
                {
                    return resultProp.Clone();
                }

                return null;
            }
        }

        return null;
    }

    static async Task<bool> AuthenticateAsync(ClientWebSocket socket, byte[] buffer, string token, CancellationToken ct)
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
                    return false;
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
