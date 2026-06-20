namespace HaStagingConsole.Services;

public sealed record PreflightProgressSnapshot(
    bool Active,
    int Step,
    int TotalSteps,
    string Label,
    DateTimeOffset StartedAt);

/// <summary>Thread-safe scan progress for the entity deploy preflight panel.</summary>
public static class PreflightProgressStore
{
    static readonly object Gate = new();
    static PreflightProgressSnapshot? Current;
    static int ScanGeneration;
    static int OwnerGeneration;

    public static IDisposable BeginScan(int totalSteps, string initialLabel = "Starting Entity Janitor scan…")
    {
        lock (Gate)
        {
            if (Current is { Active: true })
                return NoOpHandle.Instance;

            var generation = Interlocked.Increment(ref ScanGeneration);
            OwnerGeneration = generation;
            Current = new PreflightProgressSnapshot(
                true,
                0,
                Math.Max(1, totalSteps),
                initialLabel,
                DateTimeOffset.UtcNow);
            return new ScanHandle(generation);
        }
    }

    public static void SetTotalSteps(int totalSteps)
    {
        lock (Gate)
        {
            if (Current is null || !Current.Active)
                return;

            Current = Current with { TotalSteps = Math.Max(Math.Max(totalSteps, Current.Step), 1) };
        }
    }

    public static void Advance(string label)
    {
        lock (Gate)
        {
            if (Current is null || !Current.Active)
                return;

            var step = Math.Min(Current.Step + 1, Current.TotalSteps);
            Current = Current with { Step = step, Label = label };
        }
    }

    public static void Complete(string label = "Scan complete")
    {
        lock (Gate)
        {
            if (Current is null || !Current.Active)
                return;

            Current = Current with { Step = Current.TotalSteps, Label = label };
        }
    }

    public static PreflightProgressSnapshot? Get()
    {
        lock (Gate)
            return Current;
    }

    sealed class ScanHandle(int generation) : IDisposable
    {
        public void Dispose()
        {
            lock (Gate)
            {
                if (OwnerGeneration == generation)
                    Current = null;
            }
        }
    }

    sealed class NoOpHandle : IDisposable
    {
        public static readonly NoOpHandle Instance = new();

        public void Dispose() { }
    }
}
