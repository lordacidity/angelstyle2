import sharp from 'sharp';
const [,, src, out, left, top, w, h, scale] = process.argv;
let p = sharp(src).extract({ left:+left, top:+top, width:+w, height:+h });
if (scale && +scale !== 1) p = p.resize({ width: Math.round(+w * +scale) });
await p.png().toFile(out);
console.log('ok', out);
