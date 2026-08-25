import Parser from 'rss-parser';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

// Geeft deze route tot 60 seconden de tijd (Vercel's standaard is 10s),
// nodig omdat we meerdere RSS-feeds moeten uitlezen.
export const maxDuration = 60;

// Server-only: gebruikt de service_role key, mag NOOIT naar de browser.
const supabase = createClient(
  import.meta.env.SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY
);

const parser = new Parser({
  customFields: {
    item: [
      ['itunes:duration', 'duration'],
      ['media:content', 'mediaContent'],
      ['psc:chapters', 'pscChapters'],
      ['podcast:chapters', 'podcastChapters'],
    ],
  },
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; WijnpodcastBot/1.0; +https://www.wijnpodcast.nl)',
  },
});

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accenten weg
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 100) || 'aflevering';
}

/** Korte "vingerafdruk" van titel+tekst, zodat we bij het checken op
 * wijzigingen niet elke keer de volledige tekst hoeven op te halen en te
 * vergelijken. */
function hashContent(title, content) {
  return crypto.createHash('md5').update(`${title || ''}${content || ''}`).digest('hex');
}

/** PSC/Podlove-tijdnotatie ("00:05:12.500") om naar seconden. */
function pscTimeToSeconds(time) {
  if (!time) return null;
  const parts = String(time).split(':').map((p) => parseFloat(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  return parts[0];
}

/**
 * Haalt hoofdstukken op uit een item, in twee mogelijke formaten:
 * 1. Podlove Simple Chapters (psc:chapters), inline in de feed.
 * 2. Podcasting 2.0 (podcast:chapters), een losse JSON-url die we apart
 *    moeten ophalen.
 * Retourneert null als er geen hoofdstukken zijn, anders een array van
 * { start, title }.
 */
async function extractChapters(item) {
  const pscChapter = item.pscChapters?.chapter;
  if (pscChapter) {
    const list = Array.isArray(pscChapter) ? pscChapter : [pscChapter];
    const chapters = list
      .map((ch) => ({
        start: pscTimeToSeconds(ch?.$?.start),
        title: ch?.$?.title || '',
      }))
      .filter((ch) => ch.start !== null && ch.title);
    if (chapters.length) return chapters;
  }

  const chaptersUrl = item.podcastChapters?.$?.url;
  if (chaptersUrl) {
    try {
      const res = await fetch(chaptersUrl);
      if (res.ok) {
        const data = await res.json();
        const chapters = (data.chapters || [])
          .map((ch) => ({
            start: typeof ch.startTime === 'number' ? ch.startTime : null,
            title: ch.title || '',
          }))
          .filter((ch) => ch.start !== null && ch.title);
        if (chapters.length) return chapters;
      }
    } catch {
      // Geen probleem, gewoon zonder hoofdstukken doorgaan
    }
  }

  return null;
}

function parseDurationToSeconds(duration) {
  if (!duration) return null;
  const trimmed = String(duration).trim();

  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return null;

  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

async function importPodcast(podcast) {
  const result = { podcast: podcast.name, nieuw: 0, bijgewerkt: 0, ongewijzigd: 0, fouten: 0 };

  let feed;
  try {
    feed = await parser.parseURL(podcast.feed_url);
  } catch (e) {
    result.fouten++;
    result.error = `Kon feed niet ophalen: ${e.message}`;
    return result;
  }

  // Show-artwork uit de feed ophalen en bijwerken indien gewijzigd/leeg
  const feedImage = feed.image?.url || feed.itunes?.image || null;
  if (feedImage && feedImage !== podcast.image_url) {
    await supabase.from('podcasts').update({ image_url: feedImage }).eq('id', podcast.id);
  }

  // Omschrijving alleen aanvullen als 'm nog leeg is
  if (!podcast.description && feed.description) {
    await supabase.from('podcasts').update({ description: feed.description }).eq('id', podcast.id);
  }

  // --- Belangrijkste optimalisatie ---
  // In plaats van per aflevering een los "bestaat deze al?"-verzoek te doen,
  // halen we in ÉÉN keer alle guid's + hashes van deze podcast op, en
  // zoeken we daarna alles op in het geheugen.
  const { data: existingRows } = await supabase
    .from('episodes')
    .select('id, guid, title, audio_url, duration_seconds, content_hash')
    .eq('podcast_id', podcast.id);

  const byGuid = new Map();
  const byTitle = new Map();
  for (const row of existingRows || []) {
    byGuid.set(row.guid, row);
    byTitle.set(row.title, row);
  }

  const newRows = [];
  const guidUpdates = []; // { id, guid } — voor host-migratie-detectie
  const updates = []; // { id, payload }

  for (const item of feed.items) {
    try {
      const guid = item.guid || item.id || item.link;
      if (!guid) {
        result.fouten++;
        continue;
      }

      const title = item.title || '(zonder titel)';
      const content = item.content || item.contentSnippet || '';
      const rawAudioUrl = item.enclosure?.url || item.mediaContent?.['$']?.url || null;
      const audioUrl = rawAudioUrl ? rawAudioUrl.trim().split(/\s+/)[0] : null;
      const pubDate = item.isoDate || item.pubDate || null;
      const durationSeconds = parseDurationToSeconds(item.duration);
      const newHash = hashContent(title, content);

      if (podcast.min_duration_seconds) {
        if (durationSeconds === null || durationSeconds < podcast.min_duration_seconds) {
          result.te_kort = (result.te_kort || 0) + 1;
          continue;
        }
      }

      let existing = byGuid.get(guid);

      if (!existing) {
        // Guid niet gevonden — check op titel (podcast kan van hosting zijn
        // gewisseld, waardoor de guid veranderde)
        existing = byTitle.get(title);
        if (existing) {
          guidUpdates.push({ id: existing.id, guid });
        }
      }

      if (!existing) {
        const slug = slugify(`${title}-${podcast.id}-${Date.now().toString(36).slice(-4)}`);
        const chapters = await extractChapters(item);
        newRows.push({
          podcast_id: podcast.id,
          guid,
          title,
          slug,
          content,
          audio_url: audioUrl,
          pub_date: pubDate,
          duration_seconds: durationSeconds,
          chapters,
          content_hash: newHash,
        });
        result.nieuw++;
        continue;
      }

      const textChanged = existing.content_hash !== newHash;
      const audioChanged = audioUrl && existing.audio_url !== audioUrl;
      const durationMissing = existing.duration_seconds == null && durationSeconds !== null;

      if (!textChanged && !audioChanged && !durationMissing) {
        result.ongewijzigd++;
        continue;
      }

      const payload = { updated_at: new Date().toISOString() };
      if (textChanged) {
        payload.title = title;
        payload.content = content;
        payload.content_hash = newHash;
      }
      if (audioChanged) {
        payload.audio_url = audioUrl;
      }
      if (durationMissing) {
        payload.duration_seconds = durationSeconds;
      }

      updates.push({ id: existing.id, payload, textChanged, oldTitle: existing.title });
      result.bijgewerkt++;
    } catch {
      result.fouten++;
    }
  }

  // Alle nieuwe afleveringen in één keer wegschrijven
  if (newRows.length) {
    const { error } = await supabase.from('episodes').insert(newRows);
    if (error) {
      result.fouten += newRows.length;
      result.nieuw -= newRows.length;
    }
  }

  // Guid-correcties (host-migratie) apart, klein aantal, geen probleem
  for (const { id, guid } of guidUpdates) {
    await supabase.from('episodes').update({ guid }).eq('id', id);
  }

  // Revisies + updates.
  for (const { id, payload, textChanged } of updates) {
    if (textChanged) {
      await supabase.from('episode_revisions').insert({
        episode_id: id,
        old_title: null,
        old_content: null,
      });
    }
    const { error } = await supabase.from('episodes').update(payload).eq('id', id);
    if (error) {
      result.fouten++;
      result.bijgewerkt--;
    }
  }

  return result;
}

export async function GET({ request }) {
  const url = new URL(request.url);
  const auth = request.headers.get('authorization');
  const secretFromQuery = url.searchParams.get('secret');
  const secret = import.meta.env.CRON_SECRET;

  const authorized = !secret || auth === `Bearer ${secret}` || secretFromQuery === secret;
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 });
  }

  const podcastSlug = url.searchParams.get('podcast');

  let query = supabase
    .from('podcasts')
    .select('id, slug, name, feed_url, image_url, min_duration_seconds, description')
    .eq('is_active', true)
    .not('feed_url', 'is', null)
    .neq('feed_url', '');

  if (podcastSlug) {
    query = query.eq('slug', podcastSlug);
  }

  const { data: podcasts, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (podcastSlug && podcasts.length === 0) {
    return new Response(
      JSON.stringify({ error: `Geen actieve podcast gevonden met slug "${podcastSlug}"` }),
      { status: 404 }
    );
  }

  const results = await Promise.all(podcasts.map((podcast) => importPodcast(podcast)));

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
