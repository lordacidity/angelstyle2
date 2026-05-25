-- 001_news_sources.sql
-- Curator handles to use as twitterapi.io `from:` sources, keyed by industry.
-- Strategy: search FROM curators (PopCrave, ShamsCharania, etc.) instead of
-- ABOUT public figures — curators pre-filter newsworthy content.
--
-- industry uses Pauv's exact `industries.singular` value (PascalCase) so the
-- caller can pass the talent's industry through directly with no mapping.
--
-- Run this in Railway's Query console (Database -> Data -> Query).
-- Re-runnable: ON CONFLICT DO NOTHING means re-applying with new rows is safe.

create table if not exists news_sources (
  industry text not null,
  handle   text not null,
  primary key (industry, handle)
);

insert into news_sources (industry, handle) values
  -- Athlete
  ('Athlete',     'ShamsCharania'),
  ('Athlete',     'AdamSchefter'),
  ('Athlete',     'JeffPassan'),
  ('Athlete',     'BleacherReport'),
  ('Athlete',     'TheAthletic'),
  ('Athlete',     'ESPN'),

  -- Politician
  ('Politician',  'AP'),
  ('Politician',  'Reuters'),
  ('Politician',  'axios'),
  ('Politician',  'nytpolitics'),
  ('Politician',  'politico'),

  -- Musician
  ('Musician',    'PopCrave'),
  ('Musician',    'PopBase'),
  ('Musician',    'PopHive'),
  ('Musician',    'ChartData'),
  ('Musician',    'DJAkademiks'),

  -- Pop-culture cluster (Actor / Comedian / Influencer / Podcaster / Youtuber / Commentator)
  ('Actor',       'PopCrave'),
  ('Actor',       'PageSix'),
  ('Actor',       'TMZ'),
  ('Actor',       'Variety'),
  ('Actor',       'DeadlineHollywood'),
  ('Actor',       'DefNoodles'),

  ('Comedian',    'PopCrave'),
  ('Comedian',    'PageSix'),
  ('Comedian',    'TMZ'),
  ('Comedian',    'Variety'),
  ('Comedian',    'DeadlineHollywood'),
  ('Comedian',    'DefNoodles'),

  ('Influencer',  'PopCrave'),
  ('Influencer',  'PageSix'),
  ('Influencer',  'TMZ'),
  ('Influencer',  'Variety'),
  ('Influencer',  'DeadlineHollywood'),
  ('Influencer',  'DefNoodles'),

  ('Podcaster',   'PopCrave'),
  ('Podcaster',   'PageSix'),
  ('Podcaster',   'TMZ'),
  ('Podcaster',   'Variety'),
  ('Podcaster',   'DeadlineHollywood'),
  ('Podcaster',   'DefNoodles'),

  ('Youtuber',    'PopCrave'),
  ('Youtuber',    'PageSix'),
  ('Youtuber',    'TMZ'),
  ('Youtuber',    'Variety'),
  ('Youtuber',    'DeadlineHollywood'),
  ('Youtuber',    'DefNoodles'),

  ('Commentator', 'PopCrave'),
  ('Commentator', 'PageSix'),
  ('Commentator', 'TMZ'),
  ('Commentator', 'Variety'),
  ('Commentator', 'DeadlineHollywood'),
  ('Commentator', 'DefNoodles'),

  -- Streamer / Gamer (gaming / Twitch / esports press)
  ('Streamer',    'IGN'),
  ('Streamer',    'Kotaku'),
  ('Streamer',    'Polygon'),
  ('Streamer',    'Dexerto'),
  ('Streamer',    'GameSpot'),

  ('Gamer',       'IGN'),
  ('Gamer',       'Kotaku'),
  ('Gamer',       'Polygon'),
  ('Gamer',       'Dexerto'),
  ('Gamer',       'GameSpot'),

  -- Entrepreneur (tech / business press)
  ('Entrepreneur','TechCrunch'),
  ('Entrepreneur','BloombergTech'),
  ('Entrepreneur','CNBC'),
  ('Entrepreneur','business'),         -- @business = Bloomberg main
  ('Entrepreneur','TheVerge'),

  -- Fitness (general sports press + fitness-specific)
  ('Fitness',     'ESPN'),
  ('Fitness',     'MensHealthMag'),    -- @MensHealthMag is the US Men's Health account
  ('Fitness',     'runnersworld')
on conflict (industry, handle) do nothing;

-- Sanity check (uncomment to view after insert):
-- select industry, count(*) as handles from news_sources group by industry order by industry;
