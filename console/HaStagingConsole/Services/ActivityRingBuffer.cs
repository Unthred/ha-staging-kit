using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class ActivityRingBuffer(int capacity)
{
    readonly object _lock = new();
    readonly List<ActivityEvent> _items = new(capacity);

    public int Count
    {
        get { lock (_lock) return _items.Count; }
    }

    public IReadOnlyList<ActivityEvent> Snapshot()
    {
        lock (_lock)
            return _items.ToList();
    }

    public ActivityEvent Add(ActivityEvent item)
    {
        lock (_lock)
        {
            _items.Add(item);
            if (_items.Count > capacity)
                _items.RemoveRange(0, _items.Count - capacity);
            return item;
        }
    }
}
