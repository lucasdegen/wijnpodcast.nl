# Wijnpodcast.nl — backend-pakket (overgenomen van formule1podcast.nl)

Dit pakket bevat **alleen de techniek/logica** (database, RSS-import,
zoekfunctie), niet het ontwerp. Je bestaande v0-pagina's en styling in de
wijnpodcast.nl-repo blijven gewoon staan — dit voeg je ernaast toe.

## Wat te doen, stap voor stap

1. **Database opzetten**
   Open je nieuwe Supabase-project (`onnfablcjndsccbzwvqr`) → SQL Editor →
   plak de volledige inhoud van `schema.sql` → Run.

2. **Bestanden overzetten naar de wijnpodcast.nl-repo**
   Kopieer, met behoud van dezelfde mappenstructuur:
   - `src/lib/supabase.js`
   - `src/lib/format.js`
   - `src/pages/api/cron/import-episodes.js`
   - `src/pages/api/admin/sync-podcasts.js`
   - `src/data/podcasts.json`
   - `sync-podcasts.mjs` (in de root van de repo)
   - `vercel.json` (als er al een bestaat: voeg alleen het `crons`-blok toe
     aan het bestaande bestand, overschrijf 'm niet)

3. **`podcasts.json` invullen**
   Vervang het placeholder-blokje met de échte Nederlandse wijnpodcasts die
   je wilt volgen (naam, slug, RSS-feed-url). Zeg het als je wilt dat ik
   een startlijst voor je opzoek.

4. **Environment variables instellen in Vercel**
   Project → Settings → Environment Variables:
   - `SUPABASE_URL` = `https://onnfablcjndsccbzwvqr.supabase.co`
   - `SUPABASE_ANON_KEY` — uit Supabase → Project Settings → API
   - `SUPABASE_SERVICE_ROLE_KEY` — idem (geheim, nooit delen/committen)
   - `CRON_SECRET` — zelf een lange willekeurige tekst verzinnen (dus NIET
     de oude f1podcast-waarde hergebruiken)

5. **Podcasts + eerste afleveringen inladen**
   Na deployen, eenmalig aanroepen (bijv. via browser of curl):
   ```
   https://www.wijnpodcast.nl/api/admin/sync-podcasts?secret=JOUW_CRON_SECRET
   https://www.wijnpodcast.nl/api/cron/import-episodes?secret=JOUW_CRON_SECRET
   ```
   Daarna draait de cron (`vercel.json`) dit automatisch elke ochtend om 06:00.

6. **Koppel je bestaande v0-pagina's aan de echte data**
   Je huidige homepage/aflevering-pagina's tonen nu waarschijnlijk nog
   hardcoded voorbeeldcontent. Die moeten nog aangepast worden om
   `getLatestEpisodes()`, `getEpisodeBySlug()`, etc. uit `src/lib/supabase.js`
   te gebruiken in plaats van de placeholder-tekst. Stuur die pagina's
   (bv. `src/pages/index.astro`) door zodra je zover bent, dan help ik
   je die laatste koppeling te maken.

## Wat NIET is meegenomen (bewust)

- `src/lib/f1.js`, `src/lib/flags.js` — F1-specifiek (racekalender/vlaggen)
- Nieuws-gerelateerde tabellen/endpoints (`news_articles`, `nieuws.astro`,
  `sync-news-sources.js`) — alleen relevant als je ook wijnnieuws wilt
  aggregeren; laat het weten als je dat ook wilt.
- `migrate-thumbnails.mjs`, `fetch-podcast-images.mjs` — eenmalige
  opschoonscripts die specifiek written waren voor problemen in de
  f1podcast-data; pas nodig als je straks vergelijkbare datakwaliteitsissues
  tegenkomt.
