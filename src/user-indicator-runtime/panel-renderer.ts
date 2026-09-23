import type { UserIndicatorPanelContent } from './output-protocol.ts';

export const USER_INDICATOR_PANEL_STYLES = `
:host {
  color: #d1d4dc;
  font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.tf-user-panel {
  box-sizing: border-box;
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  border: 1px solid rgba(120, 123, 134, .45);
  border-radius: 6px;
  background: rgba(17, 24, 39, .90);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .20);
}
.tf-user-panel__title {
  padding: 6px 8px;
  border-bottom: 1px solid rgba(120, 123, 134, .40);
  font-weight: 600;
  white-space: nowrap;
  overflow-wrap: normal;
}
.tf-user-panel table {
  border-collapse: collapse;
  width: max-content;
  max-width: none;
}
.tf-user-panel th,
.tf-user-panel td {
  padding: 4px 8px;
  border-right: 1px solid rgba(120, 123, 134, .32);
  border-bottom: 1px solid rgba(120, 123, 134, .32);
  white-space: nowrap;
  overflow-wrap: normal;
}
.tf-user-panel th:last-child,
.tf-user-panel td:last-child {
  border-right: 0;
}
.tf-user-panel tbody tr:last-child td {
  border-bottom: 0;
}
.tf-user-panel th {
  color: #aab2c0;
  font-weight: 500;
}
`;

export function renderUserIndicatorPanel(
  root: HTMLElement,
  content: Readonly<UserIndicatorPanelContent>,
): void {
  const documentValue = root.ownerDocument;
  const container = documentValue.createElement('div');
  container.className = 'tf-user-panel';

  if (content.title !== undefined) {
    const title = documentValue.createElement('div');
    title.className = 'tf-user-panel__title';
    title.textContent = content.title;
    container.append(title);
  }

  const table = documentValue.createElement('table');
  const head = documentValue.createElement('thead');
  const headRow = documentValue.createElement('tr');
  for (const column of content.columns) {
    const cell = documentValue.createElement('th');
    cell.scope = 'col';
    cell.textContent = column.title;
    cell.style.textAlign = column.align ?? 'left';
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);

  const body = documentValue.createElement('tbody');
  for (const row of content.rows) {
    const rowElement = documentValue.createElement('tr');
    for (let index = 0; index < row.cells.length; index += 1) {
      const cellValue = row.cells[index];
      const cell = documentValue.createElement('td');
      cell.textContent = cellValue.text;
      cell.style.textAlign = content.columns[index]?.align ?? 'left';
      if (cellValue.color !== undefined) cell.style.color = cellValue.color;
      rowElement.append(cell);
    }
    body.append(rowElement);
  }
  table.append(body);
  container.append(table);
  root.replaceChildren(container);
}
