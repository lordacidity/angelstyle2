import sharp from 'sharp';
const D = 'c:/Users/Optiplex 7080/Desktop/';
const OUT = 'public/news/';
// People: blue wordmark on white; trim the white margin, keep white behind it
// (the header it sits on is white).
const p = await sharp(D + 'people-magazine-logo-png_seeklogo-482902.png')
  .trim({ threshold: 12 }).png().toBuffer({ resolveWithObject: true });
console.log('people trimmed', p.info.width + 'x' + p.info.height);
await sharp(p.data).toFile(OUT + 'people.png');
// IMDb: the yellow box logo, alpha kept.
const i = await sharp(D + 'IMDB_Logo_2016.svg.webp').trim({ threshold: 5 }).png().toBuffer({ resolveWithObject: true });
console.log('imdb trimmed', i.info.width + 'x' + i.info.height);
await sharp(i.data).toFile(OUT + 'imdb.png');
