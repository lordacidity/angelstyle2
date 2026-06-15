export const CANVAS_W = 1080;
export const CANVAS_H = 1350;
export const DISPLAY_SCALE = 0.38; // on-screen: ~410×513 (matches carousel preview)

export const PPT_W = 1600;
export const PPT_H = 1080;
// Match portrait display width: CANVAS_W * DISPLAY_SCALE = PPT_W * PPT_DISPLAY_SCALE → 1080*0.38/1600
export const PPT_DISPLAY_SCALE = 0.2565; // on-screen: ~410×277 — same width as portrait, taller due to narrower ratio
