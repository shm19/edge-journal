"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="next" value={next} />
      <Field label="Password" htmlFor="password" error={state?.error}>
        <Input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
      </Field>
      <Button type="submit" variant="primary" className="w-full justify-center" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
