import sharp from 'sharp';
const out = process.argv[2];
const a = await sharp('public/news/people.png').resize({ width: 300 }).extend({ top:10,bottom:10,left:10,right:10, background:'#fff' }).toBuffer();
const b = await sharp('public/news/imdb.png').resize({ width: 300 }).extend({ top:10,bottom:10,left:10,right:10, background:'#fff' }).toBuffer();
const am = await sharp(a).metadata(), bm = await sharp(b).metadata();
await sharp({ create: { width: 320, height: am.height + bm.height, channels: 3, background: '#ffffff' } })
  .composite([{ input: a, top: 0, left: 0 }, { input: b, top: am.height, left: 0 }]).png().toFile(out);
console.log('ok');
