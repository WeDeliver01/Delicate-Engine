"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { PackageCategory } from "@delicate/contracts";
import { api } from "@/lib/api";

/**
 * Adding to the packaging list, and the headings it is sorted under.
 *
 * Both live here rather than in the pricing page because they are the one part of the
 * catalog that is not a price: what the business puts things in, which changes when it
 * starts selling a new size of box and not when it changes what it charges.
 */

/**
 * Add a box to the list.
 *
 * The code is generated rather than asked for. It is how the engine refers to the row for
 * ever after and the one field a typo makes permanent, and nobody outside the engine has a
 * reason to care what it says.
 */
export function NewPackageType({
  categories,
  count,
  onSaved,
  onError,
}: {
  categories: PackageCategory[];
  count: number;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const blank = {
    name: "",
    category: categories[0]?.name ?? "",
    lengthCm: "",
    widthCm: "",
    heightCm: "",
    maxWeightKg: "",
    surcharge: "0.00",
  };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!f.category && categories[0]) setF((x) => ({ ...x, category: categories[0]!.name }));
  }, [categories, f.category]);

  const save = useMutation({
    mutationFn: () =>
      api("/v1/admin/catalog/package-types", {
        method: "POST",
        json: {
          code: codeFor(f.name),
          name: f.name.trim(),
          description: null,
          category: f.category,
          lengthCm: f.lengthCm ? Number(f.lengthCm) : null,
          widthCm: f.widthCm ? Number(f.widthCm) : null,
          heightCm: f.heightCm ? Number(f.heightCm) : null,
          maxWeightKg: f.maxWeightKg ? Number(f.maxWeightKg) : null,
          surchargeCents: Math.round(Number(f.surcharge) * 100),
          sortOrder: count + 1,
          active: true,
        },
      }),
    onSuccess: () => {
      setF({ ...blank, category: f.category });
      setOpen(false);
      onSaved();
    },
    onError,
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary btn-sm">
        + Add packaging
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-line p-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-6">
        <input
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="Name, e.g. Medium Cake Box"
          className="input px-2 py-1 sm:col-span-2"
        />
        <select
          value={f.category}
          onChange={(e) => setF({ ...f, category: e.target.value })}
          className="input px-2 py-1 sm:col-span-2"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={f.maxWeightKg}
          onChange={(e) => setF({ ...f, maxWeightKg: e.target.value })}
          placeholder="kg"
          className="input px-2 py-1 font-mono"
        />
        <input
          type="number"
          step="0.01"
          value={f.surcharge}
          onChange={(e) => setF({ ...f, surcharge: e.target.value })}
          placeholder="Handling R"
          className="input px-2 py-1 font-mono"
        />
        <input
          type="number"
          value={f.lengthCm}
          onChange={(e) => setF({ ...f, lengthCm: e.target.value })}
          placeholder="L cm"
          className="input px-2 py-1 font-mono"
        />
        <input
          type="number"
          value={f.widthCm}
          onChange={(e) => setF({ ...f, widthCm: e.target.value })}
          placeholder="W cm"
          className="input px-2 py-1 font-mono"
        />
        <input
          type="number"
          value={f.heightCm}
          onChange={(e) => setF({ ...f, heightCm: e.target.value })}
          placeholder="H cm"
          className="input px-2 py-1 font-mono"
        />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={f.name.trim().length < 2 || !f.category || save.isPending}
          onClick={() => save.mutate()}
          className="btn btn-primary btn-sm"
        >
          Add it
        </button>
        <button type="button" onClick={() => setOpen(false)} className="link-quiet text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** How the engine refers to a package type for ever after: lower case, no spaces. */
function codeFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  // A clash is refused by the engine's unique index rather than guessed at here, but a name
  // of nothing but punctuation still has to produce something.
  return slug || `pkg_${Date.now().toString(36)}`;
}

/**
 * The headings the packaging list is sorted under.
 *
 * Renaming one moves every box filed under it, which the engine does in one transaction.
 * Switching one off hides it from new bookings and leaves the boxes where they are.
 */
export function Categories({
  rows,
  onSaved,
  onError,
}: {
  rows: PackageCategory[];
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [adding, setAdding] = useState("");
  const create = useMutation({
    mutationFn: (name: string) =>
      api("/v1/admin/catalog/package-categories", {
        method: "POST",
        json: { name: name.trim(), sortOrder: rows.length + 1, active: true },
      }),
    onSuccess: () => {
      setAdding("");
      onSaved();
    },
    onError,
  });

  return (
    <section className="panel p-5">
      <h2 className="section-title">Parcel categories</h2>
      <p className="mt-1 text-xs text-muted">
        How the packaging list is grouped for the customer. Renaming one moves everything filed
        under it.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((c) => (
          <CategoryRow key={c.id} row={c} onSaved={onSaved} onError={onError} />
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="New category"
          className="input max-w-xs px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={adding.trim().length < 2 || create.isPending}
          onClick={() => create.mutate(adding)}
          className="btn btn-secondary btn-sm"
        >
          Add
        </button>
      </div>
    </section>
  );
}

function CategoryRow({
  row,
  onSaved,
  onError,
}: {
  row: PackageCategory;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [f, setF] = useState({ name: row.name, active: row.active });
  useEffect(() => setF({ name: row.name, active: row.active }), [row]);
  const dirty = f.name !== row.name || f.active !== row.active;
  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/catalog/package-categories/${row.id}`, {
        method: "PUT",
        json: { name: f.name.trim(), sortOrder: row.sortOrder, active: f.active },
      }),
    onSuccess: onSaved,
    onError,
  });
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line p-2 text-sm">
      <input
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        className="input min-w-0 flex-1 px-2 py-1"
      />
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
        <input
          type="checkbox"
          checked={f.active}
          onChange={(e) => setF({ ...f, active: e.target.checked })}
        />
        on
      </label>
      <button
        type="button"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
        className="link-accent shrink-0 text-xs disabled:opacity-30"
      >
        Save
      </button>
    </div>
  );
}
