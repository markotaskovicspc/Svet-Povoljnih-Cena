/** A shared label URL must not let one module read another workflow's labels. */
export function shipmentLabelPermissionModules(purpose: string): readonly string[] {
  if (purpose === "ORDER_DELIVERY") return ["/admin/erp/prodajni-nalozi", "/admin/erp/preuzimanja"];
  if (purpose === "RECLAMATION_RETURN" || purpose === "RECLAMATION_REPLACEMENT") return ["/admin/erp/reklamacije-dnevnik"];
  return [];
}
