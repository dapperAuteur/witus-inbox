import { Badge } from "@/components/ui/badge";

export type SubmissionStatus = "new" | "in_progress" | "replied" | "waiting" | "closed";

const statusTone: Record<SubmissionStatus, "slate" | "amber" | "emerald" | "sky" | "muted"> = {
  new: "sky",
  in_progress: "amber",
  replied: "emerald",
  waiting: "slate",
  closed: "muted",
};

const statusLabel: Record<SubmissionStatus, string> = {
  new: "New",
  in_progress: "In progress",
  replied: "Replied",
  waiting: "Waiting",
  closed: "Closed",
};

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  return <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>;
}
