# Tour Rater

Phone-friendly static web app for Drew and Sherry to score houses
during tours against the move-2026 rubric. Submissions auto-commit
as JSON files to a public GitHub repo so the agent team (cleo) can
read and analyze them.

## Quick start (Drew)

1. **Create the repo.** On GitHub, create a public repo named
   `tour-rater` under `andrejo-msft`. (Public is required for
   GitHub Pages on a free account; the PAT is the gate, not the
   repo visibility.)

2. **Copy these files** to the repo root and push:
   - `index.html`
   - `app.js`
   - `rubric.js`
   - `styles.css`
   - `qrcode.js`
   - `properties.json`
   - `README.md` (this file)

3. **Enable GitHub Pages.** Settings -> Pages -> Source: Deploy from
   a branch -> Branch: `main`, Folder: `/ (root)`. Wait ~30 seconds
   for the green checkmark.

4. **Create a fine-grained PAT.**
   - GitHub -> Settings -> Developer settings -> Personal access
     tokens -> Fine-grained tokens -> Generate new token
   - Resource owner: `andrejo-msft`
   - Repository access: Only select repositories -> `tour-rater`
   - Permissions: Repository permissions -> **Contents: Read and write**
   - Expiration: 90 days (set a calendar reminder to rotate)
   - Copy the token. It will only be shown once.

5. **Open the site** at `https://andrejo-msft.github.io/tour-rater/`.
   - First load asks you to set a passphrase. Pick something you can
     text to Sherry.
   - Tap the gear icon -> enter PAT and `andrejo-msft/tour-rater`
     in the GitHub section -> Save.

## Pairing Sherry's phone

1. Drew opens Settings -> tap **Show pairing QR**.
2. Sherry opens the camera, points at the QR. The link auto-loads
   the site with PAT, repo, and passphrase hash baked in.
3. The site immediately strips the secret from the URL bar.
4. Sherry picks her name. Done.

The QR is a short-lived, in-person handoff. Don't screenshot it
into a chat.

## Using the app

1. Pick your name (Drew or Sherry) -- remembered after the first
   tap on this device.
2. Pick a property from the list, or type a new address and tap
   **Add property**.
3. Walk through the 6 category screens. For each criterion tap
   0 / 1 / 2 / 3 (absent / poor / adequate / excellent). Add a
   note if you want.
4. The progress pill at the bottom shows how many you have left
   in the current category.
5. On the Summary screen, add overall notes and tap **Submit
   rating**.

The status badge in the header shows what the app is doing:
- `idle` -- nothing in flight
- `saved` -- draft autosaved to your phone
- `queued` -- submission waiting (offline or PAT issue)
- `submitted` -- successfully pushed to GitHub
- `error` -- last submit failed; check the alert

If you tour with no signal, finish all your scoring; the app saves
everything. When you reconnect, queued ratings flush automatically.
You can also force a retry from Settings.

## How Cleo reads it

Each submission lands at:

```
ratings/<property-slug>/<rater>-<timestamp>.json
```

Cleo (or any agent) fetches via:

```
github-mcp-server-get_file_contents
  owner: andrejo-msft
  repo:  tour-rater
  path:  ratings/1008-grotto-st-n-st-paul/drew-2026-04-25T14-30-00--05-00.json
```

Each file includes `rubricVersion` and `appVersion` so old ratings
remain interpretable when the rubric evolves.

## Rubric versioning

The current rubric version is in `rubric.js` as `RUBRIC_VERSION`.
When criteria change:

1. Bump `RUBRIC_VERSION` (e.g. `2026-04-20-v1` -> `2026-05-15-v2`).
2. Old rating files keep their old `rubricVersion` -- don't rewrite them.
3. Cleo's analysis groups by version when comparing weighted totals.

## Data on the device

Stored in `localStorage` (cleared by **Clear all data** in Settings):

- `tr.passphraseHash` -- SHA-256 of the shared passphrase
- `tr.rater` -- which name was selected
- `tr.pat` -- GitHub PAT
- `tr.repo` -- owner/repo
- `tr.properties` -- user-added addresses
- `tr.draft.<slug>.<rater>` -- in-progress rating
- `tr.queue` -- submissions awaiting upload

## Tests

`node test.js` runs the headless test suite (rubric structure,
slugify, rating object shape, base64, setup-URL parsing,
properties.json validity).

## Files

| File             | Purpose                                       |
|------------------|-----------------------------------------------|
| `index.html`     | Page shell                                    |
| `app.js`         | All app logic (vanilla JS, no framework)      |
| `rubric.js`      | Rubric data + version                         |
| `styles.css`     | Mobile-first CSS                              |
| `qrcode.js`      | QR generator (Kazuhiko Arase, MIT)            |
| `properties.json`| Default address list                          |
| `test.js`        | Node-based smoke tests                        |

No CDN dependencies. Everything is local because the page handles
a PAT and we don't want a third-party script in the same origin.
