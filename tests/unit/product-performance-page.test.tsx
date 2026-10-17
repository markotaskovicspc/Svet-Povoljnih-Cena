import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { calculateProductPerformance } from '@/lib/admin/product-performance';
import { resolveReportPeriod } from '@/lib/admin/report-period';
import { writeFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('@/lib/admin', () => ({ requireAdminAction: vi.fn() }));
vi.mock('@/lib/admin/product-performance.server', () => ({ getProductPerformance: mocks.report }));
import ProductPerformancePage from '@/app/admin/erp/performans-artikala/page';
it('renders the combined collapsed panel, scrollable table, and honest partial history summaries', async () => {
  const period = resolveReportPeriod({range: 'custom', from: '2026-10-01', to: '2026-10-02'});
  const known = calculateProductPerformance({id:'a', sku:'SKU-001', name:'Plafonjera sa veoma dugim nazivom artikla', stock:5, baseline:10, latestBalance:5, movements:[{at:'2026-10-01T22:00:00Z',qty:-5,balance:5}], costEvents:[{at:'2026-09-01T00:00:00Z',unitCost:100,source:'fiscal'}], purchasePrices:[], sales:[{day:'2026-10-02',qty:5,revenue:1000,cogs:500}]},period,new Date('2026-10-05T10:00:00Z'));
  const unknown = {...known,id:'b',sku:'SKU-002',name:'Artikal bez istorije', averageStockValue:null, completeCostHistory:false, valuationBasis:'missing', historyStatus:'incomplete-stock', cogs:9000};
  mocks.report.mockResolvedValue([known,unknown]);
  const html = renderToStaticMarkup(await ProductPerformancePage({searchParams:Promise.resolve({range:'custom',from:'2026-10-01',to:'2026-10-02'})}));
  const panel = html.slice(html.indexOf('<details'),html.indexOf('</details>'));
  expect(panel).toContain('name="range"');
  expect(panel).toContain('KOZ koristi istorijsku vrednost');
  expect(panel).not.toContain('<details open');
  expect(html).toContain('role="region"');
  expect(html).toContain('sticky top-0');
  expect(html).toContain('KOZ dokumentovanih artikala');
  expect(html).toContain('delimičan zbir poznatih vrednosti');
  expect(html).toContain('Nepotpuna istorija celog perioda');
  expect(html).toContain('Prosek kom po kalendarskom danu');
  if (process.env.PERFORMANCE_QA_HTML) {
    mocks.report.mockResolvedValue(Array.from({length:50},(_,i)=>({... (i%4===0 ? unknown : known),id:`item-${i}`,sku:`SKU-${String(i+1).padStart(3,'0')}`})));
    writeFileSync(process.env.PERFORMANCE_QA_HTML, renderToStaticMarkup(await ProductPerformancePage({searchParams:Promise.resolve({range:'custom',from:'2026-10-01',to:'2026-10-02'})})));
  }
});
