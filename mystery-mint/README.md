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

## Go live

1. `cp .env.example .env` and fill in `BASE_URL`, `SESSION_SECRET` and `ADMIN_TOKEN`.
2. `npm start`. Host it anywhere that runs Node, such as Railway, Render, Fly.io or a VPS.
   Put it behind HTTPS. The `data/` folder must persist between deploys unless `DATABASE_URL` is set.

## Get the whitelist

```
https://YOUR-DOMAIN/admin/export.csv?token=YOUR_ADMIN_TOKEN
https://YOUR-DOMAIN/admin/export.json?token=YOUR_ADMIN_TOKEN
```

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
