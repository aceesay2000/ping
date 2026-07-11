# Ping — deploy guide

This is a real, working PWA — no build step, no framework. Tested end-to-end
(the parsing pipeline was verified against a live call to Anthropic's API and
a mocked response; the only reason it won't run untouched is that it needs
*your* API key, added in step 3).

## What's here

```
index.html      the app shell
app.js          all the logic (state, rendering, storage, API calls)
manifest.json   makes it installable ("Add to Home Screen")
sw.js           offline app-shell caching
api/parse.js    the backend proxy — this is what talks to Claude, not the browser
icons/          app icons
```

Tasks and chat history save to the browser's own `localStorage` — nothing is
sent to a server except the raw text of what you type, and only for that one
parsing call.

## Deploy it (about 10 minutes)

1. **Create a free Vercel account** at vercel.com — sign in with GitHub is easiest.
2. **Get an Anthropic API key** at console.anthropic.com → API Keys → Create Key.
   (This is separate from your claude.ai login — it's a pay-as-you-go key for
   your own app. Parsing one task costs a small fraction of a cent.)
3. **Push this folder to a new GitHub repo** (or use the Vercel CLI to skip
   GitHub entirely — see option B below).
4. **Import the repo in Vercel** → New Project → select the repo → Deploy.
   Vercel auto-detects the `api/` folder as serverless functions; no config needed.
5. **Add your API key**: in the Vercel project → Settings → Environment
   Variables → add `ANTHROPIC_API_KEY` with the key from step 2 → Redeploy.
6. **Open the live URL** Vercel gives you, on your iPhone, in Safari.
7. **Add to Home Screen**: Share button → Add to Home Screen. It now opens
   full-screen, with its own icon, like a real app.

### Option B — skip GitHub, deploy from your terminal

If you'd rather not push to GitHub first:

```bash
npm install -g vercel
cd ping-pwa
vercel login
vercel --prod
```

Then add the `ANTHROPIC_API_KEY` environment variable the same way (Vercel
dashboard → your project → Settings → Environment Variables → redeploy).

## Before you send it to other people

- **Set a usage cap you're comfortable with.** `api/parse.js` has a
  `DAILY_LIMIT` per IP (default 60/day) — that's a soft speed bump, not a
  hard guarantee, since it resets on cold starts. Fine for a small test group;
  swap in a real counter (Upstash Redis is the easiest fit for Vercel) before
  a wider release.
- **Set a spending alert** in the Anthropic Console (Settings → Billing) so
  you find out immediately if usage spikes, not at the end of the month.
- **Say what it does with their words**, even in a one-line note when you
  share the link: what they type gets sent to Claude to turn into a task,
  nothing else is stored anywhere but their own phone.

## What you'll notice is different from native

No lock screen widget, no WidgetKit home screen widgets, no Siri Shortcut,
and no interactive notification buttons (Complete / Snooze 15m / Tonight) —
those need the native Xcode build. Everything else — the chat capture, the
Today/Upcoming/Done screens, the AI parsing, the checkmarks — works exactly
like the prototype you've been testing.
