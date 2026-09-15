export function setStatusLabel(status: HTMLButtonElement, text: string) {
  const visible = status.querySelector<HTMLSpanElement>('span');
  if (!visible) throw new Error('connection status is missing visible text');
  visible.textContent = text;
  status.setAttribute('aria-label', text);
  status.title = text;
}
