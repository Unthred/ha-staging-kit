using HaStagingConsole.Services;
using Microsoft.AspNetCore.SignalR;

namespace HaStagingConsole.Hubs;

public sealed class ActivityHub(ActivityStreamService activityStream) : Hub
{
    public const string GroupName = "activity";

    public override async Task OnConnectedAsync()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName).ConfigureAwait(false);
        await activityStream.SubscriberConnectedAsync().ConfigureAwait(false);
        await Clients.Caller.SendAsync("snapshot", activityStream.GetSnapshot()).ConfigureAwait(false);
        await base.OnConnectedAsync().ConfigureAwait(false);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await activityStream.SubscriberDisconnectedAsync().ConfigureAwait(false);
        await base.OnDisconnectedAsync(exception).ConfigureAwait(false);
    }
}
