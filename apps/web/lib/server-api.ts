import "server-only";

/**
 * Reading the engine from a server component.
 *
 * `publicEnv.apiUrl` is "/api", which is a browser path: it works because next.config rewrites
 * it, and a rewrite only exists for requests that reach the browser. A server component has to
 * call the engine directly, which is what `API_INTERNAL_URL` is already set to in compose.
 */
const base = (process.env["API_INTERNAL_URL"] ?? "http://localhost:8080").replace(/\/$/, "");

/**
 * Fetch public engine data for a marketing page.
 *
 * `revalidate` rather than `no-store`: the marketing pages are the ones strangers hit first and
 * they should stay fast and cacheable, but a price somebody changed in the console has to show
 * up without a deploy. A minute is the compromise -- short enough that an edit looks like it
 * worked, long enough that a quiet page is not re-fetching per visitor.
 *
 * Returns `null` rather than throwing. A marketing page that 500s because the API blinked is a
 * worse outcome than one rendering its last-known content, so callers are made to decide.
 */
export async function fetchPublic<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${base}${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
