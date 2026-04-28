"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ReplyComposer({
  submissionId,
  submitterEmail,
}: {
  submissionId: string;
  submitterEmail: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!submitterEmail) {
    return (
      <p className="text-sm text-slate-500">
        Reply unavailable. This submission has no submitter email.
      </p>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        if (res.status === 502) {
          setError("Email could not be sent. Mailgun rejected the request. Try again.");
        } else if (res.status === 422) {
          setError("No submitter email on file; reply not supported for this submission.");
        } else {
          setError("Reply failed. Please try again.");
        }
        setPending(false);
        return;
      }
      setBody("");
      router.refresh();
    } catch {
      setError("Reply failed. Please try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="reply-body" className="block text-sm font-medium">
          Reply to <span className="font-mono text-xs">{submitterEmail}</span>
        </label>
        <Textarea
          id="reply-body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={pending}
          required
          aria-describedby={error ? "reply-error" : undefined}
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error ? (
        <p id="reply-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={pending || body.trim().length === 0}>
          {pending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
