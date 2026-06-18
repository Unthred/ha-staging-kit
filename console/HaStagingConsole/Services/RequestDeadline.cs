namespace HaStagingConsole.Services;

/// <summary>Endpoint-level timeouts to prevent hung requests from starving the thread pool.</summary>
static class RequestDeadline
{
    public static readonly TimeSpan SystemContainers = TimeSpan.FromSeconds(15);
    public static readonly TimeSpan OnboardingStatus = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan Diagnostics = TimeSpan.FromSeconds(25);
    public static readonly TimeSpan Dashboard = TimeSpan.FromSeconds(25);

    public static CancellationToken WithTimeout(CancellationToken ct, TimeSpan timeout, out CancellationTokenSource? linked)
    {
        linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(timeout);
        return linked.Token;
    }

    public static bool IsTimeout(CancellationToken requestCt, CancellationToken endpointCt) =>
        !requestCt.IsCancellationRequested && endpointCt.IsCancellationRequested;
}
