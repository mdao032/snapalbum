import { config } from "zod";

// In a browser Zod would probe `new Function` to compile faster validators.
// Under the site's Content-Security-Policy the browser reports that probe as a violation (S-004),
// and a native app has no use for it. The server keeps the compiled validators.
// This must run before any schema is created: every schema file imports this module first.
if ("document" in globalThis) config({ jitless: true });
