namespace HaStagingConsole.Models;

public sealed record ActivityEvent(
    string Id,
    string Instance,
    DateTimeOffset At,
    string EntityId,
    string Domain,
    string Name,
    string Message,
    bool ParityMatch = false);

public sealed record ActivityInstanceStatus(
    string Instance,
    string State,
    string? Detail = null);

public sealed record ActivitySnapshot(
    IReadOnlyList<ActivityEvent> Events,
    IReadOnlyList<ActivityInstanceStatus> Statuses,
    DateTimeOffset RefreshedAt);

public sealed record ActivityEntitySuggestion(
    string EntityId,
    string Name,
    string Domain,
    IReadOnlyList<string> Instances);

public sealed record ActivitySuggestionsSnapshot(
    IReadOnlyList<ActivityEntitySuggestion> Items,
    int AutomationCount,
    int ScriptCount,
    bool ProdAvailable,
    bool StagingAvailable,
    DateTimeOffset RefreshedAt);

public enum ActivityStreamState
{
    Idle,
    Connecting,
    Connected,
    AuthFailed,
    Error,
    Disconnected
}
