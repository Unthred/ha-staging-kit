using System.Collections.Concurrent;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OperationLogService
{
    const int MaxEntries = 50;
    readonly ConcurrentQueue<OperationLogEntry> _queue = new();

    public void Record(string operation, OperationResult result)
    {
        _queue.Enqueue(new OperationLogEntry(
            operation,
            result.Ok,
            result.Message,
            result.LogTail,
            DateTimeOffset.Now));

        while (_queue.Count > MaxEntries)
            _queue.TryDequeue(out _);
    }

    public IReadOnlyList<OperationLogEntry> GetRecent() =>
        _queue.Reverse().ToList();
}
