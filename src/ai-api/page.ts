import { userDataPageMarkup } from '../user-data/page.ts';
import { userTaskPageMarkup } from '../user-task/page.ts';

export function apiPageMarkup(): string {
  return `<section id="ai-api-root" aria-label="内置 AI 对话">
    <section id="api-chat-page" class="api-chat-page" aria-label="对话">
      <div class="api-chat-header">
        <span id="api-model-label" class="api-model-label ai-external-text">尚未连接 AI</span>
        <div class="api-header-actions"><button id="api-task-open" type="button" aria-controls="user-task-page" hidden tabindex="-1">任务</button><button id="api-history-open" type="button" aria-controls="api-history-page">历史</button><button id="api-new-chat" type="button" title="新建会话">新对话</button><button id="api-settings-open" type="button" aria-controls="api-settings-page">设置</button></div>
      </div>
      <div id="api-transcript" class="api-transcript" aria-label="对话记录" tabindex="0">
        <div id="api-empty" class="api-empty"><strong>有什么需要我帮你分析？</strong><p id="api-empty-hint">连接你的 AI 服务后，即可开始对话。</p><button id="api-connect" type="button">连接 AI</button></div>
        <div id="api-messages" class="ai-external-text"></div>
      </div>
      <div id="api-approvals" aria-label="待确认的图表操作"></div>
      <div class="api-composer">
        <div class="api-feedback"><p id="api-run-status" class="ai-status" role="status" aria-live="polite"></p><button id="api-resume" type="button" hidden>继续本次任务</button><button id="api-error-settings" type="button" hidden>检查设置</button></div>
        <label for="api-prompt" class="api-sr-only">消息</label><textarea id="api-prompt" rows="3" maxlength="16000" placeholder="发送消息，或描述你想分析的问题…" spellcheck="false"></textarea>
        <div class="api-composer-actions">
          <button id="api-cancel" type="button" hidden>停止</button><button id="api-send" type="button" disabled>发送</button>
        </div>
        <p class="api-input-hint">Enter 发送 · Shift + Enter 换行</p>
      </div>
    </section>
    <section id="api-history-page" class="api-settings-page" aria-label="历史对话" hidden>
      <div class="api-settings-header"><button id="api-history-back" type="button">返回对话</button><strong>历史对话</strong></div>
      <p class="ai-notice">历史对话保存在本机。重新打开历史后会重新绑定当前图表，不恢复旧图表权限，也不会自动重放以前的工具操作。</p>
      <div id="api-history-list" class="api-history-list" tabindex="0"></div>
      <p id="api-history-empty" class="ai-notice">暂无历史对话</p>
    </section>
    <section id="api-settings-page" class="api-settings-page" aria-label="AI 设置" hidden>
      <div class="api-settings-header"><button id="api-settings-back" type="button">返回对话</button><strong>AI 设置</strong></div>
      <p class="ai-notice">选择服务商，填写模型和 API Key。连接细节会自动填写。</p>
      <form id="api-config-form" autocomplete="off">
        <label for="api-preset">服务商</label><select id="api-preset"><option value="deepseek">DeepSeek</option><option value="openai-responses">OpenAI</option><option value="anthropic">Anthropic / Claude</option><option value="qwen">通义千问</option><option value="custom">自定义服务</option></select>
        <label for="api-model">模型</label><input id="api-model" required maxlength="128" list="api-model-options" placeholder="填写服务商提供的模型 ID" spellcheck="false" /><datalist id="api-model-options"></datalist>
        <label for="api-key">API Key</label><input id="api-key" type="password" autocomplete="new-password" maxlength="2048" placeholder="粘贴 API Key；已连接时留空可保留" />
        <details id="api-settings"><summary>高级设置</summary>
          <label for="api-protocol">API 协议</label><select id="api-protocol"><option value="chat">Chat Completions 兼容</option><option value="responses">OpenAI Responses</option><option value="anthropic">Anthropic Messages 兼容</option></select>
          <label for="api-endpoint">完整请求地址（POST）</label><input id="api-endpoint" type="url" required placeholder="https://服务地址/v1/chat/completions" spellcheck="false" />
          <label class="api-check"><input id="api-no-key" type="checkbox" />此服务不需要 Key</label>
          <label class="api-check"><input id="api-stream" type="checkbox" checked />流式回复</label>
          <label class="api-check"><input id="api-usage" type="checkbox" checked />请求流式用量统计（Chat 协议）</label>
          <label for="api-token-field">Chat 输出上限字段</label><select id="api-token-field"><option value="max_tokens">max_tokens（多数兼容服务）</option><option value="max_completion_tokens">max_completion_tokens（OpenAI）</option></select>
          <label for="api-max-tokens">单次输出 Token 上限</label><input id="api-max-tokens" type="number" min="128" max="1000000" value="16384" />
          <label for="api-timeout">连续无响应超时（秒）</label><input id="api-timeout" type="number" min="15" max="3600" value="300" />
          <p class="ai-notice">持续收到数据不会因空闲超时被打断；异常卡死的单次网络请求仍有 2 小时进程保护时限。</p>
          <label class="api-check"><input id="api-local-http" type="checkbox" />允许本机或内网 IP 的明文 HTTP</label>
          <p class="ai-notice">明文 HTTP 不加密数据和 Key。公网地址仍必须使用 HTTPS。</p>
        </details>
        <button id="api-save" class="api-primary" type="submit">保存并返回对话</button>
      </form>
      <p id="api-config-status" class="ai-status" role="status" aria-live="polite">尚未配置 API</p>
      ${userDataPageMarkup()}
      <details id="api-mcp-settings" class="api-management"><summary>连接外部 AI（MCP）</summary>
        <p class="ai-notice">给本机 Codex、Claude Code 等客户端使用。启用后复制一次配置到客户端即可。</p>
        <p id="ai-mcp-status" class="ai-status" role="status" aria-live="polite">本地连接未启用</p>
        <div class="ai-actions"><button id="ai-mcp-start" type="button">启用本地 MCP</button><button id="ai-mcp-stop" type="button" hidden>关闭 MCP</button><button id="ai-mcp-reset" type="button" hidden>重置连接凭证</button></div>
        <div id="ai-mcp-configuration" hidden>
          <label for="ai-mcp-client-format">配置格式</label>
          <select id="ai-mcp-client-format"><option value="codex">Codex · TOML</option><option value="json">Claude / 通用 · JSON</option></select>
          <button id="ai-mcp-copy" type="button">复制连接配置</button>
        </div>
        <p id="ai-mcp-empty" class="ai-notice">暂无客户端连接</p>
        <div id="ai-mcp-connections"></div>
      </details>
    </section>
    ${userTaskPageMarkup()}
  </section>`;
}
