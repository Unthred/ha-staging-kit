using System.Text.RegularExpressions;

namespace HaStagingConsole.Services;

static class LovelaceEntityFixer
{
    static readonly Regex EmptyTargetPropertyRegex = new(
        @"""target""\s*:\s*(?:\{\s*\}|\})\s*,?",
        RegexOptions.Multiline | RegexOptions.CultureInvariant);

    static readonly Regex OrphanTargetCommaRegex = new(
        @"""target""\s*:\s*,\s*",
        RegexOptions.Multiline | RegexOptions.CultureInvariant);

    public static LovelaceFixApplyResult ApplyRemove(string repoRoot, string entityId)
    {
        if (!IsEntityId(entityId))
            throw new ArgumentException($"Invalid entity id: {entityId}");

        return ApplyTextRemove(repoRoot, entityId);
    }

    public static LovelaceFixApplyResult ApplyRename(string repoRoot, string fromEntityId, string toEntityId)
    {
        if (!IsEntityId(fromEntityId))
            throw new ArgumentException($"Invalid entity id: {fromEntityId}");
        if (!IsEntityId(toEntityId))
            throw new ArgumentException($"Invalid replacement entity id: {toEntityId}");

        return ApplyTextReplace(repoRoot, fromEntityId, toEntityId);
    }

    static LovelaceFixApplyResult ApplyTextReplace(string repoRoot, string fromEntityId, string toEntityId)
    {
        var modified = new List<string>();
        var changeCount = 0;

        foreach (var relativePath in ProdStorageDeployService.LovelaceBundlePaths)
        {
            var diskPath = Path.Combine(repoRoot, relativePath);
            if (!File.Exists(diskPath))
                continue;

            var text = File.ReadAllText(diskPath);
            var fileChanges = CountOccurrences(text, fromEntityId);
            if (fileChanges <= 0)
                continue;

            File.WriteAllText(diskPath, text.Replace(fromEntityId, toEntityId, StringComparison.Ordinal));
            modified.Add(relativePath);
            changeCount += fileChanges;
        }

        return new LovelaceFixApplyResult(changeCount, modified);
    }

    static LovelaceFixApplyResult ApplyTextRemove(string repoRoot, string entityId)
    {
        var modified = new List<string>();
        var changeCount = 0;

        foreach (var relativePath in ProdStorageDeployService.LovelaceBundlePaths)
        {
            var diskPath = Path.Combine(repoRoot, relativePath);
            if (!File.Exists(diskPath))
                continue;

            var text = File.ReadAllText(diskPath);
            var updated = RemoveEntityFromText(text, entityId, out var fileChanges);
            if (fileChanges <= 0)
                continue;

            File.WriteAllText(diskPath, updated);
            modified.Add(relativePath);
            changeCount += fileChanges;
        }

        return new LovelaceFixApplyResult(changeCount, modified);
    }

    static string RemoveEntityFromText(string text, string entityId, out int changeCount)
    {
        changeCount = 0;
        var quoted = $"\"{entityId}\"";
        var spans = new List<(int Start, int End)>();

        var index = 0;
        while ((index = text.IndexOf(quoted, index, StringComparison.Ordinal)) >= 0)
        {
            if (TryGetEntityPropertyName(text, index, out var propName))
            {
                if (propName == "entity_id")
                {
                    var (propStart, propEnd) = FindEntityPropertySpan(text, index);
                    if (propStart >= 0)
                    {
                        spans.Add(ExpandRemovalSpan(text, propStart, propEnd));
                        changeCount++;
                    }
                }
                else
                {
                    var objectStart = FindObjectStart(text, index);
                    if (objectStart >= 0)
                    {
                        var objectEnd = FindObjectEnd(text, objectStart);
                        if (objectEnd >= 0)
                        {
                            spans.Add(ExpandRemovalSpan(text, objectStart, objectEnd));
                            changeCount++;
                        }
                    }
                }
            }
            else if (IsBareArrayStringElement(text, index, quoted.Length))
            {
                spans.Add(ExpandRemovalSpan(text, index, index + quoted.Length - 1));
                changeCount++;
            }

            index += quoted.Length;
        }

        foreach (var (start, end) in spans.OrderByDescending(span => span.Start))
            text = text.Remove(start, end - start);

        return CleanupAfterEntityRemovals(text);
    }

    static string CleanupAfterEntityRemovals(string text)
    {
        text = RemoveEmptyTargetProperties(text);

        var previous = string.Empty;
        while (!string.Equals(previous, text, StringComparison.Ordinal))
        {
            previous = text;
            text = EmptyTargetPropertyRegex.Replace(text, string.Empty);
            text = OrphanTargetCommaRegex.Replace(text, string.Empty);
        }

        return text;
    }

    static string RemoveEmptyTargetProperties(string text)
    {
        const string key = "\"target\"";
        var index = 0;
        while ((index = text.IndexOf(key, index, StringComparison.Ordinal)) >= 0)
        {
            var cursor = index + key.Length;
            while (cursor < text.Length && char.IsWhiteSpace(text[cursor]))
                cursor++;

            if (cursor >= text.Length || text[cursor] != ':')
            {
                index++;
                continue;
            }

            cursor++;
            while (cursor < text.Length && char.IsWhiteSpace(text[cursor]))
                cursor++;

            if (cursor >= text.Length || text[cursor] != '{')
            {
                index++;
                continue;
            }

            var objectEnd = FindObjectEnd(text, cursor);
            if (objectEnd < 0)
            {
                index++;
                continue;
            }

            var inner = text.AsSpan(cursor + 1, objectEnd - cursor - 1);
            if (!inner.IsEmpty && !inner.Trim().IsEmpty)
            {
                index = objectEnd + 1;
                continue;
            }

            var (removeStart, removeEnd) = ExpandRemovalSpan(text, index, objectEnd);
            text = text.Remove(removeStart, removeEnd - removeStart);
            index = removeStart;
        }

        return text;
    }

    static bool TryGetEntityPropertyName(string text, int valueQuoteStart, out string propName)
    {
        propName = string.Empty;
        var scan = valueQuoteStart - 1;
        while (scan >= 0 && char.IsWhiteSpace(text[scan]))
            scan--;

        if (scan < 0 || text[scan] != ':')
            return false;

        scan--;
        while (scan >= 0 && char.IsWhiteSpace(text[scan]))
            scan--;

        if (scan < 0 || text[scan] != '"')
            return false;

        var propEnd = scan;
        scan--;
        while (scan >= 0 && text[scan] != '"')
            scan--;

        if (scan < 0)
            return false;

        propName = text[(scan + 1)..propEnd];
        return propName is "entity" or "entity_id";
    }

    static (int Start, int End) FindEntityPropertySpan(string text, int valueQuoteStart)
    {
        var keyStart = FindPropertyKeyStart(text, valueQuoteStart);
        if (keyStart < 0)
            return (-1, -1);

        var valueEnd = FindStringEnd(text, valueQuoteStart);
        if (valueEnd < 0)
            return (-1, -1);

        // Only consume same-line whitespace/comma — never swallow the parent object's closing brace.
        var end = valueEnd + 1;
        while (end < text.Length && text[end] != '\n' && char.IsWhiteSpace(text[end]))
            end++;

        if (end < text.Length && text[end] == ',')
            end++;

        return (keyStart, end);
    }

    static int FindPropertyKeyStart(string text, int valueQuoteStart)
    {
        var scan = valueQuoteStart - 1;
        while (scan >= 0 && char.IsWhiteSpace(text[scan]))
            scan--;

        if (scan < 0 || text[scan] != ':')
            return -1;

        scan--;
        while (scan >= 0 && char.IsWhiteSpace(text[scan]))
            scan--;

        if (scan < 0 || text[scan] != '"')
            return -1;

        scan--;
        while (scan >= 0 && text[scan] != '"')
            scan--;

        return scan;
    }

    static int FindStringEnd(string text, int openQuoteIndex)
    {
        if (openQuoteIndex < 0 || openQuoteIndex >= text.Length || text[openQuoteIndex] != '"')
            return -1;

        for (var i = openQuoteIndex + 1; i < text.Length; i++)
        {
            if (text[i] == '\\')
            {
                i++;
                continue;
            }

            if (text[i] == '"')
                return i;
        }

        return -1;
    }

    static bool IsBareArrayStringElement(string text, int valueQuoteStart, int quotedLength)
    {
        var valueEnd = valueQuoteStart + quotedLength - 1;
        var after = valueEnd + 1;
        while (after < text.Length && char.IsWhiteSpace(text[after]))
            after++;

        if (after >= text.Length || text[after] is not (',' or ']'))
            return false;

        var before = valueQuoteStart - 1;
        while (before >= 0 && char.IsWhiteSpace(text[before]))
            before--;

        return before >= 0 && text[before] is ',' or '[';
    }

    static int FindObjectStart(string text, int position)
    {
        var depth = 0;
        for (var i = position - 1; i >= 0; i--)
        {
            if (IsInsideString(text, i))
                continue;

            switch (text[i])
            {
                case '}':
                    depth++;
                    break;
                case '{':
                    if (depth == 0)
                        return i;
                    depth--;
                    break;
            }
        }

        return -1;
    }

    static int FindObjectEnd(string text, int objectStart)
    {
        var depth = 0;
        for (var i = objectStart; i < text.Length; i++)
        {
            if (IsInsideString(text, i))
                continue;

            switch (text[i])
            {
                case '{':
                    depth++;
                    break;
                case '}':
                    depth--;
                    if (depth == 0)
                        return i;
                    break;
            }
        }

        return -1;
    }

    static (int Start, int End) ExpandRemovalSpan(string text, int start, int end)
    {
        start = IncludeLeadingWhitespaceLine(text, start);

        // Whole-object removal: end points at closing "}".
        if (end < text.Length && text[end] == '}')
        {
            var afterBrace = end + 1;
            while (afterBrace < text.Length && char.IsWhiteSpace(text[afterBrace]))
                afterBrace++;

            if (afterBrace < text.Length && text[afterBrace] == ',')
                return (start, afterBrace + 1);

            // Last element in array/object — drop the leading comma instead.
            var objectRemoveStart = start;
            while (objectRemoveStart > 0 && char.IsWhiteSpace(text[objectRemoveStart - 1]))
                objectRemoveStart--;

            if (objectRemoveStart > 0 && text[objectRemoveStart - 1] == ',')
                objectRemoveStart--;

            return (objectRemoveStart, end + 1);
        }

        // Property removal: end is after value, optional same-line comma.
        var removeEnd = end;
        while (removeEnd < text.Length && text[removeEnd] != '\n' && char.IsWhiteSpace(text[removeEnd]))
            removeEnd++;

        if (removeEnd < text.Length && text[removeEnd] == ',')
            return (start, removeEnd + 1);

        var removeStart = start;
        while (removeStart > 0 && char.IsWhiteSpace(text[removeStart - 1]))
            removeStart--;

        if (removeStart > 0 && text[removeStart - 1] == ',')
            removeStart--;

        return (removeStart, end);
    }

    static int IncludeLeadingWhitespaceLine(string text, int start)
    {
        var lineStart = start;
        while (lineStart > 0 && text[lineStart - 1] != '\n')
            lineStart--;

        return lineStart < start && text[lineStart..start].All(char.IsWhiteSpace)
            ? lineStart
            : start;
    }

    static bool IsInsideString(string text, int position)
    {
        var inString = false;
        for (var i = 0; i < position; i++)
        {
            if (!inString)
            {
                if (text[i] == '"')
                    inString = true;
                continue;
            }

            if (text[i] == '\\')
            {
                i++;
                continue;
            }

            if (text[i] == '"')
                inString = false;
        }

        return inString;
    }

    static int CountOccurrences(string text, string needle)
    {
        if (string.IsNullOrEmpty(needle))
            return 0;

        var count = 0;
        var index = 0;
        while ((index = text.IndexOf(needle, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += needle.Length;
        }

        return count;
    }

    static bool IsEntityId(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Contains('.', StringComparison.Ordinal)
        && !value.StartsWith("custom:", StringComparison.OrdinalIgnoreCase)
        && !value.StartsWith("ui-", StringComparison.OrdinalIgnoreCase);
}

public sealed record LovelaceFixApplyResult(int ChangeCount, IReadOnlyList<string> ModifiedFiles);
