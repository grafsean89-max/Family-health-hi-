Browser tests require Node.js, Playwright, and Chromium. They run the actual bundled Supabase SDK with fictional HTTP fixtures; they do not use a live Supabase project or prove server-side RLS policies.

From the repository root, start a static test server in one terminal:

```sh
python3 -m http.server 3000 --bind 127.0.0.1
```

In another terminal:

```sh
node tests/browser.cjs
node tests/session.cjs
```

Both tests intercept `/api/config` and Supabase requests. `CHROMIUM_PATH` can override the default `/usr/bin/chromium`. Install Playwright in your local development environment if it is not already available. A static server is sufficient for these tests only; running the real app requires its Vercel `/api/config` handler and existing Supabase configuration.

The session suite uses and deletes a temporary Chromium profile to test actual browser close/reopen, rather than merely simulating page reload. It covers refresh-token renewal, invalid refresh tokens, the loading gate, storage cleanup, cross-tab sign-out, and question/checklist restoration. The existing suite covers medication/calendar behavior and question mutations at phone and tablet widths.
