export function homePresentation(sections, products) {
  const product=products.find(item=>item.slug==='x1-air-white')||products[0]||null;
  const rendered=sections.map((section,index)=>({
    ...section,
    anchorId:'home-section-'+index,
    products:(section.productIds||[]).map(id=>products.find(item=>item.id===id)).filter(Boolean),
    heroImage:section.imageUrl||product?.image||'',
    // A product photograph must retain its full composition, including the garment.
    heroImageMode:section.imageUrl?'widthFix':'aspectFit',
    shoppingAction:section.action?.pageKey==='shop' && !section.action.query,
  }));
  const introduction=rendered.find(section=>section.layout==='fitPair')
    ||rendered.find(section=>section.type==='contentGrid' && section.items?.length)
    ||rendered.find(section=>section.type==='productGrid')
    ||rendered[0];
  return {product,sections:rendered,introductionAnchor:introduction?.anchorId||''};
}
