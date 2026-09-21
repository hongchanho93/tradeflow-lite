/** Static host markup only. Names, code, errors and sample data use textContent. */
export function userDataPageMarkup(): string {
  return `<details id="user-data-settings" class="api-management user-data-settings">
    <summary>我的数据</summary>
    <div id="user-data-page" class="user-data-page" aria-label="我的数据">
    <p class="ai-notice">接入你已有的本地行情文件。只读取所选目录，不修改原始文件；不会自动上传整个目录。</p>
    <button id="user-data-add" class="api-primary" type="button">添加我的数据</button>
    <p class="ai-notice">请选择只存放数据的目录。使用 AI 时，查询结果、所需样本及接入文件代码会发送给你配置的服务（可能计费）。</p>
    <div class="user-data-feedback"><p id="user-data-status" class="ai-status" role="status" aria-live="polite"></p><button id="user-data-stop" type="button" hidden>停止检查</button></div>
    <p id="user-data-empty" class="ai-notice">还没有添加数据。先选择目录，再让 AI 根据实际文件格式接入。</p>
    <div id="user-data-list" aria-label="已选择的数据目录"></div>
    <section id="user-data-preview" class="user-data-preview" aria-label="接入文件检查结果" hidden>
      <strong>接入文件检查结果</strong><p id="user-data-preview-text" class="ai-external-text"></p>
      <div class="ai-actions"><button id="user-data-install" class="api-primary" type="button">安装接入文件</button><button id="user-data-dismiss" type="button">取消</button></div>
    </section>
    <input id="user-data-file" type="file" accept=".tfc" aria-label="选择接入文件" hidden />
    </div>
  </details>`;
}
