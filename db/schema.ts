import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  jsonb,
  primaryKey,
  integer,
} from "drizzle-orm/pg-core";
import type { AdapterAccount } from "next-auth/adapters";

export const submissionStatus = pgEnum("submission_status", [
  "new",
  "in_progress",
  "replied",
  "waiting",
  "closed",
]);

export const submissionPriority = pgEnum("submission_priority", [
  "normal",
  "high",
]);

export const receivedVia = pgEnum("received_via", [
  "webhook",
  "email",
  "manual",
]);

export const replyDirection = pgEnum("reply_direction", [
  "outbound",
  "inbound",
]);

export const submissions = pgTable("submission", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull(),
  formType: text("form_type").notNull(),
  submitterEmail: text("submitter_email"),
  submitterName: text("submitter_name"),
  payload: jsonb("payload").notNull(),
  status: submissionStatus("status").notNull().default("new"),
  priority: submissionPriority("priority").notNull().default("normal"),
  receivedVia: receivedVia("received_via").notNull().default("webhook"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  threadId: text("thread_id"),
});

export const replies = pgTable("reply", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  mailgunMessageId: text("mailgun_message_id"),
  direction: replyDirection("direction").notNull().default("outbound"),
  sentByEmail: text("sent_by_email"),
});

export const webhookSources = pgTable("webhook_source", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  hmacSecret: text("hmac_secret").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** NextAuth tables — standard @auth/drizzle-adapter shape. */
export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);
