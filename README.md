# Field Notes

A dependency-free, offline-friendly flash-card site for studying a Babbel Review Manager vocabulary list. Decks and review history stay in the browser's local storage.

## Use it

1. Serve locally with `npm start` and open `http://localhost:4173`.
2. Open **Deck & data** and drag **Export Babbel words** to the browser's bookmarks bar.
3. Visit [Babbel Review Manager](https://my.babbel.com/review-manager/all) and click the bookmark. It returns to the first page and follows the paginator through the full list automatically.
4. Import the downloaded JSON under **Deck & data**.

The exporter reads each rendered page in the open Babbel tab and follows the paginator until it reaches the end. It does not read or transmit credentials. Because Babbel can change its page markup, verify the exported count and spot-check the JSON before importing it.

If the exporter reports that no rows were found after an app update, delete the old bookmark and drag the exporter to the bookmarks bar again. A bookmarklet contains a saved copy of the exporter and does not update automatically with the site.

To update the published default deck instead, replace the cards in `data/words.json` and push the change. A browser that has imported a custom deck keeps using its local deck; clearing site data returns it to the published default.

## Data formats

The native JSON format is:

```json
{
  "version": 1,
  "cards": [
    { "front": "hola", "back": "hello" }
  ]
}
```

Imports also accept a JSON array, or CSV/TSV text with prompt first and answer second. Each browser has its own imported deck and review history, allowing multiple people to use the same hosted URL independently.

Every answer is appended to a review history with the card, score, review time, chosen interval, and next due time. **Download all data** creates a readable JSON backup containing the deck, scheduling state, full response history, and settings. Import that backup to restore the same state in another browser or on another device. Browsers cannot silently overwrite a file on disk, so use this button whenever you want a fresh filesystem backup; the same data remains JSON-serialized in local storage between downloads.

## Scheduling

- **Needs practice:** 10 minutes
- **Knew it:** 3 days initially, then 2.4 times the previous interval, capped at 180 days

Due cards are ordered by how overdue they are. Unseen cards come first. **Study ahead** includes cards that are not due yet.

On mobile, reveal the answer and then swipe left for **Needs practice** or right for **Knew it**. The two buttons provide the same choices on desktop, with keyboard shortcuts `1` and `2`.

When phrase parsing is enabled, the app uses `Intl.Segmenter` to create unique word cards from multi-word prompts. Since a phrase export has no per-word translation, these cards reveal the phrase translation and show the original phrase as context.

## GitHub Pages

1. Create a GitHub repository and push this directory to its `main` branch.
2. In repository **Settings → Pages**, choose **GitHub Actions** as the source.
3. The included workflow deploys the site after each push to `main`.

On a phone, open the Pages URL and use **Add to Home Screen**. The service worker caches the app shell for offline study. Local decks and progress do not sync between devices; export the current deck and import it on another device when needed.

## Development

Run tests with `npm test`. No install step is required.
