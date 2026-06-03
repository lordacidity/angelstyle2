-- =============================================================================
-- Carousel Templates Schema
-- =============================================================================
-- Two-table design mirrors the brand_kit / brand_kit_logos pattern:
--   carousel_templates  — one row per user (the container)
--   carousel_slides     — three rows per template (main / supporting_1 / supporting_2)
--
-- Run this in the Supabase SQL editor.
-- The set_updated_at() function is created with CREATE OR REPLACE so it is safe
-- to run even if brand_kit already created it.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- carousel_templates
-- -----------------------------------------------------------------------------
CREATE TABLE public.carousel_templates (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carousel_templates_pkey         PRIMARY KEY (id),
  CONSTRAINT carousel_templates_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);


-- -----------------------------------------------------------------------------
-- carousel_slides
-- -----------------------------------------------------------------------------
-- JSONB column shapes
-- -------------------
-- shadow columns  (logo_shadow, headline_shadow, sub_shadow, quote_shadow):
--   {
--     "enabled": bool,  "color": "#000000",
--     "blur": 16,       "offsetX": 0,  "offsetY": 6,
--     "opacity": 60,    "lift": 0
--   }
--
-- tag_slots  (3 entries — index = slot position 0-2):
--   [ { "text": "BREAKING", "style": { ...TagStyle } } | null, ... ]
--
--   TagStyle keys:
--     bgColor, bgOpacity, borderColor, borderWidth, borderOpacity,
--     cornerRadius, textColor, fontSize, fontWeight, italic, fontLabel,
--     paddingX, paddingY, letterSpacing, textCase,
--     shadow (optional ShadowStyle)
--
-- tag_zone_slots  (9 entries — index = row*3 + zone):
--   same shape as tag_slots
--
-- quote_slots  (3 entries):
--   [ "curly-open" | null, ... ]   -- styleId strings from QUOTE_STYLES
--
-- quote_zone_slots  (9 entries):
--   same shape as quote_slots
--
-- zone_logo_slots  (9 entries — index = row*3 + zone):
--   [ "https://…/logo-a.png" | null, ... ]
--   stores the exact logo URL that was dropped — null = empty slot
--
-- logo_row_slots  (3 entries — index = row 0-2):
--   [ "https://…/logo-b.png" | null, ... ]
--   stores the exact logo URL dropped into the full-width row slot — null = empty
--
-- swipe_zone_slots  (9 entries):
--   [
--     {
--       "text": "SWIPE",     "allCaps": true,
--       "fontLabel": "Inter", "fontWeight": 700,
--       "fontSize": 22,      "textColor": "#ffffff",  "letterSpacing": 3,
--       "arrowType": "line", "arrowLength": 55,
--       "arrowColor": "#ffffff", "arrowWeight": 2,    "arrowHeadSize": 10,
--       "direction": "right", "layout": "text-arrow",
--       "gap": 12,           "opacity": 100,
--       "shadow": null | ShadowStyle
--     } | null,
--     ...
--   ]
--
-- divider_slots  (3 entries):
--   [ "logo-left-fade" | null, ... ]   -- divider id strings
--
-- divider_sub_slots  (3 entries — content embedded inside a divider):
--   [
--     { "type": "tag",   "text": "ALERT", "style": { ...TagStyle }  }
--   | { "type": "swipe", "style": { ...SwipeStyle }                 }
--   | null,
--     ...
--   ]
--   Note: "type": "image" entries are stripped to null on save (blob URLs are ephemeral)
--
-- divider_settings  (3 entries — per-slot visual overrides):
--   [
--     {
--       "lineColor": "#ffffff", "lineOpacity": 55,   "lineWeight": 2,
--       "dashLen": 28,          "dashGap": 20,
--       "dotSize": 3,           "dotSpacing": 18,
--       "doubleSpacing": 8,     "tripleSpacing": 10, "centerWeight": 5,
--       "dotRadius": 8,         "dotGap": 20,
--       "taperHeight": 25,      "shortLength": 33,   "waveAmplitude": 18,
--       "bracketWidth": 24,     "bracketMargin": 30,
--       "contentGap": 20,       "fadeSpread": 30,
--       "shadow": ShadowStyle | null
--     } | null,
--     ...
--   ]
--
-- headline_spans / sub_spans:
--   [ { "text": "hello", "color": "#ff0000", "bold": true, "italic": false } ]
--   | null
--
-- default_tag_style  (tagStyle — the starting style copied onto every new dragged tag):
--   { ...TagStyle }   same shape as tag_slots[n].style
-- -----------------------------------------------------------------------------
CREATE TABLE public.carousel_slides (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  slide_type  text NOT NULL CHECK (slide_type IN ('main', 'supporting_1', 'supporting_2')),

  -- Text content (image is ephemeral client state — not stored)
  headline    text NOT NULL DEFAULT '',
  subheadline text NOT NULL DEFAULT '',

  -- ── Logo ──────────────────────────────────────────────────────────────────
  logo_opacity       integer NOT NULL DEFAULT 100 CHECK (logo_opacity       BETWEEN 0 AND 100),
  logo_scale         integer NOT NULL DEFAULT 100 CHECK (logo_scale         BETWEEN 10 AND 200),
  logo_corner_radius integer NOT NULL DEFAULT 0   CHECK (logo_corner_radius >= 0),
  logo_shadow        jsonb,                        -- ShadowStyle | null
  logo_slot_aligns   text[]  NOT NULL DEFAULT ARRAY['center','center','center'],

  -- ── Layout ────────────────────────────────────────────────────────────────
  head_sub_gap    integer NOT NULL DEFAULT 20,
  above_logo_gap  integer NOT NULL DEFAULT 8,
  content_padding integer NOT NULL DEFAULT 50,

  -- ── Fade ──────────────────────────────────────────────────────────────────
  show_fade          boolean NOT NULL DEFAULT true,
  fade_floor         integer NOT NULL DEFAULT 20,
  fade_reach         integer NOT NULL DEFAULT 40,
  fade_intensity     integer NOT NULL DEFAULT 85,
  show_top_fade      boolean NOT NULL DEFAULT false,
  top_fade_floor     integer NOT NULL DEFAULT 20,
  top_fade_reach     integer NOT NULL DEFAULT 40,
  top_fade_intensity integer NOT NULL DEFAULT 85,

  -- ── Background ────────────────────────────────────────────────────────────
  bg_blur_enabled  boolean NOT NULL DEFAULT false,
  bg_blur_amount   integer NOT NULL DEFAULT 10,
  bg_darken_amount integer NOT NULL DEFAULT 0,

  -- ── Headline typography ───────────────────────────────────────────────────
  headline_color  text    NOT NULL DEFAULT '#ffffff',
  font_size       integer NOT NULL DEFAULT 68,
  l_spacing       integer NOT NULL DEFAULT 0,
  l_height        integer NOT NULL DEFAULT 15,
  font_label      text    NOT NULL DEFAULT 'Inter',
  font_weight     integer NOT NULL DEFAULT 700,
  italic          boolean NOT NULL DEFAULT false,
  text_align      text    NOT NULL DEFAULT 'left'
                  CHECK (text_align IN ('left','center','right','justify')),
  all_caps        boolean NOT NULL DEFAULT false,
  headline_shadow jsonb   DEFAULT NULL,            -- ShadowStyle | null
  headline_spans  jsonb   DEFAULT NULL,            -- TextSpan[]  | null

  -- ── Sub-headline typography ───────────────────────────────────────────────
  subheadline_color text    NOT NULL DEFAULT '#ffffff',
  sub_font_size     integer NOT NULL DEFAULT 32,
  sub_l_spacing     integer NOT NULL DEFAULT 0,
  sub_l_height      integer NOT NULL DEFAULT 10,
  sub_font_label    text    NOT NULL DEFAULT 'Inter',
  sub_font_weight   integer NOT NULL DEFAULT 400,
  sub_italic        boolean NOT NULL DEFAULT false,
  sub_text_align    text    NOT NULL DEFAULT 'left'
                    CHECK (sub_text_align IN ('left','center','right','justify')),
  sub_all_caps      boolean NOT NULL DEFAULT false,
  sub_shadow        jsonb   DEFAULT NULL,          -- ShadowStyle | null
  sub_spans         jsonb   DEFAULT NULL,          -- TextSpan[]  | null

  -- ── Circle 1 ──────────────────────────────────────────────────────────────
  circle_border_color    text    NOT NULL DEFAULT '#ffffff',
  circle_border_width    integer NOT NULL DEFAULT 10,
  circle_border_opacity  integer NOT NULL DEFAULT 100,
  circle_shadow_enabled  boolean NOT NULL DEFAULT false,
  circle_shadow_blur     integer NOT NULL DEFAULT 20,
  circle_shadow_offset_x integer NOT NULL DEFAULT 0,
  circle_shadow_offset_y integer NOT NULL DEFAULT 8,
  circle_shadow_color    text    NOT NULL DEFAULT '#000000',
  circle_shadow_opacity  integer NOT NULL DEFAULT 50,
  circle_lift            integer NOT NULL DEFAULT 0,

  -- ── Circle 2 ──────────────────────────────────────────────────────────────
  circle2_border_color    text    NOT NULL DEFAULT '#ffffff',
  circle2_border_width    integer NOT NULL DEFAULT 10,
  circle2_border_opacity  integer NOT NULL DEFAULT 100,
  circle2_shadow_enabled  boolean NOT NULL DEFAULT false,
  circle2_shadow_blur     integer NOT NULL DEFAULT 20,
  circle2_shadow_offset_x integer NOT NULL DEFAULT 0,
  circle2_shadow_offset_y integer NOT NULL DEFAULT 8,
  circle2_shadow_color    text    NOT NULL DEFAULT '#000000',
  circle2_shadow_opacity  integer NOT NULL DEFAULT 50,
  circle2_lift            integer NOT NULL DEFAULT 0,

  -- ── Layer order ───────────────────────────────────────────────────────────
  layer_order text[] NOT NULL DEFAULT ARRAY['background','circle','circle2','subject'],

  -- ── Quotes shared style ───────────────────────────────────────────────────
  quote_color   text    NOT NULL DEFAULT '#ffffff',
  quote_size    integer NOT NULL DEFAULT 120,
  quote_opacity integer NOT NULL DEFAULT 100,
  quote_gap     integer NOT NULL DEFAULT 8,
  quote_shadow  jsonb   DEFAULT NULL,              -- ShadowStyle | null

  -- ── Default tag style (tagStyle — seed applied to newly dragged tags) ───────
  default_tag_style jsonb DEFAULT NULL,              -- TagStyle | null (null = use client default)

  -- ── Slot arrays (JSONB — see column shape notes above) ────────────────────
  tag_slots         jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  tag_slot_aligns   text[] NOT NULL DEFAULT ARRAY['center','center','center'],
  tag_zone_slots    jsonb NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb,
  quote_slots       jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  quote_zone_slots  jsonb NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb,
  zone_logo_slots   jsonb NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb,
  logo_row_slots    jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  swipe_zone_slots  jsonb NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb,
  divider_slots     jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  divider_sub_slots jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  divider_settings  jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carousel_slides_pkey            PRIMARY KEY (id),
  CONSTRAINT carousel_slides_template_fkey   FOREIGN KEY (template_id)
    REFERENCES public.carousel_templates(id) ON DELETE CASCADE,
  CONSTRAINT carousel_slides_unique_per_type UNIQUE (template_id, slide_type)
);


-- -----------------------------------------------------------------------------
-- updated_at trigger
-- CREATE OR REPLACE is safe to run even if brand_kit already created this
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_carousel_templates_updated_at
  BEFORE UPDATE ON public.carousel_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_carousel_slides_updated_at
  BEFORE UPDATE ON public.carousel_slides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.carousel_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carousel_slides    ENABLE ROW LEVEL SECURITY;

-- carousel_templates: owner only
CREATE POLICY "owner select" ON public.carousel_templates
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "owner insert" ON public.carousel_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner update" ON public.carousel_templates
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "owner delete" ON public.carousel_templates
  FOR DELETE USING (auth.uid() = user_id);

-- carousel_slides: owner only (via template join)
CREATE POLICY "owner select" ON public.carousel_slides
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.carousel_templates t
      WHERE t.id = template_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "owner insert" ON public.carousel_slides
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.carousel_templates t
      WHERE t.id = template_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "owner update" ON public.carousel_slides
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.carousel_templates t
      WHERE t.id = template_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "owner delete" ON public.carousel_slides
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.carousel_templates t
      WHERE t.id = template_id AND t.user_id = auth.uid()
    )
  );


-- -----------------------------------------------------------------------------
-- Grant Data API access
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carousel_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carousel_slides    TO authenticated;


-- =============================================================================
-- MIGRATION — run these if the table already exists from a previous version
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent
-- =============================================================================

-- v2: logo_row_slots stores the logo URL per row slot (null = empty)
--     zone_logo_slots stores the logo URL per zone (null = empty)
--     Both changed from boolean to string | null so multiple logos are preserved exactly
ALTER TABLE public.carousel_slides
  ADD COLUMN IF NOT EXISTS logo_row_slots jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb;

ALTER TABLE public.carousel_slides
  ALTER COLUMN zone_logo_slots SET DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb;

-- Migrate existing boolean values to null (false → null, true is impossible since no URL was stored)
UPDATE public.carousel_slides
  SET zone_logo_slots = '[null,null,null,null,null,null,null,null,null]'::jsonb
  WHERE zone_logo_slots::text LIKE '%false%'
     OR zone_logo_slots::text LIKE '%true%';
