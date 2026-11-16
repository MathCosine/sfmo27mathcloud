/**
 * Problem text: plain paragraphs with $inline$ and $$display$$ maths (also
 * \( \) and \[ \]), **bold**, *italic*, and images as ![alt](https://...).
 * Everything else is escaped, so problem text can never inject markup.
 */
import katex from 'katex';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function tex(src: string, display = false): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'html', maxExpand: 500, maxSize: 20 });
  } catch {
    return `<code>${esc(src)}</code>`;
  }
}

function inline(text: string): string {
  // Split out maths first so * and _ inside it are left alone.
  const out: string[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$((?:\\\$|[^$])+?)\$|\\\(([\s\S]+?)\\\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(styled(text.slice(last, m.index)));
    if (m[1] !== undefined || m[2] !== undefined) out.push(`<span class="math-display">${tex((m[1] ?? m[2]).trim(), true)}</span>`);
    else out.push(tex((m[3] ?? m[4]).trim()));
    last = re.lastIndex;
  }
  out.push(styled(text.slice(last)));
  return out.join('');
}

function styled(text: string): string {
  let s = esc(text);
  s = s.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+|data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)\)/g, (_, alt: string, url: string) => `<img class="rich-img" alt="${alt}" src="${url}" loading="lazy">`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

export function rich(text: string): string {
  const paragraphs = String(text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paragraphs.map((p) => `<p>${inline(p.trim())}</p>`).join('');
}
