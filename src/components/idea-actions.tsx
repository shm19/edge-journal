"use client";

import { Copy, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteIdea, duplicateIdea } from "@/lib/actions";
import { Button, LinkButton } from "./ui";

export function IdeaActions({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <LinkButton href={`/ideas/${id}/edit`} variant="primary" size="sm">
        <Pencil className="h-3.5 w-3.5" /> Edit
      </LinkButton>
      <Button
        size="sm"
        disabled={pending}
        title="Duplicate as a new idea (same setup, tags and levels, no exit)"
        onClick={() =>
          start(async () => {
            const res = await duplicateIdea(id);
            if (res.ok) router.push(`/ideas/${res.data!.id}/edit`);
          })
        }
      >
        <Copy className="h-3.5 w-3.5" /> Duplicate
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (!confirm("Delete this idea, its scenarios and screenshots? This can't be undone.")) return;
          start(async () => {
            await deleteIdea(id);
            router.push("/ideas");
          });
        }}
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>
    </>
  );
}
