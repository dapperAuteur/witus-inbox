"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The magic-link half of the sign-in page. Split out of app/auth/sign-in/page.tsx
 * unchanged when that page became a server component, so it can resolve the
 * ecosystem-SSO endpoints server-side (a client component must not read the raw
 * env). This is always available regardless of whether ecosystem SSO is wired
 * up — it is the path that cannot break.
 */
export function SignInForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const callbackUrl =
      new URLSearchParams(window.location.search).get("callbackUrl") ?? "/inbox";
    const result = await signIn("email", {
      email,
      callbackUrl,
      redirect: false,
    });
    if (result?.error) {
      setPending(false);
      setError("Could not start sign-in. Check the email address and try again.");
      return;
    }
    if (result?.url) {
      window.location.href = result.url;
      return;
    }
    window.location.href = "/auth/verify-request";
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          aria-describedby={error ? "sign-in-error" : undefined}
          aria-invalid={error ? true : undefined}
        />
      </div>

      {error ? (
        <p
          id="sign-in-error"
          role="alert"
          className="text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || email.length === 0} className="w-full">
        {pending ? "Sending link…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
