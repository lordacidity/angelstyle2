import sharp from 'sharp';
const D = 'c:/Users/Optiplex 7080/Desktop/';
for (const f of ['people-magazine-logo-png_seeklogo-482902.png', 'IMDB_Logo_2016.svg.webp']) {
  const im = sharp(D + f);
  const md = await im.metadata();
  const st = await im.stats();
  console.log(f, md.width + 'x' + md.height, 'ch=' + md.channels, 'alpha=' + md.hasAlpha, 'bg=', st.channels.map(c => Math.round(c.mean)).join(','));
}
