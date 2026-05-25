-- 002_news_sources_v2.sql
-- Pop-culture curator refresh: drop TMZ (high volume, low signal — tabloid
-- bait that's off-brand for Pauv) and add wire-quality entertainment outlets
-- (THR, AP Entertainment) across the six pop-culture industries.
--
-- Idempotent: re-runnable. The DELETE only removes TMZ; the INSERT uses
-- ON CONFLICT DO NOTHING so prior runs don't double-insert.
--
-- Run with: npx tsx scripts/runMigration.ts migrations/002_news_sources_v2.sql

-- Drop TMZ from pop-culture industries.
delete from news_sources
where handle = 'TMZ'
  and industry in ('Actor','Comedian','Influencer','Podcaster','Youtuber','Commentator');

-- Add wire-quality entertainment curators across the same six industries.
insert into news_sources (industry, handle) values
  ('Actor',       'THR'),
  ('Actor',       'APEntertainment'),

  ('Comedian',    'THR'),
  ('Comedian',    'APEntertainment'),

  ('Influencer',  'THR'),
  ('Influencer',  'APEntertainment'),

  ('Podcaster',   'THR'),
  ('Podcaster',   'APEntertainment'),

  ('Youtuber',    'THR'),
  ('Youtuber',    'APEntertainment'),

  ('Commentator', 'THR'),
  ('Commentator', 'APEntertainment')
on conflict (industry, handle) do nothing;

-- The runMigration script will print the post-update summary so you can see
-- the seed state across all industries in one shot.
