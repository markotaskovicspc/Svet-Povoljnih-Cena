import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DashboardReturnRate } from "@/components/admin/dashboard-return-rate";
it("shows the ratio and its unit-based definition", () => {
 const html=renderToStaticMarkup(<DashboardReturnRate summary={{sent:40,returned:3}} warehouseLabel="Svi magacini"/>);
 expect(html).toContain('7,5%'); expect(html).toContain('3 / 40 komada'); expect(html).toContain('Vraćeni komadi / poslati komadi');
});
it("distinguishes no recorded dispatches from a real zero return rate", () => {
 expect(renderToStaticMarkup(<DashboardReturnRate summary={{sent:0,returned:0}} warehouseLabel="DC"/>)).toContain('Nema evidentiranih slanja');
 expect(renderToStaticMarkup(<DashboardReturnRate summary={{sent:10,returned:0}} warehouseLabel="DC"/>)).toContain('>0%</p>');
});
