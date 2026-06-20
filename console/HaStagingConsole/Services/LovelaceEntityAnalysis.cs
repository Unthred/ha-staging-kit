using System.Text.Json;
using HaStagingConsole.Models;

namespace HaStagingConsole.Services;

enum LovelaceParitySource
{
    GitRef,
    WorkingTree,
}

static class LovelaceEntityAnalysis
{
    public static Dictionary<string, List<LovelaceEntityReference>> CollectReferences(
        IReadOnlyDictionary<string, JsonDocument> lovelaceFiles)
    {
        var refs = new Dictionary<string, List<LovelaceEntityReference>>(StringComparer.Ordinal);
        foreach (var (source, doc) in lovelaceFiles)
        {
            WalkFile(source, doc.RootElement, refs);
        }

        return refs;
    }

    public static IReadOnlyList<LovelaceMissingEntityIssue> BuildMissingIssues(
        IEnumerable<string> missingEntityIds,
        IReadOnlyDictionary<string, List<LovelaceEntityReference>> references,
        IReadOnlySet<string> prodEntityIds,
        IReadOnlySet<string> stagingEntityIds,
        ProdRegistrySnapshot? prodRegistry)
    {
        var issues = new List<LovelaceMissingEntityIssue>();
        foreach (var entityId in missingEntityIds.Order(StringComparer.Ordinal))
        {
            references.TryGetValue(entityId, out var refs);
            refs ??= [];
            var onStaging = stagingEntityIds.Contains(entityId);
            var similar = FindSimilarEntityId(entityId, prodEntityIds);
            var prodEntry = ResolveProdEntry(similar, prodRegistry);
            var (kind, suggestion, suggested) = Suggest(entityId, onStaging, similar, refs, prodEntry);
            var issueClass = MapIssueClass(kind);
            var integrationHint = IntegrationFixHints.BuildIntegrationHint(prodEntry, entityId);
            var suffixCollision = TryDetectEntityIdSuffixCollision(entityId, similar, prodRegistry);
            var manualFix = suffixCollision is not null
                ? BuildSuffixCollisionManualFix(entityId, similar!, suffixCollision, prodEntry)
                : IntegrationFixHints.Build(
                    issueClass,
                    entityId,
                    similar,
                    prodEntry,
                    prodRegistry);
            var prodContext = BuildProdContext(
                entityId,
                similar,
                prodEntry,
                integrationHint,
                prodRegistry,
                suffixCollision);

            issues.Add(new LovelaceMissingEntityIssue(
                entityId,
                onStaging,
                kind,
                issueClass,
                suggestion,
                manualFix,
                suggested,
                prodContext,
                refs.Take(12).ToList(),
                BuildFixOptions(kind, entityId, suggested),
                BuildEntityChoices(kind, entityId, suggested)));
        }

        return issues;
    }

    static string MapIssueClass(string kind) =>
        kind switch
        {
            "prod_typo" => "prod_typo",
            "rename" => "git_wrong_name",
            "remove" => "staging_only",
            _ => "missing_on_prod",
        };

    static ProdEntityRegistryEntry? ResolveProdEntry(string? similar, ProdRegistrySnapshot? prodRegistry)
    {
        if (string.IsNullOrWhiteSpace(similar) || prodRegistry is null)
            return null;

        return prodRegistry.ActiveEntities.TryGetValue(similar, out var entry) ? entry : null;
    }

    static ProdEntityContext? BuildProdContext(
        string gitEntityId,
        string? similarProdEntity,
        ProdEntityRegistryEntry? prodEntry,
        string integrationHint,
        ProdRegistrySnapshot? prodRegistry,
        ProdEntityRegistryEntry? suffixCollisionBlocker = null)
    {
        if (prodEntry is null
            && string.IsNullOrWhiteSpace(similarProdEntity)
            && prodRegistry?.DeletedEntityIds.Contains(gitEntityId) != true
            && suffixCollisionBlocker is null)
        {
            return null;
        }

        string? deviceName = null;
        if (prodEntry?.DeviceId is not null
            && prodRegistry?.DeviceNames.TryGetValue(prodEntry.DeviceId, out var name) == true)
        {
            deviceName = name;
        }

        var tombstones = ProdRegistryReader.FindRelatedDeletedEntries(gitEntityId, prodRegistry);
        var tombstonePrefix = ProdRegistryReader.TombstoneDevicePrefix(gitEntityId, prodRegistry);
        var livePrefix = ProdRegistryReader.ExtractDeviceUniquePrefixPublic(prodEntry?.UniqueId);
        var prodFixSteps = suffixCollisionBlocker is not null && !string.IsNullOrWhiteSpace(similarProdEntity)
            ? BuildSuffixCollisionProdFixSteps(gitEntityId, suffixCollisionBlocker, similarProdEntity, prodEntry)
            : RegistryUniqueIdMatchesExpected(gitEntityId, prodEntry) && !string.IsNullOrWhiteSpace(similarProdEntity)
                ? BuildRegistryRenameProdFixSteps(gitEntityId, similarProdEntity, prodEntry!)
                : null;
        var prodFixAction = suffixCollisionBlocker is not null && !string.IsNullOrWhiteSpace(similarProdEntity)
            ? "suffix-collision"
            : RegistryUniqueIdMatchesExpected(gitEntityId, prodEntry) && !string.IsNullOrWhiteSpace(similarProdEntity)
                ? "registry-rename"
                : null;

        return new ProdEntityContext(
            similarProdEntity,
            prodEntry?.Platform,
            deviceName,
            prodEntry?.UniqueId,
            integrationHint,
            prodRegistry?.DeletedEntityIds.Contains(gitEntityId) == true,
            tombstones.Select(t => t.EntityId).ToList(),
            tombstones,
            livePrefix,
            tombstonePrefix,
            !string.IsNullOrWhiteSpace(livePrefix)
                && !string.IsNullOrWhiteSpace(tombstonePrefix)
                && string.Equals(livePrefix, tombstonePrefix, StringComparison.OrdinalIgnoreCase),
            suffixCollisionBlocker?.EntityId,
            suffixCollisionBlocker?.Platform,
            suffixCollisionBlocker?.DisabledBy,
            prodFixSteps,
            prodFixAction);
    }

    static ProdEntityRegistryEntry? TryDetectEntityIdSuffixCollision(
        string expectedEntityId,
        string? similarProdEntity,
        ProdRegistrySnapshot? registry)
    {
        if (registry is null || string.IsNullOrWhiteSpace(similarProdEntity))
            return null;

        if (!similarProdEntity.StartsWith($"{expectedEntityId}_", StringComparison.Ordinal))
            return null;

        if (!registry.ActiveEntities.TryGetValue(expectedEntityId, out var blocker))
            return null;

        if (string.Equals(blocker.EntityId, similarProdEntity, StringComparison.Ordinal))
            return null;

        return blocker;
    }

    static string BuildSuffixCollisionManualFix(
        string expectedEntityId,
        string suffixProdEntity,
        ProdEntityRegistryEntry blocker,
        ProdEntityRegistryEntry? liveProdEntry)
    {
        var blockerLabel = string.IsNullOrWhiteSpace(blocker.Platform)
            ? blocker.EntityId
            : $"{blocker.EntityId} ({blocker.Platform}"
              + (string.IsNullOrWhiteSpace(blocker.DisabledBy) ? ")" : $", {blocker.DisabledBy})");
        var liveLabel = string.IsNullOrWhiteSpace(liveProdEntry?.Platform)
            ? suffixProdEntity
            : $"{suffixProdEntity} ({liveProdEntry.Platform})";

        return
            $"Prod uses `{suffixProdEntity}` because `{expectedEntityId}` is already taken by {blockerLabel}. "
            + $"The kit cannot rename prod entities — fix on prod before deploy, then Recheck. "
            + $"Proper fix: delete {blockerLabel}, rename {liveLabel} → `{expectedEntityId}`. "
            + $"Shortcut (dashboard only): Rename below to `{suffixProdEntity}` without touching prod.";
    }

    static IReadOnlyList<string> BuildRegistryRenameProdFixSteps(
        string expectedEntityId,
        string wrongProdEntityId,
        ProdEntityRegistryEntry prodEntry)
    {
        var platform = prodEntry.Platform?.Trim().ToLowerInvariant() ?? "entity";
        var uiNote = platform switch
        {
            "timer" => "Timer entities cannot be renamed in the HA UI — use the kit action below.",
            _ => "Settings → Entities may not offer rename for this entity — use the kit action below if needed.",
        };

        return
        [
            "Click **Fix entity id on prod** below (stops prod HA briefly, edits core.entity_registry, restarts).",
            uiNote,
            $"Registry rename: `{wrongProdEntityId}` → `{expectedEntityId}` (unique_id `{prodEntry.UniqueId}` unchanged).",
            "Click Recheck in Entity Janitor — the blocker should clear once prod matches.",
            "Publish and deploy the dashboard bundle from the ship wizard.",
        ];
    }

    static IReadOnlyList<string> BuildSuffixCollisionProdFixSteps(
        string expectedEntityId,
        ProdEntityRegistryEntry blocker,
        string suffixProdEntity,
        ProdEntityRegistryEntry? liveProdEntry)
    {
        var blockerNote = string.IsNullOrWhiteSpace(blocker.Platform)
            ? expectedEntityId
            : $"{expectedEntityId} ({blocker.Platform}"
              + (string.IsNullOrWhiteSpace(blocker.DisabledBy) ? ")" : $", {blocker.DisabledBy})");
        var liveNote = string.IsNullOrWhiteSpace(liveProdEntry?.Platform)
            ? suffixProdEntity
            : $"{suffixProdEntity} ({liveProdEntry.Platform})";

        return
        [
            "Click Fix entity id on prod below (stops prod HA briefly, edits entity registry, restarts).",
            $"Or manually: delete {blockerNote} in Settings → Entities.",
            $"Then rename {liveNote} → `{expectedEntityId}` on prod.",
            "Search prod automations/scripts for the old `_2` id and update references if needed.",
            "Click Recheck in Entity Janitor — the blocker should clear once prod matches.",
            "Publish and deploy the dashboard bundle from the ship wizard.",
        ];
    }

    public static IReadOnlyList<LovelaceEntityChoice>? BuildEntityChoices(
        string kind,
        string entityId,
        string? suggestedProdEntity)
    {
        if (string.IsNullOrWhiteSpace(suggestedProdEntity)
            || string.Equals(suggestedProdEntity, entityId, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return kind switch
        {
            "rename" =>
            [
                new LovelaceEntityChoice(
                    entityId,
                    "dashboard",
                    "Dashboard",
                    "Current name on the dashboard.",
                    false),
                new LovelaceEntityChoice(
                    suggestedProdEntity,
                    "prod",
                    "Prod",
                    "What prod actually has — rename the dashboard to match.",
                    true),
            ],
            _ => null,
        };
    }

    public static IReadOnlyList<LovelaceFixOption> BuildFixOptions(
        string kind,
        string entityId,
        string? suggestedProdEntity)
    {
        var options = new List<LovelaceFixOption>();
        switch (kind)
        {
            case "prod_typo":
                options.Add(new LovelaceFixOption(
                    "defer",
                    "Defer for later",
                    "defer",
                    null,
                    "Exclude from Entity Janitor — cards may error on prod until you fix manually."));
                options.Add(new LovelaceFixOption(
                    "remove",
                    "Remove from dashboard",
                    "remove",
                    null,
                    "Delete every card reference to this entity from the dashboard bundle."));
                break;
            case "rename" when !string.IsNullOrWhiteSpace(suggestedProdEntity):
                options.Add(new LovelaceFixOption(
                    "rename-git",
                    "Rename",
                    "rename",
                    suggestedProdEntity,
                    "Update the dashboard to use the prod entity id."));
                options.Add(new LovelaceFixOption(
                    "defer",
                    "Defer for later",
                    "defer",
                    null,
                    "Exclude from Entity Janitor — cards may error on prod until fixed."));
                options.Add(new LovelaceFixOption(
                    "remove",
                    "Remove from dashboard",
                    "remove",
                    null,
                    "Delete every card reference to this entity from the dashboard bundle."));
                break;
            case "remove":
            case "add_on_prod":
            default:
                options.Add(new LovelaceFixOption(
                    "defer",
                    "Defer for later",
                    "defer",
                    null,
                    "Keep in the dashboard but don't block deploy. Cards may show errors on prod until you fix this."));
                options.Add(new LovelaceFixOption(
                    "remove",
                    "Remove from dashboard",
                    "remove",
                    null,
                    "Delete every card reference to this entity from the dashboard bundle."));
                break;
        }

        return options;
    }

    public static IReadOnlyList<LovelaceFixOption> BuildDeferredFixOptions() =>
    [
        new LovelaceFixOption(
            "undefer",
            "Restore to blocking",
            "undefer",
            null,
            "Move back to the blocking list — deploy won't proceed until this entity is resolved."),
        new LovelaceFixOption(
            "remove",
            "Remove from dashboard",
            "remove",
            null,
            "Delete every card reference to this entity from the dashboard bundle."),
    ];

    static void WalkFile(
        string source,
        JsonElement root,
        Dictionary<string, List<LovelaceEntityReference>> refs)
    {
        if (root.TryGetProperty("data", out var data))
        {
            if (data.TryGetProperty("config", out var config) && config.TryGetProperty("views", out var views))
            {
                WalkViews(source, null, views, refs);
            }

            if (data.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in items.EnumerateArray())
                {
                    var dashboard = ReadString(item, "title") ?? ReadString(item, "url_path");
                    if (item.TryGetProperty("config", out var dashConfig)
                        && dashConfig.TryGetProperty("views", out var dashViews))
                    {
                        WalkViews(source, dashboard, dashViews, refs);
                    }
                }
            }
        }
    }

    static void WalkViews(
        string source,
        string? dashboard,
        JsonElement views,
        Dictionary<string, List<LovelaceEntityReference>> refs)
    {
        if (views.ValueKind != JsonValueKind.Array)
            return;

        foreach (var view in views.EnumerateArray())
        {
            var viewTitle = ReadString(view, "title")
                ?? ReadString(view, "path")
                ?? ReadString(view, "icon")
                ?? "Untitled view";
            WalkNode(source, dashboard, viewTitle, view, refs);
        }
    }

    static void WalkNode(
        string source,
        string? dashboard,
        string viewTitle,
        JsonElement node,
        Dictionary<string, List<LovelaceEntityReference>> refs,
        string? cardType = null,
        string? cardTitle = null)
    {
        switch (node.ValueKind)
        {
            case JsonValueKind.Object:
                var type = ReadString(node, "type") ?? cardType;
                var title = ReadString(node, "title")
                    ?? ReadString(node, "name")
                    ?? ReadString(node, "heading")
                    ?? cardTitle;

                CaptureEntities(source, dashboard, viewTitle, type, title, node, refs);

                if (node.TryGetProperty("cards", out var cards) && cards.ValueKind == JsonValueKind.Array)
                {
                    foreach (var card in cards.EnumerateArray())
                        WalkNode(source, dashboard, viewTitle, card, refs, type, title);
                }

                if (node.TryGetProperty("sections", out var sections) && sections.ValueKind == JsonValueKind.Array)
                {
                    foreach (var section in sections.EnumerateArray())
                    {
                        if (section.TryGetProperty("cards", out var sectionCards)
                            && sectionCards.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var card in sectionCards.EnumerateArray())
                                WalkNode(source, dashboard, viewTitle, card, refs, type, title);
                        }
                    }
                }

                foreach (var prop in node.EnumerateObject())
                {
                    if (prop.Name is "cards" or "sections" or "views")
                        continue;
                    if (prop.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
                        WalkNode(source, dashboard, viewTitle, prop.Value, refs, type, title);
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in node.EnumerateArray())
                    WalkNode(source, dashboard, viewTitle, item, refs, cardType, cardTitle);
                break;
        }
    }

    static void CaptureEntities(
        string source,
        string? dashboard,
        string viewTitle,
        string? cardType,
        string? cardTitle,
        JsonElement node,
        Dictionary<string, List<LovelaceEntityReference>> refs)
    {
        switch (node.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in node.EnumerateObject())
                {
                    if (prop.Name is "entity" or "entity_id" && prop.Value.ValueKind == JsonValueKind.String)
                    {
                        AddReference(source, dashboard, viewTitle, cardType, cardTitle, prop.Value.GetString(), refs);
                    }
                    else if (prop.Name == "entities" && prop.Value.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in prop.Value.EnumerateArray())
                        {
                            if (item.ValueKind == JsonValueKind.String)
                                AddReference(source, dashboard, viewTitle, cardType, cardTitle, item.GetString(), refs);
                            else
                                CaptureEntities(source, dashboard, viewTitle, cardType, cardTitle, item, refs);
                        }
                    }
                    else
                    {
                        CaptureEntities(source, dashboard, viewTitle, cardType, cardTitle, prop.Value, refs);
                    }
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in node.EnumerateArray())
                    CaptureEntities(source, dashboard, viewTitle, cardType, cardTitle, item, refs);
                break;
        }
    }

    static void AddReference(
        string source,
        string? dashboard,
        string viewTitle,
        string? cardType,
        string? cardTitle,
        string? entityId,
        Dictionary<string, List<LovelaceEntityReference>> refs)
    {
        if (!IsEntityId(entityId))
            return;

        if (!refs.TryGetValue(entityId!, out var list))
        {
            list = [];
            refs[entityId!] = list;
        }

        var reference = new LovelaceEntityReference(
            source,
            dashboard,
            viewTitle,
            cardType,
            cardTitle);
        if (!list.Any(r =>
                r.Source == reference.Source
                && r.Dashboard == reference.Dashboard
                && r.View == reference.View
                && r.CardType == reference.CardType
                && r.CardTitle == reference.CardTitle))
        {
            list.Add(reference);
        }
    }

    static (string Kind, string Suggestion, string? SuggestedProdEntity) Suggest(
        string entityId,
        bool onStaging,
        string? similarProdEntity,
        IReadOnlyList<LovelaceEntityReference> references,
        ProdEntityRegistryEntry? similarProdEntry)
    {
        var where = FormatWhere(references);
        if (!string.IsNullOrWhiteSpace(similarProdEntity)
            && !string.Equals(similarProdEntity, entityId, StringComparison.OrdinalIgnoreCase))
        {
            if (RegistryUniqueIdMatchesExpected(entityId, similarProdEntry))
            {
                return (
                    "prod_typo",
                    $"Dashboard expects `{entityId}`{where}. Prod exposes `{similarProdEntity}` but registry unique_id is `{similarProdEntry!.UniqueId}` — rename the prod entity to `{entityId}`, then Recheck.",
                    similarProdEntity);
            }

            if (IsLikelyProdTypo(entityId, similarProdEntity, similarProdEntry))
            {
                return (
                    "prod_typo",
                    $"Dashboard expects `{entityId}`{where}. Prod has `{similarProdEntity}` — fix on prod, then Recheck.",
                    similarProdEntity);
            }

            return (
                "rename",
                $"Dashboard likely has the wrong entity id{where}. Prod has `{similarProdEntity}` — rename on the dashboard or remove the card.",
                similarProdEntity);
        }

        if (onStaging)
        {
            return (
                "remove",
                $"On staging but not on prod{where}. Remove the card, add the device on prod then sync storage to staging, or defer.",
                null);
        }

        return (
            "add_on_prod",
            $"Not on prod{where}. Add the device on prod, sync storage to staging, or remove the dashboard reference.",
            null);
    }

    static string FormatWhere(IReadOnlyList<LovelaceEntityReference> references)
    {
        if (references.Count == 0)
            return "";

        var first = references[0];
        var label = ReferenceLabel(first);
        if (references.Count == 1)
            return $" in {label}";

        return $" in {label} (+{references.Count - 1} more)";
    }

    static string ReferenceLabel(LovelaceEntityReference reference)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(reference.Dashboard))
            parts.Add(reference.Dashboard);
        parts.Add(reference.View);
        if (!string.IsNullOrWhiteSpace(reference.CardTitle))
            parts.Add($"“{reference.CardTitle}”");
        else if (!string.IsNullOrWhiteSpace(reference.CardType))
            parts.Add(reference.CardType);
        return string.Join(" → ", parts);
    }

    static string? FindSimilarEntityId(string entityId, IReadOnlySet<string> prodEntityIds)
    {
        var dot = entityId.IndexOf('.');
        if (dot <= 0)
            return null;

        var domain = entityId[..dot];
        var objectId = entityId[(dot + 1)..];
        string? best = null;
        var bestScore = int.MaxValue;

        foreach (var candidate in prodEntityIds)
        {
            if (!candidate.StartsWith($"{domain}.", StringComparison.Ordinal))
                continue;

            var candidateObject = candidate[(domain.Length + 1)..];
            if (string.Equals(candidateObject, objectId, StringComparison.OrdinalIgnoreCase))
                return candidate;

            var score = EditDistance(objectId, candidateObject);
            if (objectId.Contains(candidateObject, StringComparison.OrdinalIgnoreCase)
                || candidateObject.Contains(objectId, StringComparison.OrdinalIgnoreCase))
            {
                score = Math.Min(score, 2);
            }

            if (score < bestScore && score <= 4)
            {
                bestScore = score;
                best = candidate;
            }
        }

        return best;
    }

    static bool RegistryUniqueIdMatchesExpected(string expectedEntityId, ProdEntityRegistryEntry? prodEntry)
    {
        if (string.IsNullOrWhiteSpace(prodEntry?.UniqueId))
            return false;

        return string.Equals(prodEntry.UniqueId, ObjectId(expectedEntityId), StringComparison.OrdinalIgnoreCase);
    }

    static bool IsLikelyProdTypo(
        string dashboardEntityId,
        string prodEntityId,
        ProdEntityRegistryEntry? prodEntry)
    {
        if (RegistryUniqueIdMatchesExpected(dashboardEntityId, prodEntry))
            return true;

        var dashObj = ObjectId(dashboardEntityId);
        var prodObj = ObjectId(prodEntityId);
        if (EditDistance(dashObj, prodObj) > 4)
            return false;

        var dashCollapsed = dashObj.Replace("_", "", StringComparison.Ordinal);
        var prodCollapsed = prodObj.Replace("_", "", StringComparison.Ordinal);

        // Same letters, different underscore grouping — rename dashboard to match prod (not a prod typo).
        if (string.Equals(dashCollapsed, prodCollapsed, StringComparison.OrdinalIgnoreCase))
            return false;

        // Prod uses clearer snake_case; dashboard likely needs renaming to match prod.
        if (prodObj.Count(c => c == '_') > dashObj.Count(c => c == '_')
            && prodCollapsed.Contains(dashCollapsed, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var dashParts = dashObj.Split('_');
        var prodParts = prodObj.Split('_');
        if (dashParts.Length == prodParts.Length)
        {
            for (var i = 0; i < dashParts.Length; i++)
            {
                if (string.Equals(dashParts[i], prodParts[i], StringComparison.OrdinalIgnoreCase))
                    continue;
                if (IsTypoOf(prodParts[i], dashParts[i]))
                    return true;
            }
        }

        return IsTypoOf(prodObj, dashObj);
    }

    static bool IsTypoOf(string typoCandidate, string intended)
    {
        if (string.Equals(typoCandidate, intended, StringComparison.OrdinalIgnoreCase))
            return false;

        var distance = EditDistance(typoCandidate, intended);
        return distance is > 0 and <= 2 && intended.Length >= 4;
    }

    static string ObjectId(string entityId)
    {
        var dot = entityId.IndexOf('.');
        return dot > 0 ? entityId[(dot + 1)..] : entityId;
    }

    static int EditDistance(string a, string b)
    {
        if (a.Length == 0)
            return b.Length;
        if (b.Length == 0)
            return a.Length;

        var costs = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++)
            costs[j] = j;

        for (var i = 1; i <= a.Length; i++)
        {
            costs[0] = i;
            var last = i - 1;
            for (var j = 1; j <= b.Length; j++)
            {
                var temp = costs[j];
                costs[j] = Math.Min(
                    Math.Min(costs[j] + 1, costs[j - 1] + 1),
                    last + (a[i - 1] == b[j - 1] ? 0 : 1));
                last = temp;
            }
        }

        return costs[b.Length];
    }

    static string? ReadString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    static bool IsEntityId(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Contains('.', StringComparison.Ordinal)
        && !value.StartsWith("custom:", StringComparison.OrdinalIgnoreCase)
        && !value.StartsWith("ui-", StringComparison.OrdinalIgnoreCase);
}
