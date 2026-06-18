namespace HaStagingConsole.Services;

/// <summary>
/// Tracks process age so heavy probes (Docker, sidecar bash) can defer until after Kestrel is serving.
/// </summary>
public sealed class StartupGuard
{
    public DateTimeOffset StartedAt { get; } = DateTimeOffset.UtcNow;

    public static TimeSpan WarmupDuration { get; } = TimeSpan.FromSeconds(25);

    public bool IsWarmingUp => DateTimeOffset.UtcNow - StartedAt < WarmupDuration;
}
