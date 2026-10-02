"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteIdea } from "@/lib/actions";
import { Button, LinkButton } from "./ui";

export function IdeaActions({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <LinkButton href={`/ideas/${id}/edit`} variant="primary" size="sm">
        <Pencil className="h-3.5 w-3.5" /> Edit
      </LinkButton>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (!confirm("Delete this idea, its scenarios and screenshots? This can't be undone.")) return;
          start(async () => {
            const res = await deleteIdea(id);
            if (!res.ok) return setError(res.error);
            router.push("/ideas");
          });
        }}
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>
      {error && (
        <span role="alert" className="text-xs text-loss">
          {error}
        </span>
      )}
    </>
  );
}
