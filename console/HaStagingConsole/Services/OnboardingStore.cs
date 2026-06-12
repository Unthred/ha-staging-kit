using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

public sealed class OnboardingStore(KitPaths paths, ILogger<OnboardingStore> logger)
{
    static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    readonly object _lock = new();

    public OnboardingState Load()
    {
        lock (_lock)
        {
            if (!File.Exists(paths.OnboardingFile))
                return new OnboardingState();

            try
            {
                var json = File.ReadAllText(paths.OnboardingFile);
                return JsonSerializer.Deserialize<OnboardingState>(json, JsonOptions) ?? new OnboardingState();
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to read onboarding state; starting fresh");
                return new OnboardingState();
            }
        }
    }

    public void Save(OnboardingState state)
    {
        lock (_lock)
        {
            Directory.CreateDirectory(paths.SidecarData);
            var json = JsonSerializer.Serialize(state, JsonOptions);
            File.WriteAllText(paths.OnboardingFile, json);
        }
    }

    public OnboardingStatus ToStatus(OnboardingState state)
    {
        RefreshSecretFlags(state);
        return new OnboardingStatus(
            state.CurrentStep,
            state.CompletedSteps,
            state.IsComplete,
            state.Topology,
            state.Paths,
            state.Prod with { HasToken = File.Exists(paths.ProdTokenFile), HasSshKey = File.Exists(paths.SshKeyFile) },
            state.Staging with { HasToken = File.Exists(paths.StagingTokenFile) },
            state.Mirror,
            state.HaMqttConfirmed,
            state.LastHealthChecks);
    }

    void RefreshSecretFlags(OnboardingState state)
    {
        state.Prod = state.Prod with
        {
            HasToken = File.Exists(paths.ProdTokenFile),
            HasSshKey = File.Exists(paths.SshKeyFile)
        };
        state.Staging = state.Staging with { HasToken = File.Exists(paths.StagingTokenFile) };
    }

    public void MarkStep(OnboardingState state, string stepId, int nextStep)
    {
        if (!state.CompletedSteps.Contains(stepId))
            state.CompletedSteps.Add(stepId);
        state.CurrentStep = nextStep;
        Save(state);
    }
}
