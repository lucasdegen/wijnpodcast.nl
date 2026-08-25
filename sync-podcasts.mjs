/**
 * Synchroniseert podcasts.json met de podcasts-tabel in Supabase.
 * Nieuwe podcasts (op basis van 'slug') worden aangemaakt, bestaande
 * worden bijgewerkt (naam, feed_url, actief/gestopt).
 *
 * Gebruik:
 *   set SUPABASE_URL=...
 *   set SUPABASE_SERVICE_ROLE_KEY=...
 *   node sync-podcasts.mjs
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY als env variabelen.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function run() {
  const raw = readFileSync('./src/data/podcasts.json', 'utf-8');
  const { podcasts } = JSON.parse(raw);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const p of podcasts) {
    if (!p.feed_url) {
      console.warn(`Overgeslagen (geen feed_url): ${p.name}`);
      skipped++;
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
        .update({ name: p.name, feed_url: p.feed_url, is_active: p.active })
        .eq('id', existing.id);
      if (error) {
        console.warn(`Fout bij bijwerken ${p.name}:`, error.message);
      } else {
        console.log(`↻ Bijgewerkt: ${p.name}`);
        updated++;
      }
    } else {
      const { error } = await supabase
        .from('podcasts')
        .insert({ name: p.name, slug: p.slug, feed_url: p.feed_url, is_active: p.active });
      if (error) {
        console.warn(`Fout bij aanmaken ${p.name}:`, error.message);
      } else {
        console.log(`+ Aangemaakt: ${p.name}`);
        created++;
      }
    }
  }

  console.log(`\nKlaar. Aangemaakt: ${created}, bijgewerkt: ${updated}, overgeslagen: ${skipped}`);
}

run().catch((e) => {
  console.error('Onverwachte fout:', e);
  process.exit(1);
});
