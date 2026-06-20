using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class HaLogbookWebSocketClient : IAsyncDisposable
{
    static readonly TimeSpan HistoryWindow = TimeSpan.FromMinutes(15);
    static readonly TimeSpan[] ReconnectDelays =
    [
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(4),
        TimeSpan.FromSeconds(8),
        TimeSpan.FromSeconds(15),
        TimeSpan.FromSeconds(30),
    ];

    readonly string _instance;
    readonly Func<(string Url, string Token)> _credentials;
    readonly ILogger<HaLogbookWebSocketClient> _logger;

    CancellationTokenSource? _runCts;
    Task? _runTask;
    int _messageId;
    ActivityStreamState _state = ActivityStreamState.Idle;
    string? _stateDetail;

    void SetState(ActivityStreamState value, string? detail = null)
    {
        if (_state == value && string.Equals(_stateDetail, detail, StringComparison.Ordinal))
            return;
        _state = value;
        _stateDetail = detail;
        StatusChanged?.Invoke(this, new ActivityInstanceStatus(_instance, StateLabel(value), detail));
    }

    public ActivityStreamState State => _state;
    public string Instance => _instance;
    public event EventHandler<ActivityEvent>? EventReceived;
    public event EventHandler<ActivityInstanceStatus>? StatusChanged;

    public HaLogbookWebSocketClient(
        string instance,
        Func<(string Url, string Token)> credentials,
        ILogger<HaLogbookWebSocketClient> logger)
    {
        _instance = instance;
        _credentials = credentials;
        _logger = logger;
    }

    public void Start(CancellationToken parentCt)
    {
        if (_runTask is { IsCompleted: false })
            return;

        _runCts = CancellationTokenSource.CreateLinkedTokenSource(parentCt);
        _runTask = Task.Run(() => RunLoopAsync(_runCts.Token), CancellationToken.None);
    }

    public async Task StopAsync()
    {
        if (_runCts is null)
            return;

        _runCts.Cancel();
        try
        {
            if (_runTask is not null)
                await _runTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            /* expected */
        }
        finally
        {
            _runCts.Dispose();
            _runCts = null;
            _runTask = null;
            SetState(ActivityStreamState.Idle);
        }
    }

    async Task RunLoopAsync(CancellationToken ct)
    {
        var attempt = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ConnectOnceAsync(ct).ConfigureAwait(false);
                attempt = 0;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "{Instance} logbook stream error", _instance);
                SetState(ActivityStreamState.Error, ex.Message);
            }

            if (ct.IsCancellationRequested)
                break;

            var delay = ReconnectDelays[Math.Min(attempt, ReconnectDelays.Length - 1)];
            attempt++;
            SetState(ActivityStreamState.Disconnected, $"Reconnecting in {(int)delay.TotalSeconds}s");
            try
            {
                await Task.Delay(delay, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
        }

        SetState(ActivityStreamState.Idle);
    }

    async Task ConnectOnceAsync(CancellationToken ct)
    {
        var (url, token) = _credentials();
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
        {
            SetState(ActivityStreamState.Error, "URL or API token not configured");
            await Task.Delay(TimeSpan.FromSeconds(30), ct).ConfigureAwait(false);
            return;
        }

        SetState(ActivityStreamState.Connecting);

        using var socket = new ClientWebSocket();
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);
        var wsUri = BuildWebSocketUri(url);

        await socket.ConnectAsync(wsUri, ct).ConfigureAwait(false);

        var buffer = new byte[64 * 1024];
        var authenticated = false;
        var subscribed = false;

        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            using var ms = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, ct).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).ConfigureAwait(false);
                    return;
                }

                ms.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            var text = Encoding.UTF8.GetString(ms.ToArray());
            foreach (var line in text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (!TryHandleMessage(line, token, ref authenticated, ref subscribed, async msg =>
                    {
                        if (socket.State != WebSocketState.Open)
                            return;
                        var payload = Encoding.UTF8.GetBytes(msg);
                        await socket.SendAsync(payload, WebSocketMessageType.Text, true, ct).ConfigureAwait(false);
                    }))
                {
                    _logger.LogDebug("{Instance} unhandled WS: {Line}", _instance, line.Length > 200 ? line[..200] : line);
                }
            }
        }
    }

    bool TryHandleMessage(
        string json,
        string token,
        ref bool authenticated,
        ref bool subscribed,
        Func<string, Task> sendAsync)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var type = root.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : null;

        switch (type)
        {
            case "auth_required":
                _ = sendAsync(JsonSerializer.Serialize(new { type = "auth", access_token = token }));
                return true;

            case "auth_ok":
                authenticated = true;
                SetState(ActivityStreamState.Connected);
                if (!subscribed)
                {
                    subscribed = true;
                    var start = DateTimeOffset.UtcNow.Subtract(HistoryWindow)
                        .ToString("yyyy-MM-dd'T'HH:mm:ss'+00:00'");
                    var id = Interlocked.Increment(ref _messageId);
                    _ = sendAsync(JsonSerializer.Serialize(new
                    {
                        id,
                        type = "logbook/event_stream",
                        start_time = start
                    }));
                }
                return true;

            case "auth_invalid":
                SetState(ActivityStreamState.AuthFailed, "API token rejected");
                return true;

            case "result":
                if (root.TryGetProperty("success", out var okProp) && okProp.ValueKind == JsonValueKind.False)
                {
                    SetState(ActivityStreamState.Error, root.TryGetProperty("error", out var err) ? err.GetRawText() : "Subscription failed");
                }
                return true;

            case "event":
                if (root.TryGetProperty("event", out var eventContainer)
                    && eventContainer.TryGetProperty("events", out var eventsArray)
                    && eventsArray.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in eventsArray.EnumerateArray())
                    {
                        if (TryParseLogbookEvent(item, out var batchEvt))
                            EventReceived?.Invoke(this, batchEvt);
                    }

                    return true;
                }

                if (TryParseLogbookEvent(root, out var evt))
                    EventReceived?.Invoke(this, evt);
                return true;
        }

        if (TryParseLogbookEvent(root, out var direct))
        {
            EventReceived?.Invoke(this, direct);
            return true;
        }

        return type is not null;
    }

    bool TryParseLogbookEvent(JsonElement root, out ActivityEvent activityEvent)
    {
        activityEvent = null!;
        var payload = root;
        if (root.TryGetProperty("event", out var eventProp)
            && eventProp.ValueKind == JsonValueKind.Object
            && !eventProp.TryGetProperty("events", out _))
        {
            payload = eventProp;
        }

        if (payload.TryGetProperty("data", out var dataProp) && dataProp.ValueKind == JsonValueKind.Object)
            payload = dataProp;

        if (!TryClassifyLogbookEntry(payload, out var entityId, out var domain, out var name, out var message))
            return false;

        if (!TryParseWhen(payload, out var when))
            when = DateTimeOffset.UtcNow;

        activityEvent = new ActivityEvent(
            Id: $"{_instance}:{entityId}:{when.ToUnixTimeMilliseconds()}:{message.GetHashCode(StringComparison.Ordinal)}",
            Instance: _instance,
            At: when,
            EntityId: entityId,
            Domain: domain,
            Name: name,
            Message: message);

        return true;
    }

    static bool TryClassifyLogbookEntry(
        JsonElement payload,
        out string entityId,
        out string domain,
        out string name,
        out string message)
    {
        entityId = GetString(payload, "entity_id") ?? "";
        var declaredDomain = GetString(payload, "domain");
        var contextDomain = GetString(payload, "context_domain");
        message = GetString(payload, "message") ?? "";
        name = GetString(payload, "name") ?? entityId;

        if (entityId.StartsWith("automation.", StringComparison.OrdinalIgnoreCase)
            || entityId.StartsWith("script.", StringComparison.OrdinalIgnoreCase))
        {
            domain = entityId.Split('.', 2)[0];
            if (string.IsNullOrWhiteSpace(message))
                message = name;
            return true;
        }

        if (string.Equals(declaredDomain, "automation", StringComparison.OrdinalIgnoreCase)
            || string.Equals(declaredDomain, "script", StringComparison.OrdinalIgnoreCase))
        {
            domain = declaredDomain!.ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(entityId) || !entityId.StartsWith($"{domain}.", StringComparison.OrdinalIgnoreCase))
                entityId = $"{domain}.{Slugify(name)}";
            if (string.IsNullOrWhiteSpace(message))
                message = "triggered";
            return true;
        }

        if (string.Equals(contextDomain, "notify", StringComparison.OrdinalIgnoreCase)
            || string.Equals(message, "Reminder sent", StringComparison.OrdinalIgnoreCase)
            || string.Equals(message, "No answer time out", StringComparison.OrdinalIgnoreCase))
        {
            domain = "notify";
            if (string.IsNullOrWhiteSpace(entityId))
                entityId = $"notify.{Slugify(name)}";
            if (string.IsNullOrWhiteSpace(message))
                message = "Notification sent";
            return true;
        }

        domain = "";
        return false;
    }

    static bool TryParseWhen(JsonElement payload, out DateTimeOffset when)
    {
        if (!payload.TryGetProperty("when", out var whenProp))
        {
            when = default;
            return false;
        }

        switch (whenProp.ValueKind)
        {
            case JsonValueKind.Number:
                when = DateTimeOffset.FromUnixTimeMilliseconds((long)(whenProp.GetDouble() * 1000));
                return true;
            case JsonValueKind.String:
                return DateTimeOffset.TryParse(whenProp.GetString(), out when);
            default:
                when = default;
                return false;
        }
    }

    static string Slugify(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "unknown";

        var buffer = new char[value.Length];
        var length = 0;
        var previousUnderscore = false;
        foreach (var ch in value.ToLowerInvariant())
        {
            if (char.IsAsciiLetterOrDigit(ch))
            {
                buffer[length++] = ch;
                previousUnderscore = false;
                continue;
            }

            if (length > 0 && !previousUnderscore)
            {
                buffer[length++] = '_';
                previousUnderscore = true;
            }
        }

        while (length > 0 && buffer[length - 1] == '_')
            length--;

        return length == 0 ? "unknown" : new string(buffer, 0, length);
    }

    static string? GetString(JsonElement el, string name) =>
        el.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    static Uri BuildWebSocketUri(string httpUrl)
    {
        var uri = new Uri(httpUrl.TrimEnd('/'));
        var scheme = uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws";
        var builder = new UriBuilder(uri) { Scheme = scheme, Path = "/api/websocket" };
        if (uri.IsDefaultPort)
            builder.Port = scheme == "wss" ? 443 : 80;
        return builder.Uri;
    }

    static string StateLabel(ActivityStreamState state) => state switch
    {
        ActivityStreamState.Idle => "idle",
        ActivityStreamState.Connecting => "connecting",
        ActivityStreamState.Connected => "connected",
        ActivityStreamState.AuthFailed => "auth_failed",
        ActivityStreamState.Error => "error",
        ActivityStreamState.Disconnected => "disconnected",
        _ => "unknown"
    };

    public async ValueTask DisposeAsync() => await StopAsync().ConfigureAwait(false);
}
