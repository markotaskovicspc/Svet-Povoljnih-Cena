import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({catalog:vi.fn()}));
vi.mock('@/lib/seo/catalog.server',()=>({getSeoCatalog:mocks.catalog}));
vi.mock('@/lib/cms/pages',()=>({getCmsSitemapState:async()=>null}));
vi.mock('@/lib/storefront/landing-pages',()=>({getPublishedLandingPagesForSitemap:async()=>[]}));
import sitemap from '@/app/sitemap';
beforeEach(()=>{mocks.catalog.mockResolvedValue({
 products:[{sku:'1',slug:'live',updatedAt:new Date(),collectionId:'c1',categories:[{category:{path:'/dom/lampe'}}]}],
 categories:[{path:'/dom'},{path:'/dom/lampe'},{path:'/dom/prazno'}],
 collections:[{id:'c1',slug:'live'},{id:'c2',slug:'empty'}],
});});
it('advertises real products and populated lists, excluding old import catalog',async()=>{
 const urls=(await sitemap()).map(e=>new URL(e.url).pathname);
 expect(urls).toContain('/p/live');
 expect(urls).toContain('/k/dom');
 expect(urls).toContain('/k/dom/lampe');
 expect(urls).toContain('/kolekcija/live');
 expect(urls).not.toContain('/k/dom/prazno');
 expect(urls).not.toContain('/kolekcija/empty');
 expect(urls).not.toContain('/svet-akcija');
});
it('keeps static content available when catalog lookup fails',async()=>{
 mocks.catalog.mockRejectedValue(new Error('DB offline'));
 const urls=(await sitemap()).map(e=>new URL(e.url).pathname);
 expect(urls).toContain('/kontakt');
 expect(urls).not.toContain('/p/live');
});
