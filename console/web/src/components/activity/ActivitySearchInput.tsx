import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ActivityEntitySuggestion } from "../../api";

type DomainFilter = "all" | "automation" | "script" | "notify";

/** Show all matches up to this cap — list scrolls; backend holds the full HA entity set. */
const MAX_VISIBLE_MATCHES = 100;

type FilterResult = {
  matches: ActivityEntitySuggestion[];
  poolTotal: number;
  poolLabel: string;
};

function rankSuggestion(suggestion: ActivityEntitySuggestion, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = suggestion.name.toLowerCase();
  const entityId = suggestion.entityId.toLowerCase();
  if (name === q || entityId === q) return 0;
  if (name.startsWith(q) || entityId.startsWith(q)) return 1;
  if (name.includes(q) || entityId.includes(q)) return 2;
  return 99;
}

function poolForDomain(
  items: ActivityEntitySuggestion[],
  domainFilter: DomainFilter,
  automationCount: number,
  scriptCount: number,
): { list: ActivityEntitySuggestion[]; total: number; label: string } {
  if (domainFilter === "automation") {
    const list = items.filter((item) => item.domain === "automation");
    return { list, total: list.length, label: `${automationCount} automations` };
  }
  if (domainFilter === "script") {
    const list = items.filter((item) => item.domain === "script");
    return { list, total: list.length, label: `${scriptCount} scripts` };
  }
  return {
    list: items,
    total: items.length,
    label: `${automationCount} automations, ${scriptCount} scripts`,
  };
}

function filterSuggestions(
  items: ActivityEntitySuggestion[],
  query: string,
  domainFilter: DomainFilter,
  automationCount: number,
  scriptCount: number,
): FilterResult {
  const q = query.trim().toLowerCase();
  const pool = poolForDomain(items, domainFilter, automationCount, scriptCount);

  if (!q) {
    return { matches: [], poolTotal: pool.total, poolLabel: pool.label };
  }

  const matches = pool.list
    .map((item) => ({ item, rank: rankSuggestion(item, q) }))
    .filter(({ rank }) => rank < 99)
    .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name))
    .slice(0, MAX_VISIBLE_MATCHES)
    .map(({ item }) => item);

  return { matches, poolTotal: pool.total, poolLabel: pool.label };
}

function instanceLabel(instances: string[]) {
  const hasProd = instances.includes("prod");
  const hasStaging = instances.includes("staging");
  if (hasProd && hasStaging) return "Both";
  if (hasProd) return "Production";
  if (hasStaging) return "Staging";
  return instances.join(", ");
}

export function ActivitySearchInput({
  value,
  onChange,
  domainFilter,
  suggestions,
  automationCount,
  scriptCount,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  domainFilter: DomainFilter;
  suggestions: ActivityEntitySuggestion[];
  automationCount: number;
  scriptCount: number;
  loading?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const { matches, poolTotal, poolLabel } = useMemo(
    () => filterSuggestions(suggestions, value, domainFilter, automationCount, scriptCount),
    [suggestions, value, domainFilter, automationCount, scriptCount],
  );

  const query = value.trim();
  const showList = open && !loading && poolTotal > 0;
  const showHint = showList && query.length === 0;
  const showMatches = showList && query.length > 0;
  const showNoMatches = showList && query.length > 0 && matches.length === 0;

  useEffect(() => {
    setActiveIndex(matches.length > 0 ? 0 : -1);
  }, [matches]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const pick = (suggestion: ActivityEntitySuggestion) => {
    onChange(suggestion.entityId);
    setOpen(false);
    inputRef.current?.blur();
  };

  const placeholder =
    loading || poolTotal === 0
      ? "Loading names…"
      : `Search ${poolLabel}…`;

  return (
    <div className="activity-search" ref={rootRef}>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            setOpen(true);
            return;
          }
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!showMatches || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
            return;
          }
          if (e.key === "Enter" && activeIndex >= 0 && matches[activeIndex]) {
            e.preventDefault();
            pick(matches[activeIndex]);
          }
        }}
      />
      {showList ? (
        <ul id={listId} className="activity-search-list" role="listbox">
          {showHint ? (
            <li className="activity-search-empty muted">Type a name or entity_id to search all {poolTotal}.</li>
          ) : null}
          {showNoMatches ? (
            <li className="activity-search-empty muted">
              No matches in {poolTotal} loaded entities. Try another spelling or entity_id.
            </li>
          ) : null}
          {showMatches
            ? matches.map((suggestion, index) => (
                <li
                  key={suggestion.entityId}
                  id={`${listId}-opt-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`activity-search-option ${index === activeIndex ? "is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(suggestion)}
                >
                  <span className="activity-search-option-name">{suggestion.name}</span>
                  <code className="activity-search-option-id">{suggestion.entityId}</code>
                  <span className="activity-search-option-meta">
                    <span className="activity-search-option-domain">{suggestion.domain}</span>
                    <span className="activity-search-option-instances">{instanceLabel(suggestion.instances)}</span>
                  </span>
                </li>
              ))
            : null}
          {showMatches && matches.length > 0 ? (
            <li className="activity-search-footer muted" aria-hidden="true">
              {matches.length < poolTotal
                ? `Showing ${matches.length} match${matches.length === 1 ? "" : "es"}`
                : `Showing all ${matches.length}`}
              {matches.length >= MAX_VISIBLE_MATCHES ? ` (first ${MAX_VISIBLE_MATCHES} — narrow your search)` : ""}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
