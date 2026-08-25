-- ============================================================
-- wijnpodcast.nl — volledig databaseschema
-- Gereconstrueerd op basis van de werkende opzet van formule1podcast.nl
-- (waar de basistabellen destijds direct in de Supabase-editor zijn
-- aangemaakt en dus nergens als los .sql-bestand bestonden).
--
-- Plak dit hele bestand in: Supabase → SQL Editor → Run
-- ============================================================

-- --- Basistabellen -------------------------------------------------

create table if not exists podcasts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  feed_url text,
  image_url text,
  description text,
  is_active boolean not null default true,
  min_duration_seconds integer,
  created_at timestamptz not null default now()
);

create table if not exists episodes (
  id uuid primary key default gen_random_uuid(),
  podcast_id uuid not null references podcasts(id) on delete cascade,
  guid text not null,
  title text not null,
  slug text not null unique,
  content text,
  audio_url text,
  pub_date timestamptz,
  duration_seconds integer,
  chapters jsonb,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (podcast_id, guid)
);

create index if not exists episodes_podcast_id_idx on episodes(podcast_id);
create index if not exists episodes_pub_date_idx on episodes(pub_date desc);

-- Bewaart de vorige titel/tekst wanneer een aflevering later gewijzigd wordt
-- (bijvoorbeeld als een host een titel corrigeert na publicatie).
create table if not exists episode_revisions (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  old_title text,
  old_content text,
  created_at timestamptz not null default now()
);

-- --- Podcast-statistieken (eerste/laatste aflevering, aantal) ------

drop view if exists podcast_stats;

create view podcast_stats
with (security_invoker = true) as
select
  podcast_id,
  min(pub_date) as first_episode,
  max(pub_date) as last_episode,
  count(*) as episode_count
from episodes
group by podcast_id;

grant select on podcast_stats to anon, authenticated;

-- --- Nederlandse full-text search over titel + omschrijving --------

alter table episodes
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('dutch', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored;

create index if not exists episodes_search_idx on episodes using gin(search_vector);

-- --- RPC: jaren + aantal afleveringen per podcast (voor filters) ---

create or replace function get_podcast_years(podcast_slug text)
returns table (year int, episode_count bigint)
language sql
stable
as $$
  select
    extract(year from e.pub_date)::int as year,
    count(*) as episode_count
  from episodes e
  join podcasts p on p.id = e.podcast_id
  where p.slug = podcast_slug
  group by 1
  order by 1 desc;
$$;

-- --- Row Level Security: publiek leesbaar, schrijven alleen via ----
-- --- de service_role key (gebruikt door de cron/admin-endpoints)  ---

alter table podcasts enable row level security;
alter table episodes enable row level security;
alter table episode_revisions enable row level security;

drop policy if exists "Podcasts zijn publiek leesbaar" on podcasts;
create policy "Podcasts zijn publiek leesbaar" on podcasts
  for select using (true);

drop policy if exists "Afleveringen zijn publiek leesbaar" on episodes;
create policy "Afleveringen zijn publiek leesbaar" on episodes
  for select using (true);

-- episode_revisions bewust NIET publiek leesbaar (interne historie).
