type Primitive = string | number | boolean | null;

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function formatPrimitive(value: Primitive): string {
  if (value === null) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  return value;
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\s+|\s+$/g, "")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function PayloadRenderer({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return (
      <pre className="overflow-x-auto rounded-md bg-slate-100 p-3 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
        {JSON.stringify(payload, null, 2)}
      </pre>
    );
  }

  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">Empty payload.</p>;
  }

  return (
    <dl className="divide-y divide-slate-200 dark:divide-slate-800">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[10rem_1fr] sm:gap-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {humanizeKey(key)}
          </dt>
          <dd className="text-sm text-slate-900 dark:text-slate-100">
            {isPrimitive(value) ? (
              formatPrimitive(value)
            ) : (
              <pre className="overflow-x-auto rounded-md bg-slate-100 p-2 text-xs dark:bg-slate-900">
                {JSON.stringify(value, null, 2)}
              </pre>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
