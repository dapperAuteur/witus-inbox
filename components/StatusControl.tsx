"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionStatus } from "@/components/StatusBadge";

const STATUSES: SubmissionStatus[] = ["new", "in_progress", "replied", "waiting", "closed"];
const LABELS: Record<SubmissionStatus, string> = {
  new: "New",
  in_progress: "In progress",
  replied: "Replied",
  waiting: "Waiting",
  closed: "Closed",
};

export function StatusControl({
  submissionId,
  current,
}: {
  submissionId: string;
  current: SubmissionStatus;
}) {
  const router = useRouter();
  const [value, setValue] = useState<SubmissionStatus>(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as SubmissionStatus;
    const previous = value;
    setValue(next);
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setValue(previous);
        setError("Could not update status. Please try again.");
      } else {
        router.refresh();
      }
    } catch {
      setValue(previous);
      setError("Could not update status. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <label htmlFor="submission-status" className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Status
      </label>
      <select
        id="submission-status"
        value={value}
        onChange={onChange}
        disabled={pending}
        aria-describedby={error ? "status-error" : undefined}
        className="block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {LABELS[s]}
          </option>
        ))}
      </select>
      {error ? (
        <p id="status-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
