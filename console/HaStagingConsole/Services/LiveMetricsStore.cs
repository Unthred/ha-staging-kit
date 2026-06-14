using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class LiveMetricsStore
{
    private readonly object _lock = new();
    private readonly List<ReachabilityHistoryPoint> _reachability = [];
    private readonly List<BridgeStatePoint> _bridge = [];
    private const int MaxPoints = 24;

    public void RecordReachability(int? prodLatencyMs, bool prodReachable, int? stagingLatencyMs, bool stagingReachable)
    {
        lock (_lock)
        {
            _reachability.Add(new ReachabilityHistoryPoint(
                DateTimeOffset.Now,
                prodLatencyMs,
                prodReachable,
                stagingLatencyMs,
                stagingReachable));
            Trim(_reachability);
        }
    }

    public void RecordBridge(bool connected)
    {
        lock (_lock)
        {
            _bridge.Add(new BridgeStatePoint(DateTimeOffset.Now, connected));
            Trim(_bridge);
        }
    }

    public IReadOnlyList<ReachabilityHistoryPoint> GetReachabilityHistory()
    {
        lock (_lock)
            return _reachability.ToList();
    }

    public IReadOnlyList<BridgeStatePoint> GetBridgeHistory()
    {
        lock (_lock)
            return _bridge.ToList();
    }

    static void Trim<T>(List<T> list)
    {
        while (list.Count > MaxPoints)
            list.RemoveAt(0);
    }
}
