"use client";

import { useEffect, useState } from "react";
import { publicEnv } from "@/lib/env";
import { getAccessToken } from "@/lib/session";

/**
 * The photographs a driver took at the door.
 *
 * Evidence files are served to staff at `/v1/admin/files/:id` behind the bearer token, which a
 * plain `<img src>` cannot carry. Each one is fetched with the token and shown from a blob URL
 * that is revoked when the component goes away, so a page of twenty deliveries does not leave
 * twenty photographs pinned in memory.
 *
 * A photo that will not load says so in its own box rather than vanishing: a dispute about a
 * delivery is exactly when "the photo is missing" and "the photo did not load" must not look
 * the same.
 */
export function PodPhotos({ fileIds, size = 160 }: { fileIds: string[]; size?: number }) {
  const [urls, setUrls] = useState<Record<string, string | "error">>({});

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    void (async () => {
      const token = await getAccessToken();
      for (const id of fileIds) {
        try {
          const res = await fetch(`${publicEnv.apiUrl}/v1/admin/files/${id}`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error(String(res.status));
          const url = URL.createObjectURL(await res.blob());
          made.push(url);
          if (!cancelled) setUrls((u) => ({ ...u, [id]: url }));
        } catch {
          if (!cancelled) setUrls((u) => ({ ...u, [id]: "error" }));
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [fileIds]);

  if (fileIds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {fileIds.map((id, i) => {
        const url = urls[id];
        return (
          <a
            key={id}
            href={url && url !== "error" ? url : undefined}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-xl border border-[#F0EDE9] bg-[#F8F6F3]"
            style={{ width: size, height: size }}
            title={`Proof photo ${i + 1} of ${fileIds.length}`}
          >
            {url === "error" ? (
              <span className="flex h-full items-center justify-center p-3 text-center text-xs text-muted">
                Photo {i + 1} did not load
              </span>
            ) : url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a blob URL, not an asset
              <img
                src={url}
                alt={`Proof of delivery ${i + 1}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="block h-full w-full animate-pulse" />
            )}
          </a>
        );
      })}
    </div>
  );
}
