import { createClient } from '@supabase/supabase-js';
import podcastsData from '../../../data/podcasts.json';

// Server-only: gebruikt de service_role key, mag NOOIT naar de browser.
const supabase = createClient(
  import.meta.env.SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET({ request }) {
  const url = new URL(request.url);
  const auth = request.headers.get('authorization');
  const secretFromQuery = url.searchParams.get('secret');
  const secret = import.meta.env.CRON_SECRET;

  const authorized = !secret || auth === `Bearer ${secret}` || secretFromQuery === secret;
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 });
  }

  const results = { created: [], updated: [], skipped: [], errors: [] };

  for (const p of podcastsData.podcasts) {
    if (!p.feed_url) {
      results.skipped.push(p.name);
      continue;
    }

    const { data: existing } = await supabase
      .from('podcasts')
      .select('id')
      .eq('slug', p.slug)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('podcasts')
        .update({
          name: p.name,
          feed_url: p.feed_url,
          is_active: p.active,
          min_duration_seconds: p.min_duration_seconds || null,
          ...(p.description ? { description: p.description } : {}),
        })
        .eq('id', existing.id);
      if (error) {
        results.errors.push({ name: p.name, error: error.message });
      } else {
        results.updated.push(p.name);
      }
    } else {
      const { error } = await supabase
        .from('podcasts')
        .insert({
          name: p.name,
          slug: p.slug,
          feed_url: p.feed_url,
          is_active: p.active,
          min_duration_seconds: p.min_duration_seconds || null,
          description: p.description || null,
        });
      if (error) {
        results.errors.push({ name: p.name, error: error.message });
      } else {
        results.created.push(p.name);
      }
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
