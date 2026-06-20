using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

/// <summary>
/// Gates legacy kit SSH operations that write prod HA (deploy, registry fix, rollback).
/// Default off until release agent + reviewed migrations are ready.
/// </summary>
public sealed class ProdWritesGuard(OnboardingStore store)
{
    public const string LockMessage =
        "Prod writes are locked while the release architecture is being built. "
        + "Use staging and git review only. To allow legacy kit SSH deploy/fix on prod, enable "
        + "Settings → Release safety (not recommended until the release agent applies approved migrations).";

    public bool IsEnabled => store.Load().ProdWritesEnabled;

    public ReleaseSafetyView GetView() =>
        new(IsEnabled, IsEnabled ? null : LockMessage);

    public OperationResult? BlockIfLocked(string operationName)
    {
        if (IsEnabled)
            return null;

        return new OperationResult(
            false,
            LockMessage,
            $"Blocked: {operationName}");
    }
}
