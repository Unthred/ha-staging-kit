using HaStagingConsole.Hubs;
using HaStagingConsole.Models;
using Microsoft.AspNetCore.SignalR;

namespace HaStagingConsole.Services;

public sealed class ActivityStreamService : IAsyncDisposable
{
    const int BufferCapacity = 500;
    static readonly TimeSpan ParityWindow = TimeSpan.FromSeconds(60);

    readonly KitPaths _paths;
    readonly OnboardingBootstrap _bootstrap;
    readonly IHubContext<ActivityHub> _hub;
    readonly ILoggerFactory _loggerFactory;
    readonly ILogger<ActivityStreamService> _logger;

    readonly ActivityRingBuffer _prodBuffer = new(BufferCapacity);
    readonly ActivityRingBuffer _stagingBuffer = new(BufferCapacity);
    readonly object _streamLock = new();

    HaLogbookWebSocketClient? _prodClient;
    HaLogbookWebSocketClient? _stagingClient;
    CancellationTokenSource? _streamCts;
    int _subscriberCount;

    public ActivityStreamService(
        KitPaths paths,
        OnboardingBootstrap bootstrap,
        IHubContext<ActivityHub> hub,
        ILoggerFactory loggerFactory,
        ILogger<ActivityStreamService> logger)
    {
        _paths = paths;
        _bootstrap = bootstrap;
        _hub = hub;
        _loggerFactory = loggerFactory;
        _logger = logger;
    }

    public ActivitySnapshot GetSnapshot()
    {
        var events = MergeEventsWithParity(_prodBuffer.Snapshot(), _stagingBuffer.Snapshot());
        return new ActivitySnapshot(events, GetStatuses(), DateTimeOffset.UtcNow);
    }

    public async Task SubscriberConnectedAsync()
    {
        var count = Interlocked.Increment(ref _subscriberCount);
        if (count == 1)
            await EnsureStreamsRunningAsync().ConfigureAwait(false);
    }

    public async Task SubscriberDisconnectedAsync()
    {
        var count = Interlocked.Decrement(ref _subscriberCount);
        if (count <= 0)
        {
            Interlocked.Exchange(ref _subscriberCount, 0);
            await StopStreamsAsync().ConfigureAwait(false);
        }
    }

    async Task EnsureStreamsRunningAsync()
    {
        lock (_streamLock)
        {
            if (_streamCts is not null)
                return;
            _streamCts = new CancellationTokenSource();
        }

        var ct = _streamCts.Token;
        _prodClient = CreateClient("Production HA", _paths.ProdTokenFile, isStaging: false);
        _stagingClient = CreateClient("Staging HA", _paths.StagingTokenFile, isStaging: true);

        _prodClient.EventReceived += OnProdEvent;
        _stagingClient.EventReceived += OnStagingEvent;
        _prodClient.StatusChanged += OnStatusChanged;
        _stagingClient.StatusChanged += OnStatusChanged;

        _prodClient.Start(ct);
        _stagingClient.Start(ct);

        await BroadcastStatusAsync().ConfigureAwait(false);
        _logger.LogInformation("Activity streams started (prod + staging)");
    }

    HaLogbookWebSocketClient CreateClient(string instance, string tokenFile, bool isStaging)
    {
        return new HaLogbookWebSocketClient(
            instance,
            () =>
            {
                var env = EnvFile.Read(_paths.EnvFile);
                var state = _bootstrap.LoadOrBootstrap();
                var (tokenUrl, token) = TokenFile.Read(tokenFile);
                var url = isStaging
                    ? FirstNonEmpty(env.GetValueOrDefault("STAGING_HA_URL"), state.Staging.Url, tokenUrl)
                    : FirstNonEmpty(env.GetValueOrDefault("PROD_HA_URL"), state.Prod.Url, tokenUrl);
                return (url ?? "", token);
            },
            _loggerFactory.CreateLogger<HaLogbookWebSocketClient>());
    }

    async Task StopStreamsAsync()
    {
        HaLogbookWebSocketClient? prod;
        HaLogbookWebSocketClient? staging;
        CancellationTokenSource? cts;

        lock (_streamLock)
        {
            prod = _prodClient;
            staging = _stagingClient;
            cts = _streamCts;
            _prodClient = null;
            _stagingClient = null;
            _streamCts = null;
        }

        if (prod is not null)
        {
            prod.EventReceived -= OnProdEvent;
            prod.StatusChanged -= OnStatusChanged;
            await prod.StopAsync().ConfigureAwait(false);
            await prod.DisposeAsync().ConfigureAwait(false);
        }

        if (staging is not null)
        {
            staging.EventReceived -= OnStagingEvent;
            staging.StatusChanged -= OnStatusChanged;
            await staging.StopAsync().ConfigureAwait(false);
            await staging.DisposeAsync().ConfigureAwait(false);
        }

        cts?.Cancel();
        cts?.Dispose();
        _logger.LogInformation("Activity streams stopped (no subscribers)");
    }

    void OnProdEvent(object? sender, ActivityEvent evt) => _ = PublishEventAsync(_prodBuffer, _stagingBuffer, evt);

    void OnStagingEvent(object? sender, ActivityEvent evt) => _ = PublishEventAsync(_stagingBuffer, _prodBuffer, evt);

    async Task PublishEventAsync(ActivityRingBuffer ownBuffer, ActivityRingBuffer otherBuffer, ActivityEvent evt)
    {
        var parity = HasParityMatch(otherBuffer.Snapshot(), evt);
        var stored = ownBuffer.Add(evt with { ParityMatch = parity });
        await _hub.Clients.Group(ActivityHub.GroupName).SendAsync("event", stored).ConfigureAwait(false);
    }

    async void OnStatusChanged(object? sender, ActivityInstanceStatus status) =>
        await BroadcastStatusAsync().ConfigureAwait(false);

    async Task BroadcastStatusAsync()
    {
        var statuses = GetStatuses();
        await _hub.Clients.Group(ActivityHub.GroupName).SendAsync("status", statuses).ConfigureAwait(false);
    }

    IReadOnlyList<ActivityInstanceStatus> GetStatuses()
    {
        return
        [
            ClientStatus(_prodClient, "Production HA"),
            ClientStatus(_stagingClient, "Staging HA")
        ];
    }

    static ActivityInstanceStatus ClientStatus(HaLogbookWebSocketClient? client, string instance) =>
        client is null
            ? new ActivityInstanceStatus(instance, "idle", "Waiting for subscriber")
            : new ActivityInstanceStatus(instance, StateLabel(client.State), client.State switch
            {
                ActivityStreamState.AuthFailed => "API token rejected — check Settings",
                ActivityStreamState.Error => "Stream error",
                ActivityStreamState.Disconnected => "Reconnecting",
                _ => null
            });

    static string StateLabel(ActivityStreamState state) => state switch
    {
        ActivityStreamState.Connected => "connected",
        ActivityStreamState.Connecting => "connecting",
        ActivityStreamState.AuthFailed => "auth_failed",
        ActivityStreamState.Error => "error",
        ActivityStreamState.Disconnected => "disconnected",
        _ => "idle"
    };

    static IReadOnlyList<ActivityEvent> MergeEventsWithParity(
        IReadOnlyList<ActivityEvent> prod,
        IReadOnlyList<ActivityEvent> staging)
    {
        var merged = prod.Concat(staging)
            .OrderByDescending(e => e.At)
            .Take(BufferCapacity * 2)
            .ToList();

        return merged
            .Select(evt => evt with { ParityMatch = evt.ParityMatch || HasParityMatch(merged, evt) })
            .ToList();
    }

    static bool HasParityMatch(IReadOnlyList<ActivityEvent> candidates, ActivityEvent evt)
    {
        foreach (var other in candidates)
        {
            if (other.Id == evt.Id)
                continue;
            if (!string.Equals(other.EntityId, evt.EntityId, StringComparison.OrdinalIgnoreCase))
                continue;
            if (string.Equals(other.Instance, evt.Instance, StringComparison.Ordinal))
                continue;
            if (Math.Abs((other.At - evt.At).TotalSeconds) <= ParityWindow.TotalSeconds)
                return true;
        }

        return false;
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

    public async ValueTask DisposeAsync() => await StopStreamsAsync().ConfigureAwait(false);
}
