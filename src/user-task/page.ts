/** Static trusted markup only. All user names, code and result cells use textContent. */
export function userTaskPageMarkup(): string {
  return `<section id="user-task-page" class="user-task-page" hidden>
    <header class="api-settings-header"><strong>任务与结果</strong><button id="user-task-back" type="button">返回对话</button></header>
    <p class="ai-notice">导入 AI 帮你写的任务文件，选择数据后运行。任务在隔离环境中计算，不改动工程代码。</p>
    <div class="user-task-actions"><button id="user-task-import" class="api-primary" type="button">导入任务</button><button id="user-task-ai" type="button">让 AI 写任务</button><button id="user-task-example" type="button">使用参考任务</button></div>
    <input id="user-task-file" type="file" accept=".tft" hidden />
    <p id="user-task-status" class="user-task-notice" role="status" aria-live="polite"></p>
    <button id="user-task-abort" type="button" hidden>停止当前操作</button>
    <section id="user-task-setup" class="user-task-card" hidden>
      <h3 id="user-task-name">准备运行</h3><p id="user-task-description" class="user-task-notice"></p><p id="user-task-windows" class="user-task-notice"></p>
      <label class="user-task-field">使用的数据<select id="user-task-source"></select></label>
      <div class="user-task-actions"><button id="user-task-refresh-sources" type="button">刷新数据列表</button><button id="user-task-data" type="button">先接入我的数据</button></div>
      <label class="user-task-field">市场范围<select id="user-task-venue"></select></label>
      <label class="user-task-field">品种范围<select id="user-task-universe"><option value="catalog">数据源提供的品种</option><option value="watchlist">我的自选</option><option value="result">已有结果中的候选品种</option></select></label>
      <label id="user-task-candidates-field" class="user-task-field" hidden>选择候选列表<select id="user-task-candidates"></select></label>
      <strong>任务参数</strong><div id="user-task-parameters"></div>
      <details><summary>查看任务代码</summary><textarea id="user-task-source-code" rows="8" readonly spellcheck="false"></textarea></details>
      <div class="user-task-actions"><button id="user-task-start" class="api-primary" type="button">开始运行</button><button id="user-task-dismiss" type="button">收起</button></div>
    </section>
    <section class="user-task-section"><h3>运行记录</h3><p id="user-task-empty" class="user-task-notice">还没有任务。可以导入文件，或让 AI 根据你的要求生成。</p><div id="user-task-runs"></div></section>
    <section id="user-task-result" class="user-task-card" hidden>
      <h3 id="user-task-result-title">任务结果</h3><p id="user-task-result-state" class="user-task-notice"></p>
      <label class="user-task-field">选择结果<select id="user-task-artifact"></select></label>
      <div id="user-task-table-controls"><label class="user-task-field">筛选当前结果<input id="user-task-filter" type="text" maxlength="512" placeholder="输入要查找的内容" /></label>
        <label class="user-task-field">排序字段<select id="user-task-sort"><option value="">原始顺序</option></select></label>
        <label class="api-check"><input id="user-task-descending" type="checkbox" />降序</label><button id="user-task-apply-filter" type="button">应用筛选</button></div>
      <div class="user-task-actions"><button id="user-task-refresh-result" type="button">刷新结果</button><button id="user-task-csv" type="button">导出 CSV</button><button id="user-task-json" type="button">导出 JSON</button><button id="user-task-share" type="button">交给 AI 分析</button></div>
      <div id="user-task-result-body" class="user-task-result-body"></div>
      <div class="user-task-actions"><button id="user-task-prev" type="button">上一页</button><span id="user-task-page-info" class="user-task-notice"></span><button id="user-task-next" type="button">下一页</button></div>
      <button id="user-task-watchlist" type="button" hidden>本页加入自选</button>
      <p class="user-task-notice">图表和自选按钮会标明所用行情源。本地研究数据与对应的内置行情可能不同，不会自动替换任务数据。</p>
      <p class="user-task-notice">结果只保存在本次应用内存中；关闭应用或移除结果后不可恢复。需要保留时请导出。</p>
    </section>
    <section class="user-task-section"><h3>我的任务工具</h3><p id="user-task-library-empty" class="user-task-notice">保存后的任务会显示在这里。重启只恢复定义，不会自动运行。</p><div id="user-task-library"></div></section>
    <p class="ai-notice">本地计算和导出不会调用模型。点击“交给 AI 分析”只填写消息；发送后，AI 读取的结果分页会交给所选服务。</p>
  </section>`;
}
