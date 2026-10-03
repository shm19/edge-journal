// Throwaway values for the e2e server only. They protect an empty temp DB on localhost:3300 and nothing else.
export const PORT = 3300;
export const BASE_URL = `http://localhost:${PORT}`;
export const PASSWORD = "e2e-throwaway-password-7f3a91";
export const SESSION_SECRET = "e2e-throwaway-session-secret-0123456789abcdefghijklmnop";
