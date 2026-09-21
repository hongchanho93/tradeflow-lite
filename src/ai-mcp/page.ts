import { apiPageMarkup } from '../ai-api/page.ts';
/** Static trusted markup. External labels, replies and configuration are text. */
export function aiPageMarkup(closeIcon: string): string {
  return `<section id="ai-panel" class="ai-panel" role="tabpanel" aria-labelledby="ai-toggle" hidden>
    <header><strong>AI 工作台</strong><button id="ai-close" type="button" aria-label="关闭 AI 工作台">${closeIcon}</button></header>
    <div class="ai-page-scroll">
      ${apiPageMarkup()}
    </div>
  </section>`;
}
