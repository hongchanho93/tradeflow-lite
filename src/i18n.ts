export const APP_LOCALES = ['zh-CN', 'en-US'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = 'zh-CN';
export const APP_LOCALE_STORAGE_KEY = 'tradeflow-lite.locale.v1';

type StorageReader = { getItem(key: string): string | null };
type StorageWriter = { setItem(key: string, value: string): void };

const knownLocales = new Set<string>(APP_LOCALES);

export function loadAppLocale(storage: StorageReader): AppLocale {
  try {
    const value = storage.getItem(APP_LOCALE_STORAGE_KEY);
    return value && knownLocales.has(value) ? value as AppLocale : DEFAULT_APP_LOCALE;
  } catch {
    return DEFAULT_APP_LOCALE;
  }
}

export function saveAppLocale(storage: StorageWriter, locale: AppLocale): boolean {
  try {
    storage.setItem(APP_LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

const exactEnglish: Record<string, string> = {
  '分钟': 'Minutes',
  '小时': 'Hours',
  '天': 'Days',
  '日': 'D',
  '周': 'W',
  '月': 'M',
  '股票': 'Stocks',
  '指数': 'Indices',
  '数字货币': 'Crypto',
  '预测市场': 'Prediction markets',
  '设置': 'Settings',
  '状态行': 'Status line',
  '版面': 'Appearance',
  '时区': 'Time zone',
  '语言': 'Language',
  '取消': 'Cancel',
  '确认': 'Confirm',
  '确定': 'OK',
  '保存': 'Save',
  '删除': 'Delete',
  '撤销': 'Undo',
  '重做': 'Redo',
  '关闭': 'Close',
  '应用': 'Apply',
  '全部': 'All',
  '自选': 'Watchlist',
  '盘口': 'Order book',
  '成交': 'Trades',
  '规则': 'Rules',
  '指标': 'Indicators',
  '成交量': 'Volume',
  '价格': 'Price',
  '数量': 'Amount',
  '时间': 'Time',
  '档位': 'Level',
  '价差': 'Spread',
  '颜色': 'Color',
  '颜色选择器': 'Color picker',
  'TF 颜色色板': 'TF color palette',
  '选择颜色': 'Choose color',
  '自定义颜色': 'Custom color',
  '十六进制颜色': 'Hex color',
  '添加': 'Add',
  '不透明度': 'Opacity',
  '大小': 'Size',
  '粗细': 'Width',
  '字号': 'Font size',
  '透明度': 'Opacity',
  '当前为亮色模式，点击切换到暗色模式': 'Light theme active. Switch to dark theme',
  '当前为暗色模式，点击切换到亮色模式': 'Dark theme active. Switch to light theme',
  '主题设置未能保存': 'Theme setting could not be saved',
  '绘图': 'Drawing',
  '标记': 'Markers',
  '线条': 'Lines',
  '通道': 'Channels',
  '测量': 'Measure',
  '放大': 'Zoom',
  '磁铁': 'Magnet',
  '折线': 'Line',
  '面积': 'Area',
  '基准': 'Baseline',
  '美国线': 'Bars',
  'K线': 'Candles',
  '常规': 'Regular',
  '对数': 'Logarithmic',
  '百分比': 'Percentage',
  '最新': 'Latest',
  '今年': 'YTD',
  '转到': 'Go to',
  '前往到': 'Go to',
  '关闭前往到': 'Close go to',
  '日期': 'Date',
  '上一个月': 'Previous month',
  '下一个月': 'Next month',
  '周一': 'Mon',
  '周二': 'Tue',
  '周三': 'Wed',
  '周四': 'Thu',
  '周五': 'Fri',
  '周六': 'Sat',
  '周日': 'Sun',
  '5年': '5Y',
  '1年': '1Y',
  '6月': '6M',
  '3月': '3M',
  '1月': '1M',
  '5天': '5D',
  '放置': 'Place',
  '主图': 'Main chart',
  '副图': 'Panes',
  '昨收': 'Prev close',
  '昨收线': 'Previous close',
  '成本': 'Cost',
  '成本线': 'Cost line',
  '自定义价格线': 'Custom price line',
  '自定义价位': 'Custom level',
  '价位': 'Level',
  '价格线': 'Price lines',
  '趋势线': 'Trend line',
  '射线': 'Ray',
  '箭头': 'Arrow',
  '延长线': 'Extended line',
  '水平线': 'Horizontal line',
  '水平射线': 'Horizontal ray',
  '垂直线': 'Vertical line',
  '十字线': 'Cross line',
  '平行通道': 'Parallel channel',
  '标注框': 'Callout',
  '荧光笔': 'Highlighter',
  '三角形': 'Triangle',
  '多段路径': 'Path',
  '矩形': 'Rectangle',
  '圆形': 'Circle',
  '向上箭头': 'Up arrow',
  '斐波那契回撤': 'Fibonacci retracement',
  '笔刷': 'Brush',
  '文字': 'Text',
  '价格区间': 'Price range',
  '多空仓位': 'Long/short position',
  '对象树': 'Object tree',
  '开盘': 'Open',
  '最高': 'High',
  '最低': 'Low',
  '收盘': 'Close',
  '涨跌': 'Change',
  '涨跌幅': 'Change %',
  '流动性': 'Liquidity',
  '结算说明': 'Resolution rules',
  '当前概率': 'Current probability',
  '截止时间': 'End date',
  '本地保存': 'Saved locally',
  '失败': 'Failed',
  '锁定': 'Lock',
  '解锁': 'Unlock',
  '显示': 'Show',
  '隐藏': 'Hide',
  '上移': 'Move up',
  '下移': 'Move down',
};

const phraseEnglish: Record<string, string> = {
  '30分': '30m', '15分': '15m', '5分': '5m', '1分': '1m',
  '4小时': '4h', '2小时': '2h', '1小时': '1h',
  '1天': '1D',
  '输入代码、名称或拼音查找品种，点击结果即可切换图表': 'Search by symbol, name, or Pinyin, then select a result to switch charts',
  '当前品种暂未接入盘口和逐笔成交': 'Order book and recent trades are not available for this symbol',
  '绘图保存失败：本地存储空间不足或不可用': 'Drawing could not be saved because local storage is full or unavailable',
  '加载失败，图表保留上一份有效数据': 'failed to load; the last valid chart remains visible',
  '预测市场使用概率折线，不提供伪造 K 线': 'Prediction markets use probability lines; synthetic candlesticks are not provided',
  '以 Polymarket 公布的市场规则和结算来源为准。': 'Refer to Polymarket market rules and resolution sources.',
  '系统未允许复制，已保存 PNG': 'Clipboard access was denied; the PNG was saved instead',
  '绘图状态校验失败，本次修改未保存': 'Drawing validation failed; this change was not saved',
  '自选保存失败：本地存储当前不可用': 'Watchlist could not be saved because local storage is unavailable',
  '当前复权价格含非正数，已切换为常规坐标': 'Adjusted prices contain non-positive values; switched to regular scale',
  '实时更新暂停，保留最后数据': 'realtime updates paused; keeping the latest data',
  '实时连接失败，已使用轮询': 'realtime connection failed; polling is active',
  '报价降级，保留 K 线': 'quote unavailable; candlesticks remain available',
  '标记必须对应当前周期的一根 K 线': 'The marker must match a candle in the current interval',
  '绘图设置未能保存': 'Drawing settings could not be saved',
  '图表设置未能保存': 'Chart preferences could not be saved',
  '交易时间设置未能保存': 'Trading time could not be saved',
  '语言设置未能保存': 'Language could not be saved',
  '设置未能保存': 'Settings could not be saved',
  '标记未能保存': 'Marker could not be saved',
  '已忽略损坏的绘图状态': 'Invalid saved drawing state was ignored',
  '没有找到符合条件的品种': 'No matching symbols found',
  '没有找到这个行情品种': 'This market symbol was not found',
  '图表暂无可用价格': 'No price is available for this chart',
  '最低价必须小于最高价': 'The minimum price must be lower than the maximum price',
  '请输入大于 0 的有效价格': 'Enter a valid price greater than 0',
  '自选最多保存 100 个证券': 'The watchlist can contain up to 100 symbols',
  '请点在一根 K 线上': 'Select a candle first',
  '请选择有效日期': 'Select a valid date',
  '正在测试 19 台主站': 'Testing 19 public hosts',
  '主站均不可用': 'All public hosts are unavailable',
  '主站测速失败': 'Public-host test failed',
  '点击顶部星标添加当前证券': 'Use the star in the top bar to add the current symbol',
  '点击重新测速': 'Click to test again',
  '正在连接': 'Connecting',
  '正在打开': 'Opening',
  '连接异常': 'connection error',
  '实时重连中': 'Reconnecting',
  '实时行情已连接': 'realtime market data connected',
  '正在建立': 'Establishing',
  '最后一次概率更新': 'Last probability update',
  '最后一次': 'Last',
  '更新': 'update',
  '生成图片失败': 'Could not create image',
  'PNG 已保存': 'PNG saved',
  '图表已复制': 'Chart copied',
  '商品代码搜索': 'Symbol search',
  '搜索代码、名称或拼音': 'Search symbol, name, or Pinyin',
  '关闭代码搜索': 'Close symbol search',
  '打开证券': 'Open symbol',
  '添加当前证券到自选': 'Add current symbol to watchlist',
  '从自选移除当前证券': 'Remove current symbol from watchlist',
  '添加到自选': 'Add to watchlist',
  '从自选移除': 'Remove from watchlist',
  '打开自选列表': 'Open watchlist',
  '打开盘口和成交': 'Open order book and trades',
  '关闭盘口': 'Close order book',
  '公开市场数据': 'Public market data',
  '商品代码和图标': 'Symbol and icon',
  '开、高、低、收': 'Open, high, low, close',
  '成交量数值': 'Volume value',
  '坐标和线条': 'Scales and lines',
  '垂直网格线': 'Vertical grid lines',
  '水平网格线': 'Horizontal grid lines',
  '十字线标签': 'Crosshair labels',
  '最新价格线和标签': 'Latest price line and label',
  'Trade Flow 水印': 'Trade Flow watermark',
  '底部时间导航': 'Bottom time navigation',
  '上涨颜色': 'Up color',
  '下跌颜色': 'Down color',
  '主体': 'Body',
  '上涨边框颜色': 'Up border color',
  '下跌边框颜色': 'Down border color',
  '上涨影线颜色': 'Up wick color',
  '下跌影线颜色': 'Down wick color',
  '上涨颜色不透明度': 'Up color opacity',
  '下跌颜色不透明度': 'Down color opacity',
  '上涨边框颜色不透明度': 'Up border opacity',
  '下跌边框颜色不透明度': 'Down border opacity',
  '上涨影线颜色不透明度': 'Up wick opacity',
  '下跌影线颜色不透明度': 'Down wick opacity',
  '数据修改': 'Data modification',
  '边框': 'Borders',
  '影线': 'Wicks',
  '设置分类': 'Settings categories',
  '关闭设置': 'Close settings',
  '商品代码': 'Symbol',
  'K线周期': 'Chart interval',
  '选择K线周期': 'Select chart interval',
  '选择图表类型': 'Select chart type',
  'K线图': 'Candlestick chart',
  '日线图': ' daily chart',
  '线形图': 'Line chart',
  '面积图': 'Area chart',
  '基准线': 'Baseline chart',
  '复权方式': 'Adjustment',
  '不复权': 'Unadjusted',
  '前复权': 'Forward adjusted',
  '显示或隐藏成交量': 'Show or hide volume',
  '技术指标': 'Technical indicators',
  '移动平均线': 'Moving average',
  '指数移动平均': 'Exponential moving average',
  '布林带': 'Bollinger Bands',
  '独立副图': 'separate pane',
  '相对强弱': 'Relative strength',
  '刷新K线': 'Refresh chart',
  '适应全部数据': 'Fit all data',
  '生成快照': 'Take snapshot',
  '下载图片': 'Download image',
  '复制图片': 'Copy image',
  '证券分类': 'Symbol categories',
  '全部来源': 'All sources',
  '全部数字货币': 'All crypto',
  '全部预测市场': 'All prediction markets',
  '上海市场': 'Shanghai market',
  '深圳市场': 'Shenzhen market',
  '北京市场': 'Beijing market',
  '沪市主板': 'SSE Main Board',
  '科创板': 'STAR Market',
  '深市主板': 'SZSE Main Board',
  '创业板': 'ChiNext',
  '北交所': 'BSE',
  '上证指数': 'SSE indices',
  '深证指数': 'SZSE indices',
  '北证指数': 'BSE indices',
  '沪市 ETF': 'SSE ETFs',
  '深市 ETF': 'SZSE ETFs',
  '币安现货': 'Binance Spot',
  '币安合约': 'Binance Futures',
  'U 本位永续': 'USD-M Perpetual',
  '永续合约': 'Perpetuals',
  '永续': 'Perpetual',
  '其他计价': 'Other quotes',
  '通达信主站': 'TDX public host',
  '绘图工具栏': 'Drawing toolbar',
  '鼠标指针': 'Cursor',
  '线条工具': 'Line tools',
  '添加图表标记': 'Add chart marker',
  '添加标记': 'Add marker',
  '编辑标记': 'Edit marker',
  '删除标记': 'Delete marker',
  '显示标记': 'Show marker',
  '隐藏标记': 'Hide marker',
  '定位到标记': 'Go to marker',
  '标注和手绘': 'Annotations and freehand',
  '几何形状': 'Geometric shapes',
  '测量与仓位工具': 'Measure and position tools',
  '预测和测量': 'Forecast and measurement',
  '锁定绘图': 'Lock drawings',
  '撤销绘图操作': 'Undo drawing action',
  '重做绘图操作': 'Redo drawing action',
  '移除全部绘图': 'Remove all drawings',
  '绘图对象管理': 'Drawing object manager',
  '对象管理': 'Object manager',
  '当前证券还没有绘图': 'The current symbol has no drawings',
  '关闭对象树': 'Close object tree',
  '图表文字': 'Chart text',
  '输入图表文字': 'Enter chart text',
  '设置成本线': 'Set cost line',
  '添加自定义价格线': 'Add custom price line',
  '输入价格': 'Enter price',
  '标记文字（可选）': 'Marker text (optional)',
  '标记文字': 'Marker text',
  '标记形状': 'Marker shape',
  '标记位置': 'Marker position',
  '向下箭头': 'Down arrow',
  '圆点': 'Circle',
  '方块': 'Square',
  'K线下方': 'Below candle',
  'K线上方': 'Above candle',
  'K线内部': 'Inside candle',
  '标记颜色': 'Marker color',
  '标记大小': 'Marker size',
  '绘图颜色': 'Drawing color',
  '绘图大小': 'Drawing size',
  '绘图透明度': 'Drawing opacity',
  '删除所选绘图': 'Delete selected drawing',
  '关闭绘图属性': 'Close drawing properties',
  '价格轴设置': 'Price scale settings',
  '价格轴': 'Price scale',
  '基准 100': 'Indexed to 100',
  '自动缩放': 'Auto scale',
  '反转价格轴': 'Invert price scale',
  '设置可见范围…': 'Set visible range…',
  '重置价格轴': 'Reset price scale',
  '最低价格': 'Minimum price',
  '最高价格': 'Maximum price',
  '价格范围': 'Price range',
  '时间导航': 'Time navigation',
  '向前浏览': 'Pan backward',
  '向后浏览': 'Pan forward',
  '定位日期': 'Go to date',
  '切换交易时间': 'Change trading time',
  '交易时间': 'Trading time',
  '世界统一时间': 'Coordinated Universal Time',
  '交易所': 'Exchange',
  '系统时间': 'System time',
  '等待实时深度': 'Waiting for realtime depth',
  '等待实时成交': 'Waiting for realtime trades',
  '卖一': 'Best ask',
  '买一': 'Best bid',
  '预测结果': 'Prediction outcomes',
  '24 小时': '24 hours',
  '查看官方结算来源': 'View official resolution source',
  '主图指标': 'Main-chart indicators',
  '显示主图': 'Show main chart',
  '隐藏主图': 'Hide main chart',
  '显示序列': 'Show series',
  '隐藏序列': 'Hide series',
  '上移序列': 'Move series up',
  '下移序列': 'Move series down',
  '移除序列': 'Remove series',
  '上移副图': 'Move pane up',
  '下移副图': 'Move pane down',
  '移除副图': 'Remove pane',
  '突破上轨': 'Crossed above upper band',
  '跌破下轨': 'Crossed below lower band',
  '在主图上绘制': 'Draw on the main chart',
  '在主图上点两次': 'click twice on the main chart',
  '点起点和方向点': 'select a start point and direction point',
  '点起点和终点': 'select a start and end point',
  '点两个位置确定方向': 'select two points to set direction',
  '在目标价格点一下': 'click at the target price',
  '点起点放置': 'click to place the start point',
  '在目标时间点一下': 'click at the target time',
  '点交叉位置放置': 'click to place the intersection',
  '输入文字后点锚点和标注位置': 'enter text, then select anchor and label positions',
  '在主图上按住并拖动': 'drag on the main chart',
  '点圆心和边缘': 'select the center and edge',
  '依次点三个位置': 'select three points',
  '按住并拖动，松开完成': 'drag and release to finish',
  '依次点三个顶点': 'select three vertices',
  '依次点各节点，双击完成': 'select each point and double-click to finish',
  '在主图上点一下放置': 'click once on the main chart',
  '在主图上拖出测量范围': 'drag a measurement range on the main chart',
  '设置入场、止损和目标': 'set entry, stop, and target',
  '标记 · 点击要标记的 K 线': 'Marker · select the candle to mark',
  '多空仓位保留红绿双色': 'Long/short positions keep red and green colors',
  '概率走势图': 'probability chart',
  '概率': 'Probability',
  '个百分点': 'percentage points',
  '开=': 'O=',
  '高=': 'H=',
  '低=': 'L=',
  '收=': 'C=',
  '行情接收时间': 'Quote received at',
  '缓存': 'Cache',
  '轮询保护': 'polling fallback',
  '轮询': 'polling',
  '公开行情': 'public market data',
};

const cityEnglish: Record<string, string> = {
  '檀香山': 'Honolulu', '安克雷奇': 'Anchorage', '朱诺': 'Juneau', '洛杉矶': 'Los Angeles',
  '温哥华': 'Vancouver', '菲尼克斯': 'Phoenix', '丹佛': 'Denver', '墨西哥城': 'Mexico City',
  '圣萨尔瓦多': 'San Salvador', '芝加哥': 'Chicago', '波哥大': 'Bogota', '利马': 'Lima',
  '纽约': 'New York', '多伦多': 'Toronto', '哈利法克斯': 'Halifax', '圣保罗': 'Sao Paulo',
  '亚速尔群岛': 'Azores', '伦敦': 'London', '巴黎': 'Paris', '柏林': 'Berlin',
  '苏黎世': 'Zurich', '维尔纽斯': 'Vilnius', '约翰内斯堡': 'Johannesburg', '开罗': 'Cairo',
  '莫斯科': 'Moscow', '迪拜': 'Dubai', '加尔各答': 'Kolkata', '曼谷': 'Bangkok',
  '新加坡': 'Singapore', '上海': 'Shanghai', '香港': 'Hong Kong', '东京': 'Tokyo',
  '首尔': 'Seoul', '悉尼': 'Sydney', '奥克兰': 'Auckland',
};

const replacements = Object.entries(phraseEnglish)
  .sort(([left], [right]) => right.length - left.length);

export function translateUiText(value: string, locale: AppLocale): string {
  if (locale === 'zh-CN' || !value.trim()) return value;
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  const body = value.slice(leading.length, value.length - trailing.length);
  const exact = exactEnglish[body] ?? cityEnglish[body];
  if (exact) return `${leading}${exact}${trailing}`;
  const favorite = body.match(/^(取消收藏|收藏)(.+)$/);
  if (favorite) {
    const label = translateUiText(favorite[2], locale);
    return favorite[1] === '取消收藏'
      ? `${leading}Remove ${label} from favorites${trailing}`
      : `${leading}Add ${label} to favorites${trailing}`;
  }
  const utcCity = body.match(/^(\(UTC[^)]*\)) (.+)$/);
  if (utcCity && cityEnglish[utcCity[2]]) {
    return `${leading}${utcCity[1]} ${cityEnglish[utcCity[2]]}${trailing}`;
  }
  const duration = body.match(/^(\d+) (分钟|小时)$/);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2] === '分钟' ? 'minute' : 'hour';
    return `${leading}${amount} ${unit}${amount === 1 ? '' : 's'}${trailing}`;
  }

  let translated = body
    .replace(/^已显示 (\d+) \/ 共 (\d+) 条$/, 'Showing $1 / $2')
    .replace(/^已加载 (\d+) 条 · 下滑继续加载$/, '$1 loaded · scroll for more')
    .replace(/^共 (\d+) 条$/, '$1 results')
    .replace(/^卖(\d+)$/, 'Ask $1')
    .replace(/^买(\d+)$/, 'Bid $1')
    .replace(/^自定义价位 (\d+)$/, 'Custom level $1')
    .replace(/^价位 (\d+)$/, 'Level $1')
    .replace(/^1 日$/, '1 day')
    .replace(/^1 周$/, '1 week')
    .replace(/^1 月$/, '1 month')
    .replace(/^(\d+)分$/, '$1m')
    .replace(/^(\d+)小时$/, '$1h')
    .replace(/^1天$/, '1D')
    .replace(/^1月$/, '1M')
    .replace(/^3月$/, '3M')
    .replace(/^6月$/, '6M')
    .replace(/^1年$/, '1Y');
  for (const [source, target] of replacements) translated = translated.replaceAll(source, target);
  return `${leading}${translated}${trailing}`;
}

const localizedAttributes = ['aria-label', 'title', 'placeholder'] as const;

function localizeElement(element: Element, locale: AppLocale): void {
  if (element.matches('.symbol-result-name, .watchlist-row strong, .marker-object-name, #prediction-description')) return;
  for (const attribute of localizedAttributes) {
    const value = element.getAttribute(attribute);
    if (value !== null) {
      const translated = translateUiText(value, locale);
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  }
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const value = child.nodeValue ?? '';
      const translated = translateUiText(value, locale);
      if (translated !== value) child.nodeValue = translated;
    } else if (child instanceof Element) {
      localizeElement(child, locale);
    }
  }
}

export function observeLocalizedUi(root: Element, locale: AppLocale): MutationObserver | null {
  if (locale === 'zh-CN') return null;
  localizeElement(root, locale);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const value = mutation.target.nodeValue ?? '';
        const translated = translateUiText(value, locale);
        if (translated !== value) mutation.target.nodeValue = translated;
        continue;
      }
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        localizeElement(mutation.target, locale);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const value = node.nodeValue ?? '';
          const translated = translateUiText(value, locale);
          if (translated !== value) node.nodeValue = translated;
        } else if (node instanceof Element) {
          localizeElement(node, locale);
        }
      }
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...localizedAttributes],
  });
  return observer;
}
