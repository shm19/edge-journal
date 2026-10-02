import { vi } from "vitest";

// Server-only Next APIs that have no meaning outside a request.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
