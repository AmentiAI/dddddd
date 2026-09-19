# Mystery Mint: The Hooded Order

Mint site for a 2,000-piece mystery NFT collection at $2 each. 1,750 whitelist spots. 5% creator fee. All profits go to The Future of The Order. It has a whitelist ("the Oath").
It needs Node 18.11 or newer.

## Try it locally

```bash
cd mystery-mint
npm run dev
```

Open http://localhost:3000. Click **Whitelist**, type an X username, and go through the Oath.
You can also type `sherwood` anywhere on the page to find the hidden clue.

## Deploy on Vercel

The site is in the `mystery-mint` subfolder of the repo, so Vercel has to be told where to look.

1. **Vercel -> your project -> Settings -> Build & Deployment -> Root Directory: `mystery-mint`.**
   Without this you get a 404, because the repo root holds no website.
2. **Add a database** (Vercel has no permanent disk, so file storage is wiped on every deploy).
   Storage -> Create Database -> Neon Postgres (free tier). Connect it to the project.
   It sets `DATABASE_URL` automatically; use the **pooled** connection string.
3. **Settings -> Environment Variables**, for all environments:
   - `SESSION_SECRET` - any long random string
   - `ADMIN_TOKEN` - your password for downloading the whitelist
   - `DATABASE_URL` - set by step 2
4. Redeploy. `public/` is served as the site, and `api/[...path].js` runs the whitelist API.
   Vercel's own URL works out of the box; `BASE_URL` is only needed for a custom domain.

## Deploy anywhere else (Render, Railway, Fly, a VPS)

`npm start` runs a normal Node server that also serves the files in `public/`.
Set the same environment variables. Without `DATABASE_URL` it saves to `data/whitelist.json`,
which then has to survive restarts.

## Get the whitelist

```
https://YOUR-DOMAIN/api/export.csv?token=YOUR_ADMIN_TOKEN
https://YOUR-DOMAIN/api/export.json?token=YOUR_ADMIN_TOKEN
```

(`/admin/export.csv` works too when you run the server yourself, but on Vercel only
paths under `/api/` reach the code.)

The export has each initiate's number, X handle, wallet, alias, email, how they found you,
and their answer. The rules are one oath per X username and one per wallet. Set `WHITELIST_CAP`
to stop accepting oaths after a set number.

## Customize

- `public/app.js`, the `CONFIG` block at the top: the mint date (starts the countdown),
  your project's X handle, and the supply.
- `public/index.html`: all the copy (lore, game, rites, FAQ).
- `public/style.css`: the palette variables are in `:root`.

## Tests

```bash
npm test
```
