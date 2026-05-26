import type { TextSpan, CarouselTextAlign } from '../../carouselTypes';

export function wrapTextOffsets(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): { line: string; offset: number }[] {
  const words = text.split(' ');
  const result: { line: string; offset: number }[] = [];
  let current = '';
  let currentStart = 0;
  let pos = 0;
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      result.push({ line: current, offset: currentStart });
      currentStart = pos;
      current = word;
    } else {
      current = test;
    }
    pos += word.length + 1;
  }
  if (current) result.push({ line: current, offset: currentStart });
  return result;
}

export function getLineSpanSegs(
  spans: TextSpan[],
  lineOffset: number,
  lineText: string,
): { text: string; color?: string; bold?: boolean; italic?: boolean }[] {
  const segs: { text: string; color?: string; bold?: boolean; italic?: boolean }[] = [];
  const lineEnd = lineOffset + lineText.length;
  let pos = 0;
  for (const span of spans) {
    const spanEnd = pos + span.text.length;
    const os = Math.max(pos, lineOffset);
    const oe = Math.min(spanEnd, lineEnd);
    if (os < oe) segs.push({ text: lineText.slice(os - lineOffset, oe - lineOffset), color: span.color, bold: span.bold, italic: span.italic });
    pos = spanEnd;
  }
  return segs.length > 0 ? segs : [{ text: lineText }];
}

export function drawSpanLine(
  ctx: CanvasRenderingContext2D,
  segs: { text: string; color?: string; bold?: boolean; italic?: boolean }[],
  y: number,
  align: CarouselTextAlign,
  padX: number, maxW: number, canvasW: number,
  fontCss: string, size: number, weight: number, italic: boolean,
  baseColor: string, lsPx: number, sc: number,
) {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(lsPx * sc).toFixed(2)}px`;
  let totalW = 0;
  for (const seg of segs) {
    const w = seg.bold ? Math.max(700, weight) : weight;
    const it = seg.italic ?? italic;
    ctx.font = `${it ? 'italic ' : ''}${w} ${size}px ${fontCss}`;
    totalW += ctx.measureText(seg.text).width;
  }
  const startX = align === 'center' ? (canvasW - totalW) / 2 : align === 'right' ? canvasW - padX - totalW : padX;
  let x = startX;
  ctx.textAlign = 'left';
  for (const seg of segs) {
    const w = seg.bold ? Math.max(700, weight) : weight;
    const it = seg.italic ?? italic;
    ctx.font = `${it ? 'italic ' : ''}${w} ${size}px ${fontCss}`;
    ctx.fillStyle = seg.color ?? baseColor;
    ctx.fillText(seg.text, x, y);
    x += ctx.measureText(seg.text).width;
  }
}

export function spansToHtml(spans: TextSpan[]): string {
  return spans.map(s => {
    const styles: string[] = [];
    if (s.color) styles.push(`color:${s.color}`);
    if (s.bold)  styles.push('font-weight:700');
    if (s.italic) styles.push('font-style:italic');
    const t = s.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    return styles.length > 0 ? `<span style="${styles.join(';')}">${t}</span>` : t;
  }).join('');
}

export function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return rgb;
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

export function htmlToSpans(el: HTMLElement): TextSpan[] {
  const list: TextSpan[] = [];
  function walk(node: Node, color?: string, bold?: boolean, italic?: boolean) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (!text) return;
      const s: TextSpan = { text };
      if (color)  s.color  = color;
      if (bold)   s.bold   = true;
      if (italic) s.italic = true;
      list.push(s);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as HTMLElement;
    if (e.tagName === 'BR') { list.push({ text: '\n' }); return; }
    const style = e.style;
    const rawC = style.color || (e.tagName === 'FONT' ? (e.getAttribute('color') ?? undefined) : undefined) || color;
    const c = rawC ? (rawC.startsWith('rgb') ? rgbToHex(rawC) : rawC) : undefined;
    const fw = parseInt(style.fontWeight || '0');
    const b  = (e.tagName === 'B' || e.tagName === 'STRONG' || fw >= 700 || style.fontWeight === 'bold') ? true : bold;
    const it = (e.tagName === 'I' || e.tagName === 'EM' || style.fontStyle === 'italic') ? true : italic;
    for (const child of Array.from(e.childNodes)) walk(child, c, b, it);
  }
  for (const child of Array.from(el.childNodes)) walk(child);
  const merged: TextSpan[] = [];
  for (const s of list) {
    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      if (prev.color === s.color && prev.bold === s.bold && prev.italic === s.italic) { prev.text += s.text; continue; }
    }
    merged.push({ ...s });
  }
  return merged;
}
