import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Haalt de nieuwste afleveringen op, met podcastnaam erbij. */
export async function getLatestEpisodes(limit = 24) {
  const { data, error } = await supabase
    .from('episodes')
    .select('id, title, slug, pub_date, audio_url, duration_seconds, podcasts(name, slug, image_url)')
    .order('pub_date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

/** Eén aflevering op basis van de slug, met podcastinfo. */
export async function getEpisodeBySlug(slug) {
  const { data, error } = await supabase
    .from('episodes')
    .select('id, title, slug, content, audio_url, pub_date, duration_seconds, chapters, podcasts(name, slug, image_url)')
    .eq('slug', slug)
    .single();

  if (error) return null;
  return data;
}

/** Doorzoekt alle afleveringen op titel + omschrijving (Nederlandse taalregels). */
export async function searchEpisodes(query, limit = 60) {
  if (!query || !query.trim()) return [];

  const { data, error } = await supabase
    .from('episodes')
    .select('id, title, slug, pub_date, duration_seconds, podcasts(name, slug, image_url)')
    .textSearch('search_vector', query, { type: 'websearch', config: 'dutch' })
    .order('pub_date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

export async function getPodcasts() {
  const { data, error } = await supabase
    .from('podcasts')
    .select('id, name, slug, image_url, description')
    .order('name');

  if (error) throw error;
  return data;
}

/** Alle podcasts met aantal afleveringen + datum eerste/laatste aflevering. */
export async function getPodcastsWithCounts() {
  const [{ data: podcasts, error: pErr }, { data: stats, error: sErr }] = await Promise.all([
    supabase.from('podcasts').select('id, name, slug, image_url').order('name'),
    supabase.from('podcast_stats').select('podcast_id, first_episode, last_episode, episode_count'),
  ]);

  if (pErr) throw pErr;
  if (sErr) throw sErr;

  const statsMap = new Map(stats.map((s) => [s.podcast_id, s]));

  return podcasts.map((p) => {
    const s = statsMap.get(p.id);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      image_url: p.image_url,
      episodeCount: s?.episode_count ?? 0,
      firstEpisode: s?.first_episode ?? null,
      lastEpisode: s?.last_episode ?? null,
    };
  });
}

/** Alle jaren waarin een podcast afleveringen heeft, met aantal per jaar
 * (lichtgewicht: haalt alleen de datums op, niet de volledige afleveringen). */
export async function getPodcastYears(podcastSlug) {
  const { data, error } = await supabase.rpc('get_podcast_years', { podcast_slug: podcastSlug });
  if (error) throw error;
  return data.map((row) => ({ year: row.year, count: row.episode_count }));
}

/** Afleveringen van één podcast, gepagineerd en optioneel gefilterd op jaar. */
export async function getEpisodesByPodcastPage(podcastSlug, { year, page = 1, pageSize = 8 } = {}) {
  let query = supabase
    .from('episodes')
    .select('id, title, slug, pub_date, duration_seconds, podcasts!inner(name, slug, image_url)', {
      count: 'exact',
    })
    .eq('podcasts.slug', podcastSlug);

  if (year) {
    query = query.gte('pub_date', `${year}-01-01`).lt('pub_date', `${year + 1}-01-01`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order('pub_date', { ascending: false })
    .range(from, to);

  if (error) throw error;

  return {
    episodes: data,
    totalCount: count || 0,
    totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
  };
}
