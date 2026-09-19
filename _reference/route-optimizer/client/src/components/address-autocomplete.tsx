import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function generateSessionToken(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface PlaceResult {
  placeId: string;
  address: string;
  name: string;
  lat: number;
  lng: number;
}

interface Suggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (place: PlaceResult) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Search address...",
  className,
  disabled,
  "data-testid": testId,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(value, 350);
  const sessionTokenRef = useRef(generateSessionToken());

  useEffect(() => {
    if (!debounced || debounced.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setApiError(null);
    const token = sessionTokenRef.current;
    fetch(`/api/places/autocomplete?input=${encodeURIComponent(debounced)}&session_token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setApiError("Places API unavailable");
          setSuggestions([]);
          setOpen(false);
        } else {
          setSuggestions(data.suggestions || []);
          setOpen((data.suggestions || []).length > 0);
          setHighlightIdx(-1);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiError("Could not reach Places API");
          setSuggestions([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [debounced]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectSuggestion = useCallback(async (s: Suggestion) => {
    setOpen(false);
    setSuggestions([]);
    onChange(s.description);
    setResolving(true);
    const token = sessionTokenRef.current;
    try {
      const r = await fetch(`/api/places/details?place_id=${encodeURIComponent(s.placeId)}&session_token=${encodeURIComponent(token)}`);
      const data = await r.json();
      if (data.lat != null && data.lng != null) {
        onSelect({
          placeId: s.placeId,
          address: data.address || s.description,
          name: data.name || s.mainText,
          lat: data.lat,
          lng: data.lng,
        });
        onChange(data.address || s.description);
      } else {
        setApiError("Could not resolve coordinates for this address");
      }
    } catch {
      setApiError("Failed to get place details");
    } finally {
      setResolving(false);
      sessionTokenRef.current = generateSessionToken();
    }
  }, [onChange, onSelect]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full" data-testid={testId}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); setApiError(null); }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("pr-8 text-[12px]", className)}
          autoComplete="off"
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
          {resolving || loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : apiError ? (
            <span title={apiError}><AlertCircle className="w-3.5 h-3.5 text-amber-500" /></span>
          ) : (
            <MapPin className="w-3.5 h-3.5 text-muted-foreground/50" />
          )}
        </div>
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full left-0 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={s.placeId}
              type="button"
              className={cn(
                "w-full text-left px-3 py-2.5 flex items-start gap-2.5 text-[12px] transition-colors",
                i === highlightIdx ? "bg-accent" : "hover:bg-muted/60"
              )}
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
              onMouseEnter={() => setHighlightIdx(i)}
              data-testid={`suggestion-${i}`}
            >
              <MapPin className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
              <span className="min-w-0">
                <span className="font-medium block truncate">{s.mainText}</span>
                {s.secondaryText && (
                  <span className="text-[11px] text-muted-foreground truncate block">{s.secondaryText}</span>
                )}
              </span>
            </button>
          ))}
          <div className="px-3 py-1.5 bg-muted/30 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground/60">Powered by Google Places</p>
          </div>
        </div>
      )}

      {apiError && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {apiError} — you can still type a name manually
        </p>
      )}
    </div>
  );
}
