# ERP admin requirements matrix

The canonical matrix is maintained in
[`src/lib/admin/erp-requirements.ts`](../src/lib/admin/erp-requirements.ts) as an
internal engineering artifact. It is intentionally not exposed in the admin
panel.

- Source: `ERP finalllll.pages`
- Count: 67 substantive table-of-contents sections (`Uvod` defines the shared
  grid contract and is not a business section)
- Final statuses: `implemented` or `blocked_external`
- External blocks always contain the exact missing provider/configuration
  reason and must never report a placeholder request as successful
- Automated integrity check:
  `tests/unit/erp-requirements-matrix.test.ts`

The shared `Uvod` contract is implemented by the canonical ERP grid: typed
dynamic filters, sorting, database-backed per-admin views, visible-column
selection, column ordering/resizing, selection, confirmed destructive actions,
editable-column allow-lists, 100-row initial payload limit, and real filtered
XLSX exports.
