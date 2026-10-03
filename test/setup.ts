import { vi } from "vitest";

// Server-only Next APIs that have no meaning outside a request.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
// Sessions are signed with a key derived from SESSION_SECRET + APP_PASSWORD, so tests that mint tokens need one.
process.env.APP_PASSWORD = "vitest-password-not-the-example";
