// Convert image-bearing snapshots at build time. Structured attrs avoid passing
// HTML-escaped query delimiters to the native rich-text image loader.
function documentNodes(main, origin) {
  if (!main.find('img').length) return main.html();
  function convert(node) {
    if (node.type === 'text') return { type: 'text', text: node.data };
    if (node.type !== 'tag') return null;
    const attrs = { ...node.attribs };
    if (node.name === 'img' && attrs.src) {
      const url = new URL(attrs.src, origin);
      if (url.origin === origin && url.pathname === '/_next/image') {
        url.searchParams.set('w', '1080');
        url.searchParams.set('q', '75');
      }
      attrs.src = url.href;
      attrs.style = 'display:block;width:100%;height:auto;margin:18px 0;';
    }
    return { name: node.name, attrs, children: (node.children || []).map(convert).filter(Boolean) };
  }
  return main.contents().toArray().map(convert).filter(Boolean);
}
module.exports = { documentNodes };
