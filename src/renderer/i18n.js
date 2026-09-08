/* 轻量本地化层：界面文案全部随应用发布，不联网、不翻译用户记录和 AI 输出。 */
(function (root) {
  'use strict';

  const localeApi = root.DRLocale || {
    DEFAULT_LOCALE: 'zh-CN',
    SUPPORTED_LOCALES: ['zh-CN', 'en-US', 'ja-JP'],
    normalizeLocale(value) {
      const raw = String(value || '').trim().replace('_', '-').toLowerCase();
      if (raw === 'zh' || raw === 'zh-cn' || raw === '2052') return 'zh-CN';
      if (raw === 'en' || raw === 'en-us' || raw === '1033') return 'en-US';
      if (raw === 'ja' || raw === 'ja-jp' || raw === '1041') return 'ja-JP';
      return null;
    }
  };

  const dictionaries = {
    'en-US': {
      '日报随手记': 'Daily Notes',
      '设置': 'Settings',
      '工作记录': 'Work log',
      '记录 · 统计 · 回顾': 'Capture · Track · Review',
      '日期筛选': 'Date filter',
      '关闭': 'Close',
      '最小化': 'Minimize',
      '最大化': 'Maximize',
      '还原': 'Restore',
      '窗口控制': 'Window controls',
      '年份': 'Year',
      '月份': 'Month',
      '点击热力图或统计卡后，会自动切换为日期范围聚焦。': 'Click a heatmap cell or stat card to focus on a date range.',
      '搜索内容…': 'Search…',
      '支持模糊搜索：多个关键词可用空格分隔': 'Fuzzy search is supported; separate keywords with spaces',
      '已保存筛选': 'Saved filters',
      '加载已保存筛选': 'Load saved filters',
      '保存当前筛选': 'Save current filter',
      '保存筛选': 'Save filter',
      '新记录（Ctrl+N）': 'New entry (Ctrl+N)',
      '记录': 'Record',
      'AI 总结': 'AI summary',
      '更多': 'More',
      '导出': 'Export',
      '管理': 'Manage',
      '清除当前筛选': 'Clear current filter',
      '删除当前保存的筛选': 'Delete saved filter',
      '全选': 'Select all',
      '已选 0 条': '0 selected',
      '删除选中': 'Delete selected',
      '完成': 'Done',
      '返回主界面': 'Back to main',
      '周期总结': 'Periodic summary',
      '总结周期': 'Summary period',
      '日报': 'Daily',
      '周报': 'Weekly',
      '月报': 'Monthly',
      '自定义周期': 'Custom period',
      '上一周期': 'Previous period',
      '下一周期': 'Next period',
      '开始日期': 'Start date',
      '结束日期': 'End date',
      '显示格式': 'Display format',
      'Markdown': 'Markdown',
      '纯文本': 'Plain text',
      '复制': 'Copy',
      '导出总结': 'Export summary',
      '生成总结': 'Generate summary',
      'AI 工作过程': 'AI process',
      '正在连接…': 'Connecting…',
      '查看详细过程': 'View details',
      '收起详细过程': 'Hide details',
      '实时状态代表实际生成进度；详细过程仅用于查看，不会写入总结或导出文件。': 'Live status shows generation progress; details are view-only and are not included in summaries or exports.',
      '本周工作总结': 'This week\'s summary',
      '编辑': 'Edit',
      '保存会自动同步 Markdown、纯文本和导出内容；不会修改原始记录。': 'Saving synchronizes Markdown, plain text, and export content; original records are unchanged.',
      '取消': 'Cancel',
      '保存修改': 'Save changes',
      '调整原始记录栏宽度': 'Resize the original records panel',
      '拖动调整原始记录栏宽度': 'Drag to resize the original records panel',
      '本周期概览': 'Period overview',
      '记录数': 'Entries',
      'AI 覆盖': 'AI coverage',
      '模型': 'Model',
      '原始记录': 'Original records',
      '只读': 'Read-only',
      'AI 设置': 'AI settings',
      'API Key、模型、报告提示词、近期总结和术语规范': 'API key, models, report prompts, recent closures, and terminology',
      '未配置': 'Not configured',
      '快捷键': 'Shortcut',
      '唤起快速记录条': 'Open quick entry bar',
      '需包含 Ctrl / Alt / Shift 中至少一个修饰键': 'Must include at least one of Ctrl / Alt / Shift',
      '修改': 'Change',
      '恢复默认': 'Restore default',
      '外观': 'Appearance',
      '主题配色': 'Color theme',
      '选择应用强调色和背景风格；不改变应用图标。': 'Choose the app accent and background style; the app icon stays unchanged.',
      '向阳金': 'Sunlit Gold',
      '晴空蓝': 'Clear Sky',
      '薄荷林': 'Mint Grove',
      '暮紫': 'Dusk Violet',
      '深海蓝': 'Deep Navy',
      '石墨青': 'Graphite Teal',
      '松柏绿': 'Pine Green',
      '岩灰琥珀': 'Slate Amber',
      '靛青灰': 'Indigo Slate',
      '铁蓝灰': 'Steel Blue',
      '显示模式': 'Display mode',
      '选择亮色、暗色或跟随系统': 'Choose light, dark, or follow the system',
      '界面主题': 'Theme',
      '跟随系统时随 Windows 深浅色自动切换': 'Follow Windows light/dark mode when set to system',
      '跟随系统': 'System',
      '浅色': 'Light',
      '深色': 'Dark',
      '通用': 'General',
      '开机自动启动': 'Start with Windows',
      '登录 Windows 后自动驻留托盘（会写入系统启动项）': 'Stay in the tray after signing in to Windows (writes a startup entry)',
      '静默启动': 'Start silently',
      '开机后仅在后台托盘驻留，不弹出主窗口；双击桌面图标仍可打开': 'Stay in the tray after startup without opening the main window; the desktop shortcut still opens it',
      '界面语言': 'Interface language',
      '语言': 'Language',
      '简体中文': 'Simplified Chinese',
      'English': 'English',
      '日本語': 'Japanese',
      '安装时选择的语言，也可以在这里切换；切换后立即生效。': 'The installer language can also be changed here; changes take effect immediately.',
      '数据': 'Data',
      '数据文件': 'Data file',
      '打开所在文件夹': 'Open folder',
      '完整备份': 'Full backup',
      '包含日报、周期总结、近期闭环、模板、术语和筛选配置；API Key 不会写入备份文件。': 'Includes entries, periodic summaries, recent closures, templates, terminology, and filters; API keys are never included.',
      '导出备份': 'Export backup',
      '从备份恢复': 'Restore backup',
      '集中管理连接、模型和 AI 生成规则': 'Manage connections, models, and AI generation rules',
      '设置项目': 'Settings',
      'AI 服务': 'AI service',
      '连接与模型': 'Connection and models',
      '周期报告': 'Periodic reports',
      '日报、周报、月报': 'Daily, weekly, and monthly reports',
      '近期总结': 'Recent closures',
      '历史对照与闭环': 'Historical comparison and closure',
      '术语规范': 'Terminology',
      '名称与别名词典': 'Names and aliases',
      '使用你自己的 API Key。Key 保存在本机 Windows 安全存储中，页面默认只显示掩码。': 'Use your own API key. It is stored in Windows secure storage and masked by default.',
      '已保存的 Key 默认掩码显示；点击眼睛可临时查看，输入新 Key 可替换。': 'The saved key is masked by default; click the eye to reveal it temporarily or enter a new key to replace it.',
      '显示 API Key': 'Show API key',
      '隐藏 API Key': 'Hide API key',
      '点击测试连接后自动读取当前可用模型': 'Test the connection to load available models',
      '请先测试连接': 'Test the connection first',
      '术语识别 / 近期总结模型': 'Terminology / recent closure model',
      '独立于周期报告模型，用来归并术语并对照历史记录与本期完成事项。': 'Independent from the report model; used to merge terminology and compare history with current results.',
      '思考强度': 'Reasoning effort',
      '自动（推荐）': 'Auto (recommended)',
      '快速': 'Fast',
      '标准': 'Standard',
      '深度': 'Deep',
      '闭环思考强度': 'Closure reasoning effort',
      '测试连接': 'Test connection',
      '保存配置': 'Save configuration',
      '清除配置': 'Clear configuration',
      '周期报告模板': 'Periodic report templates',
      '选择周期模板': 'Choose period template',
      '模板只控制结构和表达方式，系统会始终要求完整保留原始记录。': 'The template controls structure and wording; original records are always preserved.',
      '自定义': 'Custom',
      '填写这个周期的总结要求…': 'Enter summary requirements for this period…',
      '模板会与所选周期和全部原始记录一起发送，保存后影响下一次生成。': 'The template is sent with the selected period and all original records; it affects the next generation.',
      '保存模板': 'Save template',
      '近期总结提示词': 'Recent closure prompt',
      '它独立于日报、周报和月报模板，只控制“历史提及过、近期又出现完成结果”的闭环整理方式。默认提示词可以随时恢复。': 'It is independent of daily, weekly, and monthly report templates and only controls how items mentioned in history and completed recently are organized. The default prompt can be restored at any time.',
      '填写近期闭环分析要求…': 'Enter recent closure analysis requirements…',
      '修改后不会自动调用 AI；下一次查看或更新闭环时生效。': 'Changes do not call AI automatically; they take effect the next time closures are viewed or updated.',
      '保存提示词': 'Save prompt',
      '术语识别提示词': 'Terminology prompt',
      '快速记录不用选择项目或标签。首次连接 AI 后会阅读已有日报，识别可能指向同一事项的不同叫法并自动形成词典；你可以在这里修改，无法确定时 AI 会保守处理。': 'Quick entries do not require a project or tag. After the first AI connection, existing entries are analyzed to find different names for the same item and build a dictionary; you can edit it here, and AI will stay conservative when uncertain.',
      '填写术语识别要求…': 'Enter terminology requirements…',
      '连接 AI 后自动开始；不会修改任何原始记录。': 'Starts automatically after connecting AI; no original records are modified.',
      '识别全部日报': 'Analyze all entries',
      '重新识别并合并': 'Analyze and merge again',
      '首次识别全部日报': 'First analysis of all entries',
      '实时状态代表术语识别进度；详细过程默认收起，不会修改原始日报。': 'Live status shows terminology analysis progress; details are collapsed by default and never modify original entries.',
      '默认提示词会要求 AI 只依据日报做保守归并；可以按你的习惯修改，随时恢复默认。修改后下一次识别生效。': 'The default prompt asks AI to conservatively merge names using only entries; you can edit it and restore the default at any time. Changes take effect on the next analysis.',
      '不会改变快速记录，也不会修改已有日报。': 'Quick entries and existing daily reports are not changed.',
      '待确认的叫法关联': 'Pending terminology matches',
      '这些关联只用于改进后续术语归并；不确认也不影响日报、周报或近期总结的正常使用。': 'These matches only improve future terminology merging; leaving them unconfirmed does not affect daily, weekly, or recent-closure summaries.',
      '是': 'Yes',
      '不是': 'No',
      '不处理': 'Not now',
      '叫法排除保存失败': 'Failed to save the excluded name pair',
      '已记住不是同一事项': 'Remembered as different matters',
      '新增术语': 'Add terminology',
      '编辑术语': 'Edit terminology',
      '先建立规范名称，再填写日报中可能出现的不同说法。': 'Set the canonical name first, then enter the different forms that may appear in entries.',
      '规范输出名称': 'Canonical name',
      '适用范围（可选）': 'Scope (optional)',
      '常用说法（每行或逗号分隔）': 'Common forms (one per line or comma-separated)',
      '补充说明（可选）': 'Notes (optional)',
      '例如：项目编号或产品名称': 'e.g. project ID or product name',
      '例如：项目、产品或业务领域': 'e.g. project, product, or business area',
      '例如：正式名称、简称、常用别名': 'e.g. formal name, abbreviation, common aliases',
      '例如：名称不明确时只保留通用名称': 'e.g. keep only the general name when the name is unclear',
      '取消编辑': 'Cancel editing',
      '添加术语': 'Add term',
      '保存修改': 'Save changes',
      '已有术语词典': 'Terminology dictionary',
      '搜索规范名称或常用说法…': 'Search canonical names or common forms…',
      '清除术语搜索': 'Clear terminology search',
      '清除搜索': 'Clear search',
      '记录': 'Entry',
      '导出日报': 'Export entries',
      '格式': 'Format',
      'Excel 表格': 'Excel workbook',
      '导出文件': 'Export file',
      '确认操作': 'Confirm action',
      '确定': 'Confirm',
      '返回': 'Back',
      '返回设置': 'Back to settings',
      '近期工作闭环': 'Recent work closures',
      '记下这一条工作内容…（Ctrl+Enter 保存）': 'Write a work note… (Ctrl+Enter to save)',
      '默认自动跟随当前时间，可手动修改': 'Follows the current time by default; can be changed manually',
      '恢复为当前时间': 'Use current time',
      '此刻': 'Now',
      '为当前筛选条件起一个名称，之后可以从下拉框一键加载。': 'Name this filter so it can be loaded from the dropdown later.',
      '筛选名称': 'Filter name',
      '例如：本月重点工作': 'e.g. monthly priorities',
      'AI 设置项目': 'AI settings sections',
      'AI 平台': 'AI platform',
      '选择平台预设；自定义平台需使用 OpenAI 兼容接口。': 'Choose a platform preset; custom platforms must use an OpenAI-compatible interface.',
      '平台类型': 'Platform type',
      '预设平台会自动填入 API 地址，也可以切换到自定义兼容平台。': 'Presets fill the API address automatically; you can also switch to a custom compatible platform.',
      '自定义 OpenAI 兼容': 'Custom OpenAI-compatible',
      'API 地址': 'API endpoint',
      '用于连接接口的基础地址；预设平台会自动填入，也可以手动修改。': 'Base address used to connect to the API; presets fill this automatically, and it can be edited.',
      '选择': 'Select'
      , '快速记录': 'Quick entry'
      , '自动记录当前时间': 'Record the current time automatically'
      , '记点什么，回车保存…': 'Write something and press Enter to save…'
      , '✓ 已保存': '✓ Saved'
      , 'Enter 保存 · Esc 收起': 'Enter to save · Esc to close'
      , '已记录 ✓': 'Saved ✓'
      , '已更新 ✓': 'Updated ✓'
      , '请输入筛选名称': 'Enter a filter name'
      , '请先选择开始和结束日期': 'Select a start and end date first'
      , '开始日期不能晚于结束日期': 'The start date cannot be later than the end date'
      , '本周期没有记录': 'No entries in this period'
      , '尚未生成本周期总结，点击右上角“生成总结”开始。': 'No summary has been generated for this period. Click “Generate summary” in the upper right to start.'
      , '选择周期后点击“生成总结”。': 'Select a period, then click “Generate summary”.'
      , '总结已生成，已保留全部原始记录。': 'Summary generated; all original records are preserved.'
      , '总结已生成，日报原文仍已保留；可以重新生成以补齐报告。': 'Summary generated; the original entries are preserved. Regenerate to complete the report.'
      , '请先在设置中配置 AI 服务': 'Configure the AI service in Settings first'
      , '本周期总结正在生成，请稍候。': 'This period summary is being generated. Please wait.'
      , '请先生成总结': 'Generate a summary first'
      , '总结已复制': 'Summary copied'
      , '复制失败，请使用编辑框手动复制': 'Copy failed. Please copy it manually from the editor.'
      , '总结已导出到': 'Summary exported to'
      , '连接 AI 后自动开始；不会修改任何原始记录。': 'Starts automatically after connecting AI; no original records are modified.'
      , '连接已就绪，首次识别会读取全部日报；不会修改任何原始记录。': 'Connection ready. The first analysis reads all entries; no original records are modified.'
      , '正在读取全部日报；不会修改任何原始记录。': 'Reading all entries; no original records are modified.'
      , '正在分析记录…': 'Analyzing entries…'
      , '识别失败': 'Analysis failed'
      , '正在读取': 'Reading'
      , '分析失败': 'Analysis failed'
      , '尚未整理': 'Not organized yet'
      , '闭环已同步': 'Closures are up to date'
      , '待更新': 'Update recommended'
      , '正在分析': 'Analyzing'
      , '未配置 AI': 'AI not configured'
      , 'AI 正在检查连接…': 'AI is checking the connection…'
      , 'AI 连接失败': 'AI connection failed'
      , 'AI 已配置': 'AI configured'
      , '正在自动检查连接并读取当前可用模型…': 'Automatically checking the connection and loading available models…'
      , '测试连接后会自动选择更适合语义判断的模型；也可单独切换。': 'Testing the connection automatically selects a model better suited to semantic analysis; it can also be changed separately.'
      , '已保存配置，软件启动时会自动检查连接': 'Configuration saved; the connection is checked automatically when the app starts'
      , '连接成功，请保存配置': 'Connection successful. Save the configuration.'
      , '正在测试连接并读取模型…': 'Testing the connection and loading models…'
      , '连接失败': 'Connection failed'
      , '正在保存 AI 配置…': 'Saving AI configuration…'
      , 'AI 配置保存失败': 'Failed to save AI configuration'
      , 'AI 配置已保存': 'AI configuration saved'
      , '早上好': 'Good morning'
      , '中午好': 'Good noon'
      , '下午好': 'Good afternoon'
      , '晚上好': 'Good evening'
      , '夜深了': 'It\'s late'
      , '今日': 'Today'
      , '本周': 'This week'
      , '累计': 'Total'
      , '今天': 'Today'
      , '昨天': 'Yesterday'
      , '尚未生成本周期总结': 'No summary generated for this period yet'
      , '本周期没有日报记录，无法生成总结。': 'There are no daily entries in this period, so a summary cannot be generated.'
      , '正在读取本周已经保存的闭环结果…': 'Loading the saved closures for this week…'
      , 'AI 思考强度': 'AI reasoning effort'
      , '近期闭环 AI 思考强度': 'Recent closure AI reasoning effort'
      , '当前用于近期闭环；与周期报告模型独立。': 'Currently used for recent closures; independent from the report model.'
      , '自动：普通周期优先快速处理，长周期分段时自动提高；修改后仅影响下一次重新生成。': 'Auto: favors fast processing for normal periods and increases effort for long, segmented periods; changes affect the next regeneration only.'
      , '快速：优先响应速度，适合简短日报；修改后仅影响下一次重新生成。': 'Fast: favors response speed and suits short daily reports; changes affect the next regeneration only.'
      , '标准：更适合周报、月报和需要归类的复杂总结；修改后仅影响下一次重新生成。': 'Standard: better for weekly, monthly, and complex summaries that need categorization; changes affect the next regeneration only.'
      , '深度：适合复杂总结，可能更慢、消耗更多；修改后仅影响下一次重新生成。': 'Deep: suited to complex summaries and may be slower or use more tokens; changes affect the next regeneration only.'
      , '自动：优先判断历史与近期记录的语义关系；仅影响下一次近期闭环生成。': 'Auto: prioritizes semantic relationships between historical and recent entries; changes affect the next closure generation only.'
      , '快速：适合记录较少的周期；仅影响下一次近期闭环生成。': 'Fast: suited to periods with fewer entries; changes affect the next closure generation only.'
      , '标准：适合叫法不一致、需要前后对照的闭环分析。': 'Standard: suited to closure analysis with inconsistent names that needs before-and-after comparison.'
      , '深度：适合关系复杂的记录，可能更慢、消耗更多。': 'Deep: suited to complex relationships and may be slower or use more tokens.'
      , '模型已更换，请重新测试连接': 'Model changed. Test the connection again.'
      , '闭环模型已更换，请重新测试连接': 'Closure model changed. Test the connection again.'
      , '语言设置失败': 'Failed to save language'
      , '删除': 'Delete'
      , '已删除保存的筛选': 'Saved filter deleted'
      , '筛选已保存': 'Filter saved'
      , '已更新保存的筛选': 'Saved filter updated'
      , '请先设置关键词或日期筛选': 'Set a keyword or date filter first'
      , '无法保存设置': 'Unable to save settings'
      , '无法连接本地数据服务': 'Unable to connect to the local data service'
      , '正在等待 AI 返回内容；返回后会在这里实时显示。': 'Waiting for AI to return content; it will appear here in real time.'
      , '本次未收到可展示的 AI 输出。': 'No displayable AI output was received this time.'
      , '本次没有可展示的 AI 输出。': 'There is no displayable AI output this time.'
      , '进度：': 'Progress: '
      , '思考过程：': 'Thinking process: '
      , '总结输出：': 'Summary output: '
      , 'AI 输出：': 'AI output: '
      , '本次分析没有返回可展示的思考文本；结果仍按记录对照生成。': 'This analysis returned no displayable reasoning text; the result was still generated from the records.'
      , '当前周期记录、术语和闭环提示词未变化。': 'The current-period entries, terminology, and closure prompt have not changed.'
      , '当前周期或历史记录发生变化，建议更新近期闭环。': 'Current-period or historical entries changed; updating recent closures is recommended.'
      , '术语规范已变化，建议更新近期闭环。': 'Terminology changed; updating recent closures is recommended.'
      , '闭环提示词已变化，建议更新近期闭环。': 'The closure prompt changed; updating recent closures is recommended.'
      , '这是历史闭环结果，建议重新分析确认。': 'This is a historical closure result; re-analysis is recommended.'
      , '当前显示历史闭环结果，建议更新。': 'A historical closure result is shown; updating is recommended.'
      , '只对照近期记录和历史记录，不代表整个项目的完整进度。': 'Only recent and historical entries are compared; this does not represent the complete project progress.'
      , '配置 AI 后，这里可以识别近期出现的工作闭环。': 'After configuring AI, recent work closures can be identified here.'
      , '请选择': 'Please select'
      , '当前语言与本次 AI 过程的生成语言不同，已隐藏原始思考文本。': 'The original reasoning is hidden because it was generated in a different language.'
      , '此刻': 'Now'
    },
    'ja-JP': {
      '日报随手记': 'Daily Notes',
      '设置': '設定',
      '工作记录': '作業記録',
      '记录 · 统计 · 回顾': '記録 · 集計 · 振り返り',
      '日期筛选': '日付フィルター',
      '关闭': '閉じる',
      '最小化': '最小化',
      '最大化': '最大化',
      '还原': '元に戻す',
      '窗口控制': 'ウィンドウ操作',
      '年份': '年',
      '月份': '月',
      '点击热力图或统计卡后，会自动切换为日期范围聚焦。': 'ヒートマップまたは統計カードをクリックすると日付範囲に絞り込みます。',
      '搜索内容…': '検索…',
      '支持模糊搜索：多个关键词可用空格分隔': '複数のキーワードはスペースで区切って検索できます',
      '已保存筛选': '保存済みフィルター',
      '加载已保存筛选': '保存済みフィルターを読み込む',
      '保存当前筛选': '現在のフィルターを保存',
      '保存筛选': 'フィルターを保存',
      '新记录（Ctrl+N）': '新規記録 (Ctrl+N)',
      '记录': '記録',
      'AI 总结': 'AI まとめ',
      '更多': 'その他',
      '导出': 'エクスポート',
      '管理': '管理',
      '清除当前筛选': '現在のフィルターを解除',
      '删除当前保存的筛选': '保存済みフィルターを削除',
      '全选': 'すべて選択',
      '已选 0 条': '0 件選択',
      '删除选中': '選択項目を削除',
      '完成': '完了',
      '返回主界面': 'メイン画面に戻る',
      '周期总结': '期間まとめ',
      '总结周期': 'まとめの期間',
      '日报': '日報',
      '周报': '週報',
      '月报': '月報',
      '自定义周期': 'カスタム期間',
      '上一周期': '前の期間',
      '下一周期': '次の期間',
      '开始日期': '開始日',
      '结束日期': '終了日',
      '显示格式': '表示形式',
      '纯文本': 'プレーンテキスト',
      '复制': 'コピー',
      '导出总结': 'まとめをエクスポート',
      '生成总结': 'まとめを生成',
      'AI 工作过程': 'AI の処理状況',
      '正在连接…': '接続中…',
      '查看详细过程': '詳細を表示',
      '收起详细过程': '詳細を閉じる',
      '实时状态代表实际生成进度；详细过程仅用于查看，不会写入总结或导出文件。': 'リアルタイム状態は生成状況を示します。詳細は確認用で、まとめやエクスポートには含まれません。',
      '本周工作总结': '今週の作業まとめ',
      '编辑': '編集',
      '保存会自动同步 Markdown、纯文本和导出内容；不会修改原始记录。': '保存すると Markdown、プレーンテキスト、エクスポート内容が同期されます。元の記録は変更されません。',
      '取消': 'キャンセル',
      '保存修改': '変更を保存',
      '调整原始记录栏宽度': '元記録パネルの幅を調整',
      '拖动调整原始记录栏宽度': 'ドラッグして元記録パネルの幅を調整',
      '本周期概览': '期間の概要',
      '记录数': '記録数',
      'AI 覆盖': 'AI 対象',
      '模型': 'モデル',
      '原始记录': '元の記録',
      '只读': '読み取り専用',
      'AI 设置': 'AI 設定',
      'API Key、模型、报告提示词、近期总结和术语规范': 'API キー、モデル、レポートプロンプト、最近の完了事項、用語',
      '未配置': '未設定',
      '快捷键': 'ショートカット',
      '唤起快速记录条': 'クイック記録バーを開く',
      '需包含 Ctrl / Alt / Shift 中至少一个修饰键': 'Ctrl / Alt / Shift のいずれかを1つ以上含めてください',
      '修改': '変更',
      '恢复默认': 'デフォルトに戻す',
      '外观': '外観',
      '主题配色': '配色テーマ',
      '选择应用强调色和背景风格；不改变应用图标。': 'アプリのアクセントカラーと背景スタイルを選択します。アプリアイコンは変わりません。',
      '向阳金': 'サンリットゴールド',
      '晴空蓝': 'クリアスカイ',
      '薄荷林': 'ミントグローブ',
      '暮紫': 'ダスクバイオレット',
      '深海蓝': 'ディープネイビー',
      '石墨青': 'グラファイトティール',
      '松柏绿': 'パイングリーン',
      '岩灰琥珀': 'ストーンアンバー',
      '靛青灰': 'インディゴスレート',
      '铁蓝灰': 'スチールブルー',
      '显示模式': '表示モード',
      '选择亮色、暗色或跟随系统': 'ライト、ダーク、またはシステム設定に合わせます',
      '界面主题': 'テーマ',
      '跟随系统时随 Windows 深浅色自动切换': 'システム設定時は Windows の明暗に追従します',
      '跟随系统': 'システム',
      '浅色': 'ライト',
      '深色': 'ダーク',
      '通用': '一般',
      '开机自动启动': 'Windows 起動時に開始',
      '登录 Windows 后自动驻留托盘（会写入系统启动项）': 'Windows サインイン後にトレイで起動します（スタートアップに登録）',
      '静默启动': 'サイレント起動',
      '开机后仅在后台托盘驻留，不弹出主窗口；双击桌面图标仍可打开': '起動後はトレイに常駐し、メイン画面を開きません。デスクトップからは開けます',
      '界面语言': '表示言語',
      '语言': '言語',
      '简体中文': '簡体中国語',
      'English': '英語',
      '日本語': '日本語',
      '安装时选择的语言，也可以在这里切换；切换后立即生效。': 'インストール時の言語はここでも変更でき、変更はすぐに反映されます。',
      '数据': 'データ',
      '数据文件': 'データファイル',
      '打开所在文件夹': 'フォルダーを開く',
      '完整备份': '完全バックアップ',
      '包含日报、周期总结、近期闭环、模板、术语和筛选配置；API Key 不会写入备份文件。': '記録、期間まとめ、最近の完了事項、テンプレート、用語、フィルターを含みます。API キーは含まれません。',
      '导出备份': 'バックアップをエクスポート',
      '从备份恢复': 'バックアップから復元',
      '集中管理连接、模型和 AI 生成规则': '接続、モデル、AI 生成ルールを管理',
      '设置项目': '設定項目',
      'AI 服务': 'AI サービス',
      '连接与模型': '接続とモデル',
      '周期报告': '期間レポート',
      '日报、周报、月报': '日報、週報、月報',
      '近期总结': '最近の完了事項',
      '历史对照与闭环': '履歴との比較と完了確認',
      '术语规范': '用語',
      '名称与别名词典': '名称と別名の辞書',
      '使用你自己的 API Key。Key 保存在本机 Windows 安全存储中，页面默认只显示掩码。': '自分の API キーを使用します。キーは Windows の安全な領域に保存され、通常はマスク表示されます。',
      '已保存的 Key 默认掩码显示；点击眼睛可临时查看，输入新 Key 可替换。': '保存済みのキーはマスク表示されます。目のアイコンで一時表示したり、新しいキーに置き換えたりできます。',
      '显示 API Key': 'API キーを表示',
      '隐藏 API Key': 'API キーを隠す',
      '点击测试连接后自动读取当前可用模型': '接続テスト後に利用可能なモデルを読み込みます',
      '请先测试连接': '先に接続をテストしてください',
      '术语识别 / 近期总结模型': '用語 / 最近の完了事項モデル',
      '独立于周期报告模型，用来归并术语并对照历史记录与本期完成事项。': '期間レポートとは独立し、用語の統合と履歴・今回の結果の比較に使用します。',
      '思考强度': '推論強度',
      '自动（推荐）': '自動（推奨）',
      '快速': '高速',
      '标准': '標準',
      '深度': '深い',
      '闭环思考强度': '完了確認の推論強度',
      '测试连接': '接続テスト',
      '保存配置': '設定を保存',
      '清除配置': '設定をクリア',
      '周期报告模板': '期間レポートテンプレート',
      '选择周期模板': '期間テンプレートを選択',
      '模板只控制结构和表达方式，系统会始终要求完整保留原始记录。': 'テンプレートは構成と表現だけを制御し、元の記録は必ず保持します。',
      '自定义': 'カスタム',
      '填写这个周期的总结要求…': 'この期間のまとめ要件を入力…',
      '保存模板': 'テンプレートを保存',
      '近期总结提示词': '最近の完了事項プロンプト',
      '它独立于日报、周报和月报模板，只控制“历史提及过、近期又出现完成结果”的闭环整理方式。默认提示词可以随时恢复。': '日報・週報・月報テンプレートとは独立し、履歴に登場し最近完了した項目の整理方法だけを制御します。デフォルトにいつでも戻せます。',
      '填写近期闭环分析要求…': '最近の完了事項の分析要件を入力…',
      '修改后不会自动调用 AI；下一次查看或更新闭环时生效。': '変更時に AI は自動実行されず、次に完了事項を表示または更新したときに反映されます。',
      '保存提示词': 'プロンプトを保存',
      '术语识别提示词': '用語認識プロンプト',
      '快速记录不用选择项目或标签。首次连接 AI 后会阅读已有日报，识别可能指向同一事项的不同叫法并自动形成词典；你可以在这里修改，无法确定时 AI 会保守处理。': 'クイック記録ではプロジェクトやタグは不要です。初回の AI 接続後に既存の日報を読み、同じ事項を指す異なる呼び方を見つけて辞書を作成します。ここで編集でき、不確かな場合は慎重に処理します。',
      '填写术语识别要求…': '用語認識の要件を入力…',
      '连接 AI 后自动开始；不会修改任何原始记录。': 'AI 接続後に自動開始します。元の記録は変更しません。',
      '识别全部日报': 'すべての記録を分析',
      '重新识别并合并': '再分析して統合',
      '首次识别全部日报': 'すべての記録を初回分析',
      '实时状态代表术语识别进度；详细过程默认收起，不会修改原始日报。': 'リアルタイム状態は用語認識の進捗を示します。詳細は初期状態で閉じられ、元の日報は変更しません。',
      '默认提示词会要求 AI 只依据日报做保守归并；可以按你的习惯修改，随时恢复默认。修改后下一次识别生效。': 'デフォルトプロンプトは日報だけを根拠に慎重に統合するよう AI に求めます。編集やデフォルトへの復元ができ、次回の分析から反映されます。',
      '不会改变快速记录，也不会修改已有日报。': 'クイック記録や既存の日報は変更しません。',
      '待确认的叫法关联': '確認待ちの用語候補',
      '这些关联只用于改进后续术语归并；不确认也不影响日报、周报或近期总结的正常使用。': 'これらの候補は今後の用語統合の改善にのみ使います。確認しなくても日報・週報・最近の完了事項の利用には影響しません。',
      '是': 'はい',
      '不是': 'いいえ',
      '不处理': '今は処理しない',
      '叫法排除保存失败': '呼び方の除外保存に失敗しました',
      '已记住不是同一事项': '別の事項として記憶しました',
      '新增术语': '用語を追加',
      '编辑术语': '用語を編集',
      '先建立规范名称，再填写日报中可能出现的不同说法。': '正式名称を先に設定し、日報に現れる可能性のある呼び方を入力します。',
      '规范输出名称': '正式名称',
      '适用范围（可选）': '適用範囲（任意）',
      '常用说法（每行或逗号分隔）': '一般的な呼び方（行またはカンマ区切り）',
      '补充说明（可选）': '補足（任意）',
      '例如：项目编号或产品名称': '例：プロジェクト番号または製品名',
      '例如：项目、产品或业务领域': '例：プロジェクト、製品、または業務分野',
      '例如：正式名称、简称、常用别名': '例：正式名称、略称、一般的な別名',
      '例如：名称不明确时只保留通用名称': '例：名称が不明確な場合は一般名称だけを使用',
      '取消编辑': '編集をキャンセル',
      '添加术语': '用語を追加',
      '已有术语词典': '用語辞書',
      '搜索规范名称或常用说法…': '正式名称または呼び方を検索…',
      '清除术语搜索': '用語検索をクリア',
      '清除搜索': '検索をクリア',
      '导出日报': '記録をエクスポート',
      '格式': '形式',
      'Excel 表格': 'Excel ファイル',
      '导出文件': 'ファイルをエクスポート',
      '确认操作': '操作を確認',
      '确定': '確認',
      '返回': '戻る',
      '返回设置': '設定に戻る',
      '近期工作闭环': '最近の作業完了事項',
      '记下这一条工作内容…（Ctrl+Enter 保存）': '作業内容を入力…（Ctrl+Enter で保存）',
      '默认自动跟随当前时间，可手动修改': '現在時刻を自動入力します。手動変更も可能です',
      '恢复为当前时间': '現在時刻に戻す',
      '此刻': '現在',
      '为当前筛选条件起一个名称，之后可以从下拉框一键加载。': 'このフィルターに名前を付けると、後でドロップダウンから読み込めます。',
      '筛选名称': 'フィルター名',
      '例如：本月重点工作': '例：今月の重点事項',
      'AI 设置项目': 'AI 設定項目',
      'AI 平台': 'AI プラットフォーム',
      '选择平台预设；自定义平台需使用 OpenAI 兼容接口。': 'プラットフォームのプリセットを選択します。カスタムプラットフォームは OpenAI 互換インターフェースを使用してください。',
      '平台类型': 'プラットフォームの種類',
      '预设平台会自动填入 API 地址，也可以切换到自定义兼容平台。': 'プリセットは API アドレスを自動入力します。カスタム互換プラットフォームに切り替えることもできます。',
      '自定义 OpenAI 兼容': 'カスタム OpenAI 互換',
      'API 地址': 'API アドレス',
      '用于连接接口的基础地址；预设平台会自动填入，也可以手动修改。': '接続に使用する API のベースアドレス。プリセットは自動入力され、手動で変更できます。',
      '选择': '選択'
      , '快速记录': 'クイック記録'
      , '自动记录当前时间': '現在時刻を自動記録'
      , '记点什么，回车保存…': '内容を入力して Enter で保存…'
      , '✓ 已保存': '✓ 保存済み'
      , 'Enter 保存 · Esc 收起': 'Enter で保存 · Esc で閉じる'
      , '已记录 ✓': '保存しました ✓'
      , '已更新 ✓': '更新しました ✓'
      , '请输入筛选名称': 'フィルター名を入力してください'
      , '请先选择开始和结束日期': '開始日と終了日を先に選択してください'
      , '开始日期不能晚于结束日期': '開始日は終了日より後にできません'
      , '本周期没有记录': 'この期間の記録はありません'
      , '尚未生成本周期总结，点击右上角“生成总结”开始。': 'この期間のまとめはまだありません。右上の「まとめを生成」をクリックしてください。'
      , '选择周期后点击“生成总结”。': '期間を選択して「まとめを生成」をクリックしてください。'
      , '总结已生成，已保留全部原始记录。': 'まとめを生成しました。元の記録はすべて保持されています。'
      , '总结已生成，日报原文仍已保留；可以重新生成以补齐报告。': 'まとめを生成しました。元の日報は保持されています。不足分は再生成できます。'
      , '请先在设置中配置 AI 服务': '先に設定で AI サービスを設定してください'
      , '本周期总结正在生成，请稍候。': 'この期間のまとめを生成中です。しばらくお待ちください。'
      , '请先生成总结': '先にまとめを生成してください'
      , '总结已复制': 'まとめをコピーしました'
      , '复制失败，请使用编辑框手动复制': 'コピーに失敗しました。編集欄から手動でコピーしてください。'
      , '总结已导出到': 'まとめをエクスポートしました：'
      , '连接 AI 后自动开始；不会修改任何原始记录。': 'AI 接続後に自動開始します。元の記録は変更しません。'
      , '连接已就绪，首次识别会读取全部日报；不会修改任何原始记录。': '接続準備完了。初回分析ですべての日報を読み込みます。元の記録は変更しません。'
      , '正在读取全部日报；不会修改任何原始记录。': 'すべての日報を読み込んでいます。元の記録は変更しません。'
      , '正在分析记录…': '記録を分析中…'
      , '识别失败': '分析に失敗しました'
      , '正在读取': '読み込み中'
      , '分析失败': '分析に失敗しました'
      , '尚未整理': '未整理'
      , '闭环已同步': '完了事項は最新です'
      , '待更新': '更新が必要です'
      , '正在分析': '分析中'
      , '未配置 AI': 'AI 未設定'
      , 'AI 正在检查连接…': 'AI 接続を確認中…'
      , 'AI 连接失败': 'AI 接続失敗'
      , 'AI 已配置': 'AI 設定済み'
      , '正在自动检查连接并读取当前可用模型…': '接続を自動確認し、利用可能なモデルを読み込んでいます…'
      , '测试连接后会自动选择更适合语义判断的模型；也可单独切换。': '接続テスト後、意味判断に適したモデルを自動選択します。個別に変更もできます。'
      , '已保存配置，软件启动时会自动检查连接': '設定を保存しました。起動時に接続を自動確認します'
      , '连接成功，请保存配置': '接続に成功しました。設定を保存してください。'
      , '正在测试连接并读取模型…': '接続をテストし、モデルを読み込んでいます…'
      , '连接失败': '接続に失敗しました'
      , '正在保存 AI 配置…': 'AI 設定を保存中…'
      , 'AI 配置保存失败': 'AI 設定の保存に失敗しました'
      , 'AI 配置已保存': 'AI 設定を保存しました'
      , '早上好': 'おはようございます'
      , '中午好': 'こんにちは'
      , '下午好': 'こんにちは'
      , '晚上好': 'こんばんは'
      , '夜深了': '夜更けです'
      , '今日': '今日'
      , '本周': '今週'
      , '累计': '合計'
      , '今天': '今日'
      , '昨天': '昨日'
      , '尚未生成本周期总结': 'この期間のまとめはまだ生成されていません'
      , '本周期没有日报记录，无法生成总结。': 'この期間に日報がないため、まとめを生成できません。'
      , '正在读取本周已经保存的闭环结果…': '今週保存された完了事項を読み込んでいます…'
      , 'AI 思考强度': 'AI 推論強度'
      , '近期闭环 AI 思考强度': '最近の完了事項 AI 推論強度'
      , '当前用于近期闭环；与周期报告模型独立。': '最近の完了事項に使用中。期間レポートモデルとは独立しています。'
      , '自动：普通周期优先快速处理，长周期分段时自动提高；修改后仅影响下一次重新生成。': '自動：通常の期間は高速処理を優先し、長い期間の分割時は自動で強度を上げます。変更は次回生成にのみ反映されます。'
      , '快速：优先响应速度，适合简短日报；修改后仅影响下一次重新生成。': '高速：応答速度を優先し、短い日報に適します。変更は次回生成にのみ反映されます。'
      , '标准：更适合周报、月报和需要归类的复杂总结；修改后仅影响下一次重新生成。': '標準：週報・月報や分類が必要な複雑なまとめに適します。変更は次回生成にのみ反映されます。'
      , '深度：适合复杂总结，可能更慢、消耗更多；修改后仅影响下一次重新生成。': '深い：複雑なまとめに適しますが、時間やトークンを多く使う場合があります。変更は次回生成にのみ反映されます。'
      , '自动：优先判断历史与近期记录的语义关系；仅影响下一次近期闭环生成。': '自動：履歴と最近の記録の意味関係を優先して判断します。次回の完了事項生成にのみ反映されます。'
      , '快速：适合记录较少的周期；仅影响下一次近期闭环生成。': '高速：記録が少ない期間に適します。次回の完了事項生成にのみ反映されます。'
      , '标准：适合叫法不一致、需要前后对照的闭环分析。': '標準：呼び方が一致せず、前後比較が必要な完了事項分析に適します。'
      , '深度：适合关系复杂的记录，可能更慢、消耗更多。': '深い：関係が複雑な記録に適しますが、時間やトークンを多く使う場合があります。'
      , '模型已更换，请重新测试连接': 'モデルを変更しました。もう一度接続をテストしてください。'
      , '闭环模型已更换，请重新测试连接': '完了事項モデルを変更しました。もう一度接続をテストしてください。'
      , '语言设置失败': '言語設定の保存に失敗しました'
      , '删除': '削除'
      , '已删除保存的筛选': '保存済みフィルターを削除しました'
      , '筛选已保存': 'フィルターを保存しました'
      , '已更新保存的筛选': '保存済みフィルターを更新しました'
      , '请先设置关键词或日期筛选': 'キーワードまたは日付フィルターを先に設定してください'
      , '无法保存设置': '設定を保存できません'
      , '无法连接本地数据服务': 'ローカルデータサービスに接続できません'
      , '正在等待 AI 返回内容；返回后会在这里实时显示。': 'AI の応答を待っています。受信後、ここにリアルタイムで表示します。'
      , '本次未收到可展示的 AI 输出。': '今回は表示可能な AI 出力を受信しませんでした。'
      , '本次没有可展示的 AI 输出。': '今回は表示可能な AI 出力がありません。'
      , '进度：': '進捗：'
      , '思考过程：': '思考プロセス：'
      , '总结输出：': 'まとめの出力：'
      , 'AI 输出：': 'AI 出力：'
      , '本次分析没有返回可展示的思考文本；结果仍按记录对照生成。': '今回は表示可能な思考テキストが返りませんでしたが、記録の照合に基づき結果を生成しました。'
      , '当前周期记录、术语和闭环提示词未变化。': '今回の記録、用語、完了事項プロンプトに変更はありません。'
      , '当前周期或历史记录发生变化，建议更新近期闭环。': '今回または履歴の記録が変更されました。最近の完了事項を更新してください。'
      , '术语规范已变化，建议更新近期闭环。': '用語が変更されました。最近の完了事項を更新してください。'
      , '闭环提示词已变化，建议更新近期闭环。': '完了事項プロンプトが変更されました。最近の完了事項を更新してください。'
      , '这是历史闭环结果，建议重新分析确认。': 'これは履歴の完了事項です。再分析して確認してください。'
      , '当前显示历史闭环结果，建议更新。': '履歴の完了事項を表示しています。更新してください。'
      , '只对照近期记录和历史记录，不代表整个项目的完整进度。': '最近と履歴の記録だけを比較しており、プロジェクト全体の進捗を示すものではありません。'
      , '配置 AI 后，这里可以识别近期出现的工作闭环。': 'AI を設定すると、最近発生した作業の完了事項をここで確認できます。'
      , '请选择': '選択してください'
      , '当前语言与本次 AI 过程的生成语言不同，已隐藏原始思考文本。': '生成時の言語が現在の言語と異なるため、元の思考テキストを非表示にしています。'
      , '此刻': '現在'
    }
  };

  const weekdayMap = {
    'en-US': { '日': 'Sun', '一': 'Mon', '二': 'Tue', '三': 'Wed', '四': 'Thu', '五': 'Fri', '六': 'Sat' },
    'ja-JP': { '日': '日', '一': '月', '二': '火', '三': '水', '四': '木', '五': '金', '六': '土' }
  };

  let currentLocale = localeApi.DEFAULT_LOCALE;
  const loadedLocales = new Set();
  let localeLoadSerial = 0;
  try {
    currentLocale = localeApi.normalizeLocale(localStorage.getItem('locale:cache')) || currentLocale;
  } catch { /* 首次启动或浏览器存储不可用 */ }

  // 语言包由主进程从固定目录读取；内置字典只作为读取失败时的安全回退。
  async function loadLocaleBundle(locale) {
    if (loadedLocales.has(locale)) return dictionaries[locale];
    let payload = null;
    try {
      if (root.api?.loadLocale) {
        const result = await root.api.loadLocale(locale);
        if (result?.ok === false) return null;
        payload = result?.messages || result;
      } else if (typeof fetch === 'function') {
        const response = await fetch(`locales/${locale}.json`);
        if (!response.ok) return null;
        payload = await response.json();
      }
    } catch {
      return null;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const bundle = {};
    for (const [key, value] of Object.entries(payload)) {
      if (typeof key === 'string' && typeof value === 'string') bundle[key] = value;
    }
    dictionaries[locale] = { ...dictionaries[locale], ...bundle };
    loadedLocales.add(locale);
    return dictionaries[locale];
  }

  function dictionary() {
    return dictionaries[currentLocale] || {};
  }

  function localizePattern(source) {
    const dict = dictionary();
    if (Object.prototype.hasOwnProperty.call(dict, source)) return dict[source];
    const locale = currentLocale;
    const weekdays = weekdayMap[locale] || {};
    const localized = (english, japanese) => locale === 'en-US' ? english : japanese;
    const segmentLabel = (first, second, unit = '段') => {
      if (!first || !second) return '';
      return locale === 'en-US'
        ? ` · ${unit === '批' ? 'batch' : 'segment'} ${first}/${second}`
        : ` · ${first}/${second}${unit === '批' ? 'バッチ' : 'セグメント'}`;
    };
    let match;

    // 生成、闭环和术语识别共用的动态进度文案。只匹配程序生成的固定格式，
    // 不触碰报告正文、日报原文或 AI 返回的思考内容。
    match = /^等待生成(?: · 第 (\d+)\/(\d+) 段)? · (\d+)s$/.exec(source);
    if (match) return localized(`Waiting to generate${segmentLabel(match[1], match[2])} · ${match[3]}s`, `生成待ち${segmentLabel(match[1], match[2])} · ${match[3]}s`);
    match = /^准备生成总结(?: · 第 (\d+)\/(\d+) 段)? · (\d+)s$/.exec(source);
    if (match) return localized(`Preparing summary${segmentLabel(match[1], match[2])} · ${match[3]}s`, `まとめを準備中${segmentLabel(match[1], match[2])} · ${match[3]}s`);
    match = /^AI 正在思考(?: · 第 (\d+)\/(\d+) 段)?(?: · 已收到 (\d+) 字)? · (\d+)s$/.exec(source);
    if (match) return localized(`AI is thinking${segmentLabel(match[1], match[2])}${match[3] ? ` · ${match[3]} chars received` : ''} · ${match[4]}s`, `AI が思考中${segmentLabel(match[1], match[2])}${match[3] ? ` · ${match[3]}文字受信` : ''} · ${match[4]}s`);
    match = /^正在输出总结(?: · 第 (\d+)\/(\d+) 段)?(?: · 已收到 (\d+) 字)? · (\d+)s$/.exec(source);
    if (match) return localized(`Writing summary${segmentLabel(match[1], match[2])}${match[3] ? ` · ${match[3]} chars received` : ''} · ${match[4]}s`, `まとめを出力中${segmentLabel(match[1], match[2])}${match[3] ? ` · ${match[3]}文字受信` : ''} · ${match[4]}s`);
    match = /^正在续写第 (\d+)\/(\d+) 次(?: · 第 (\d+)\/(\d+) 段)? · (\d+)s$/.exec(source);
    if (match) return localized(`Continuing ${match[1]}/${match[2]}${segmentLabel(match[3], match[4])} · ${match[5]}s`, `${match[1]}/${match[2]}回目を続行中${segmentLabel(match[3], match[4])} · ${match[5]}s`);
    match = /^正在恢复流式输出(?: · 第 (\d+)\/(\d+) 段)? · (\d+)s$/.exec(source);
    if (match) return localized(`Recovering streaming output${segmentLabel(match[1], match[2])} · ${match[3]}s`, `ストリーミング出力を復旧中${segmentLabel(match[1], match[2])} · ${match[3]}s`);
    match = /^正在切换兼容输出模式(?: · 第 (\d+)\/(\d+) 段)? · (\d+)s$/.exec(source);
    if (match) return localized(`Switching to compatible output mode${segmentLabel(match[1], match[2])} · ${match[3]}s`, `互換出力モードに切り替え中${segmentLabel(match[1], match[2])} · ${match[3]}s`);
    match = /^正文输出完成，准备保存 · (\d+)s$/.exec(source);
    if (match) return localized(`Main output complete; preparing to save · ${match[1]}s`, `本文の出力完了、保存を準備中 · ${match[1]}s`);
    match = /^正在保存完整报告 · (\d+)s$/.exec(source);
    if (match) return localized(`Saving the complete report · ${match[1]}s`, `完全なレポートを保存中 · ${match[1]}s`);
    match = /^报告已保存 · (\d+)s$/.exec(source);
    if (match) return localized(`Report saved · ${match[1]}s`, `レポートを保存しました · ${match[1]}s`);
    match = /^(?:已完成|生成完成) · (\d+)s$/.exec(source);
    if (match) return localized(`Complete · ${match[1]}s`, `完了 · ${match[1]}s`);
    match = /^AI 正在处理(?: · 第 (\d+)\/(\d+) 段)? · (\d+)s$/.exec(source);
    if (match) return localized(`AI is processing${segmentLabel(match[1], match[2])} · ${match[3]}s`, `AI が処理中${segmentLabel(match[1], match[2])} · ${match[3]}s`);
    match = /^准备分析(?: · 第 (\d+)\/(\d+) 批)? · (\d+)s$/.exec(source);
    if (match) return localized(`Preparing analysis${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`, `分析を準備中${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`);
    match = /^AI 正在思考(?: · 第 (\d+)\/(\d+) 批)?(?: · 已收到 (\d+) 字)? · (\d+)s$/.exec(source);
    if (match) return localized(`AI is thinking${segmentLabel(match[1], match[2], '批')}${match[3] ? ` · ${match[3]} chars received` : ''} · ${match[4]}s`, `AI が思考中${segmentLabel(match[1], match[2], '批')}${match[3] ? ` · ${match[3]}文字受信` : ''} · ${match[4]}s`);
    match = /^正在整理 AI 输出(?: · 第 (\d+)\/(\d+) 批)?(?: · 已收到 (\d+) 字)? · (\d+)s$/.exec(source);
    if (match) return localized(`Organizing AI output${segmentLabel(match[1], match[2], '批')}${match[3] ? ` · ${match[3]} chars received` : ''} · ${match[4]}s`, `AI 出力を整理中${segmentLabel(match[1], match[2], '批')}${match[3] ? ` · ${match[3]}文字受信` : ''} · ${match[4]}s`);
    match = /^第 (\d+) 批识别完成 · (\d+)s$/.exec(source);
    if (match) return localized(`Batch ${match[1]} analysis complete · ${match[2]}s`, `${match[1]}回目の分析が完了 · ${match[2]}s`);
    match = /^术语词典已保存 · (\d+)s$/.exec(source);
    if (match) return localized(`Terminology dictionary saved · ${match[1]}s`, `用語辞書を保存しました · ${match[1]}s`);
    match = /^正在整理结果(?: · 第 (\d+)\/(\d+) 批)? · (\d+)s$/.exec(source);
    if (match) return localized(`Organizing results${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`, `結果を整理中${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`);
    match = /^正在续写结构化结果(?: · 第 (\d+)\/(\d+) 批)? · (\d+)s$/.exec(source);
    if (match) return localized(`Continuing structured results${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`, `構造化結果を続行中${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`);
    match = /^正在恢复流式输出(?: · 第 (\d+)\/(\d+) 批)? · (\d+)s$/.exec(source);
    if (match) return localized(`Recovering streaming output${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`, `ストリーミング出力を復旧中${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`);
    match = /^正在切换兼容模式(?: · 第 (\d+)\/(\d+) 批)? · (\d+)s$/.exec(source);
    if (match) return localized(`Switching to compatible mode${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`, `互換モードに切り替え中${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`);
    match = /^已完成批次对照(?: · 第 (\d+)\/(\d+) 批)? · (\d+)s$/.exec(source);
    if (match) return localized(`Batch comparison complete${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`, `バッチ比較が完了${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`);
    match = /^已完成$/.exec(source);
    if (match) return localized('Complete', '完了');
    match = /^AI 正在处理(?: · 第 (\d+)\/(\d+) 批)? · (\d+)s$/.exec(source);
    if (match) return localized(`AI is processing${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`, `AI が処理中${segmentLabel(match[1], match[2], '批')} · ${match[3]}s`);
    match = /^工作量 · 近 (\d+) 周$/.exec(source);
    if (match) return localized(`Workload · last ${match[1]} weeks`, `作業量 · 過去${match[1]}週間`);
    match = /^趋势 · 近 (\d+) 天$/.exec(source);
    if (match) return localized(`Trend · last ${match[1]} days`, `傾向 · 過去${match[1]}日`);
    match = /^(\d+) 月$/.exec(source);
    if (match) return locale === 'en-US' ? `Month ${match[1]}` : `${match[1]}月`;
    match = /^(\d+) 年$/.exec(source);
    if (match) return locale === 'en-US' ? `Year ${match[1]}` : `${match[1]}年`;
    match = /^已导出到 (.+)$/.exec(source);
    if (match) return localized(`Exported to ${match[1]}`, `${match[1]} にエクスポートしました`);
    match = /^总结已导出到 (.+)$/.exec(source);
    if (match) return localized(`Summary exported to ${match[1]}`, `${match[1]} にまとめをエクスポートしました`);
    match = /^(\d{4}-\d{2}-\d{2}) 至 (\d{4}-\d{2}-\d{2}) 的总结已生成$/.exec(source);
    if (match) return localized(`Summary for ${match[1]} to ${match[2]} generated`, `${match[1]}〜${match[2]}のまとめを生成しました`);
    match = /^(\d{4}-\d{2}-\d{2}) 至 (\d{4}-\d{2}-\d{2}) 总结失败：(.+)$/.exec(source);
    if (match) return localized(`Summary for ${match[1]} to ${match[2]} failed: ${match[3]}`, `${match[1]}〜${match[2]}のまとめに失敗しました：${match[3]}`);
    match = /^已加载筛选：(.+)$/.exec(source);
    if (match) return localized(`Filter loaded: ${match[1]}`, `フィルターを読み込みました：${match[1]}`);
    match = /^筛选删除失败：(.+)$/.exec(source);
    if (match) return localized(`Failed to delete filter: ${match[1]}`, `フィルターの削除に失敗しました：${match[1]}`);
    match = /^筛选保存失败：(.+)$/.exec(source);
    if (match) return localized(`Failed to save filter: ${match[1]}`, `フィルターの保存に失敗しました：${match[1]}`);
    match = /^已加入生成队列，前面还有 (\d+) 个任务。$/.exec(source);
    if (match) return localized(`Queued; ${match[1]} task(s) are ahead.`, `生成キューに追加しました。前に${match[1]}件あります。`);
    match = /^当前日期筛选：(.+)$/.exec(source);
    if (match) return localized(`Current date filter: ${match[1]}`, `現在の日付フィルター：${match[1]}`);
    match = /^删除保存的筛选“(.+)”？$/.exec(source);
    if (match) return localized(`Delete saved filter “${match[1]}”?`, `保存済みフィルター「${match[1]}」を削除しますか？`);
    match = /^删除术语“(.+)”？之后 AI 不再优先使用这组规范。$/.exec(source);
    if (match) return localized(`Delete “${match[1]}”? AI will no longer prefer this terminology.`, `「${match[1]}」を削除しますか？AI はこの用語を優先しなくなります。`);
    match = /^只基于 (\d{4}-\d{2}-\d{2}) 至 (\d{4}-\d{2}-\d{2}) 的本期记录和历史记录做前后对照；历史记录不完整时不会推断项目整体状态。$/.exec(source);
    if (match) return localized(
      `This compares current-period entries from ${match[1]} to ${match[2]} with historical entries; it does not infer overall project status when history is incomplete.`,
      `今回（${match[1]}〜${match[2]}）の記録と履歴を比較します。履歴が不完全な場合、プロジェクト全体の状態は推測しません。`
    );
    match = /^已记住：(.+) → (.+)$/.exec(source);
    if (match) return localized(`Remembered: ${match[1]} → ${match[2]}`, `記憶しました：${match[1]} → ${match[2]}`);
    match = /^连接成功，发现 (\d+) 个可用模型，请保存配置$/.exec(source);
    if (match) return localized(`Connected. Found ${match[1]} available models. Save the configuration.`, `接続に成功しました。利用可能なモデルが${match[1]}件見つかりました。設定を保存してください。`);
    match = /^连接成功，周期报告模型：(.+)；闭环模型：(.+)，请保存配置$/.exec(source);
    if (match) return localized(`Connected. Report model: ${match[1]}; closure model: ${match[2]}. Save the configuration.`, `接続に成功しました。期間レポートモデル：${match[1]}、完了事項モデル：${match[2]}。設定を保存してください。`);
    match = /^备份已导出：(\d+) 条记录，(\d+) 份总结，(\d+) 份闭环结果$/.exec(source);
    if (match) return localized(`Backup exported: ${match[1]} entries, ${match[2]} summaries, ${match[3]} closure results.`, `バックアップをエクスポートしました：記録${match[1]}件、まとめ${match[2]}件、完了事項結果${match[3]}件。`);
    match = /^恢复完成：(\d+) 条记录，(\d+) 份总结；恢复前安全备份已自动保留。$/.exec(source);
    if (match) return localized(`Restore complete: ${match[1]} entries and ${match[2]} summaries. The safety backup made before restoring was kept.`, `復元しました：記録${match[1]}件、まとめ${match[2]}件。復元前に作成した安全バックアップは保持されています。`);
    match = /^备份导出失败：(.+)$/.exec(source);
    if (match) return localized(`Backup export failed: ${match[1]}`, `バックアップのエクスポートに失敗しました：${match[1]}`);
    match = /^备份文件无法读取：(.+)$/.exec(source);
    if (match) return localized(`Unable to read the backup file: ${match[1]}`, `バックアップファイルを読み取れません：${match[1]}`);
    match = /^恢复失败：(.+)$/.exec(source);
    if (match) return localized(`Restore failed: ${match[1]}`, `復元に失敗しました：${match[1]}`);
    match = /^备份恢复失败：(.+)$/.exec(source);
    if (match) return localized(`Backup restore failed: ${match[1]}`, `バックアップの復元に失敗しました：${match[1]}`);
    match = /^快捷键已更新为 (.+)$/.exec(source);
    if (match) return localized(`Shortcut updated to ${match[1]}`, `ショートカットを${match[1]}に更新しました`);
    match = /^(.+)，请重试$/.exec(source);
    if (match) {
      const prefix = localizePattern(match[1]);
      if (prefix !== match[1]) return locale === 'en-US' ? `${prefix}. Please try again.` : `${prefix}。もう一度お試しください。`;
    }
    match = /^已读取 (\d+) 条日报，形成 (\d+) 组术语；上次识别：(.+)。可再次识别并合并。$/.exec(source);
    if (match) return localized(`${match[1]} entries analyzed; ${match[2]} terminology groups created. Last analysis: ${match[3]}. Analyze and merge again.`, `${match[1]}件の日報を読み込み、${match[2]}組の用語を作成しました。前回の分析：${match[3]}。再分析して統合できます。`);

    match = /^(\d+) 月 (\d+) 日 星期([日一二三四五六])$/.exec(source);
    if (match) {
      if (locale === 'en-US') return `${match[1]}/${match[2]} ${weekdays[match[3]]}`;
      return `${match[1]}月${match[2]}日（${weekdays[match[3]]}）`;
    }
    match = /^(\d{4}-\d{2}-\d{2}) 星期([日一二三四五六])$/.exec(source);
    if (match) return `${match[1]} ${weekdays[match[2]]}`;
    match = /^(\d{4}-\d{2}-\d{2}) 至 (\d{4}-\d{2}-\d{2}) 工作总结$/.exec(source);
    if (match) return locale === 'en-US'
      ? `${match[1]} to ${match[2]} summary`
      : `${match[1]}〜${match[2]}のまとめ`;
    match = /^(\d{4}-\d{2}-\d{2}) 工作总结$/.exec(source);
    if (match) return locale === 'en-US' ? `${match[1]} summary` : `${match[1]}のまとめ`;
    match = /^(\d{4}) 年 (\d+) 月工作总结$/.exec(source);
    if (match) return locale === 'en-US'
      ? `${match[1]}-${String(match[2]).padStart(2, '0')} summary`
      : `${match[1]}年${match[2]}月のまとめ`;
    match = /^来源：(.+?) 条$/.exec(source);
    if (match) return locale === 'en-US' ? `Source: ${match[1]}` : `出典：${match[1]}件`;
    match = /^模型：(.+)$/.exec(source);
    if (match) return locale === 'en-US' ? `Model: ${match[1]}` : `モデル：${match[1]}`;
    match = /^最近测试：(.+)$/.exec(source);
    if (match) return locale === 'en-US' ? `Last tested: ${match[1]}` : `最終テスト：${match[1]}`;
    match = /^原始明细：(.+)$/.exec(source);
    if (match) return locale === 'en-US' ? `Original details: ${match[1]}` : `元記録：${match[1]}`;
    match = /^显示 (\d+) \/ (\d+) 条$/.exec(source);
    if (match) return locale === 'en-US' ? `Showing ${match[1]} / ${match[2]}` : `${match[1]} / ${match[2]}件を表示`;
    match = /^(\d+) 条记录$/.exec(source);
    if (match) return locale === 'en-US' ? `${match[1]} entries` : `${match[1]}件の記録`;
    match = /^已选 (\d+) 条$/.exec(source);
    if (match) return locale === 'en-US' ? `${match[1]} selected` : `${match[1]}件を選択`;
    match = /^确认删除 (\d+) 条$/.exec(source);
    if (match) return locale === 'en-US' ? `Confirm delete ${match[1]}` : `${match[1]}件を削除しますか`;
    match = /^已删除 (\d+) 条$/.exec(source);
    if (match) return locale === 'en-US' ? `Deleted ${match[1]}` : `${match[1]}件を削除しました`;
    match = /^已删除 1 条记录$/.exec(source);
    if (match) return locale === 'en-US' ? 'Deleted 1 entry' : '1件の記録を削除しました';
    match = /^将导出 (\d+) 条$/.exec(source);
    if (match) return locale === 'en-US' ? `Will export ${match[1]} entries` : `${match[1]}件をエクスポートします`;
    match = /^第 (\d+) 批识别完成$/.exec(source);
    if (match) return locale === 'en-US' ? `Batch ${match[1]} analysis complete` : `${match[1]}回目の分析が完了`;
    match = /^识别 (\d+) 项$/.exec(source);
    if (match) return locale === 'en-US' ? `Analyze ${match[1]} items` : `${match[1]}項目を分析`;
    match = /^还有 (\d+) 项，打开完整结果查看$/.exec(source);
    if (match) return locale === 'en-US' ? `${match[1]} more; open full results` : `あと${match[1]}項目。完全な結果を開く`;
    match = /^识别到 (\d+) 项近期完成或阶段性闭环$/.exec(source);
    if (match) return locale === 'en-US' ? `${match[1]} recent completions or milestones found` : `最近の完了・節目を${match[1]}件検出`;
    match = /^已完成全部日报识别，共形成 (\d+) 组术语。$/.exec(source);
    if (match) return locale === 'en-US' ? `All entries analyzed; ${match[1]} terminology groups created.` : `全記録の分析が完了し、${match[1]}組の用語を作成しました。`;
    match = /^术语词典已更新，共 (\d+) 组$/.exec(source);
    if (match) return locale === 'en-US' ? `Terminology updated: ${match[1]} groups` : `用語辞書を更新しました：${match[1]}組`;
    match = /^(\d+) 组术语$/.exec(source);
    if (match) return locale === 'en-US' ? `${match[1]} terminology groups` : `${match[1]}組の用語`;
    match = /^匹配 (\d+) \/ (\d+) 组术语$/.exec(source);
    if (match) return locale === 'en-US'
      ? `${match[1]} / ${match[2]} terminology groups match`
      : `${match[1]} / ${match[2]}組の用語が一致`;
    match = /^没有找到与“(.+)”匹配的术语；可以直接在上方新增术语。$/.exec(source);
    if (match) return locale === 'en-US'
      ? `No terminology matches “${match[1]}”. You can add one above.`
      : `「${match[1]}」に一致する用語がありません。上で追加できます。`;
    match = /^AI 已连接 · (.+)$/.exec(source);
    if (match) return locale === 'en-US' ? `AI connected · ${match[1]}` : `AI 接続済み · ${match[1]}`;
    if (source === 'AI 已配置') return locale === 'en-US' ? 'AI configured' : 'AI 設定済み';
    if (source === 'AI 连接失败') return locale === 'en-US' ? 'AI connection failed' : 'AI 接続失敗';
    if (source === '未配置 AI') return locale === 'en-US' ? 'AI not configured' : 'AI 未設定';
    if (source === '已加入生成队列，等待可用的 AI 请求…') {
      return locale === 'en-US' ? 'Queued; waiting for an available AI request…' : '生成キューに追加しました。利用可能な AI リクエストを待っています…';
    }
    if (source === '正在连接 AI，准备分析原始记录…') {
      return locale === 'en-US' ? 'Connecting to AI and preparing to analyze the original entries…' : 'AI に接続し、元の記録を分析する準備をしています…';
    }
    match = /^正在分析第 (\d+)\/(\d+) 段原始记录…$/.exec(source);
    if (match) return locale === 'en-US'
      ? `Analyzing original entries, segment ${match[1]}/${match[2]}…`
      : `元の記録の${match[1]}/${match[2]}セグメントを分析中…`;
    match = /^AI 正在分析第 (\d+)\/(\d+) 段记录…$/.exec(source);
    if (match) return locale === 'en-US'
      ? `AI is analyzing entries, segment ${match[1]}/${match[2]}…`
      : `AI が記録の${match[1]}/${match[2]}セグメントを分析中…`;
    match = /^正在接收总结正文，已收到 (\d+) 字…$/.exec(source);
    if (match) return locale === 'en-US'
      ? `Receiving the summary; ${match[1]} characters received…`
      : `まとめを受信中。${match[1]}文字を受信しました…`;
    match = /^正在继续整理总结正文（第 (\d+) 次）…$/.exec(source);
    if (match) return locale === 'en-US'
      ? `Continuing to organize the summary (attempt ${match[1]})…`
      : `まとめを整理中（${match[1]}回目）…`;
    if (source === '正在继续整理总结正文…') return locale === 'en-US' ? 'Continuing to organize the summary…' : 'まとめを整理中…';
    if (source === '正在继续生成总结…') return locale === 'en-US' ? 'Continuing to generate the summary…' : 'まとめを生成中…';
    if (source === '正文流式输出完成，准备保存完整报告…') return locale === 'en-US' ? 'Streaming output complete; preparing to save the full report…' : '本文のストリーミング出力が完了しました。完全なレポートを保存中…';
    if (source === '正在保存报告正文、完整性清单和原始记录明细…') return locale === 'en-US' ? 'Saving the report, completeness checklist, and original entry details…' : 'レポート本文、完全性チェック、元の記録詳細を保存中…';
    if (source === '报告已保存，可以查看、编辑或导出。') return locale === 'en-US' ? 'Report saved. You can view, edit, or export it.' : 'レポートを保存しました。表示、編集、エクスポートができます。';
    if (source === '正文已生成，正在保存完整报告。') return locale === 'en-US' ? 'The main text is ready; saving the full report.' : '本文を生成しました。完全なレポートを保存中です。';
    if (source === '生成过程中发生错误。') return locale === 'en-US' ? 'An error occurred during generation.' : '生成中にエラーが発生しました。';
    if (source === '正在对照历史记录和本期记录…') return locale === 'en-US' ? 'Comparing historical and current-period entries…' : '履歴と今回の記録を照合中…';
    if (source === '正在连接 AI，准备对照历史记录…') return locale === 'en-US' ? 'Connecting to AI and preparing the historical comparison…' : 'AI に接続し、履歴との照合を準備中…';
    if (source === '近期闭环已保存。') return locale === 'en-US' ? 'Recent closures saved.' : '最近の完了事項を保存しました。';
    if (source === '近期闭环已保存；详细过程默认收起。') return locale === 'en-US' ? 'Recent closures saved; details are collapsed by default.' : '最近の完了事項を保存しました。詳細は初期状態で閉じられています。';
    match = /^正在分析历史记录第 (\d+)\/(\d+) 批…$/.exec(source);
    if (match) return locale === 'en-US' ? `Analyzing historical entries, batch ${match[1]}/${match[2]}…` : `履歴の${match[1]}/${match[2]}バッチを分析中…`;
    match = /^AI 正在判断历史记录与本期记录的语义关系（第 (\d+)\/(\d+) 批）…$/.exec(source);
    if (match) return locale === 'en-US' ? `AI is comparing historical and current entries (batch ${match[1]}/${match[2]})…` : `AI が履歴と今回の記録の意味関係を判定中（${match[1]}/${match[2]}バッチ）…`;
    match = /^正在整理第 (\d+)\/(\d+) 批结构化结果…$/.exec(source);
    if (match) return locale === 'en-US' ? `Organizing structured results, batch ${match[1]}/${match[2]}…` : `構造化結果の${match[1]}/${match[2]}バッチを整理中…`;
    if (source === '正在继续整理闭环结果…') return locale === 'en-US' ? 'Continuing to organize closure results…' : '完了事項の結果を整理中…';
    if (source === '正在继续分析闭环结果…') return locale === 'en-US' ? 'Continuing to analyze closure results…' : '完了事項の結果を分析中…';
    match = /^已完成第 (\d+)\/(\d+) 批历史对照…$/.exec(source);
    if (match) return locale === 'en-US' ? `Historical comparison batch ${match[1]}/${match[2]} complete…` : `履歴照合の${match[1]}/${match[2]}バッチが完了…`;
    match = /^开始扫描全部 (\d+) 条日报…$/.exec(source);
    if (match) return locale === 'en-US' ? `Scanning all ${match[1]} entries…` : `全${match[1]}件の日報をスキャン中…`;
    match = /^正在识别第 (\d+)\/(\d+) 批日报…$/.exec(source);
    if (match) return locale === 'en-US' ? `Analyzing entries, batch ${match[1]}/${match[2]}…` : `日報の${match[1]}/${match[2]}バッチを認識中…`;
    match = /^AI 正在分析第 (\d+)\/(\d+) 批日报…$/.exec(source);
    if (match) return locale === 'en-US' ? `AI is analyzing entries, batch ${match[1]}/${match[2]}…` : `AI が日報の${match[1]}/${match[2]}バッチを分析中…`;
    match = /^正在整理第 (\d+)\/(\d+) 批 AI 输出…$/.exec(source);
    if (match) return locale === 'en-US' ? `Organizing AI output, batch ${match[1]}/${match[2]}…` : `AI 出力の${match[1]}/${match[2]}バッチを整理中…`;
    match = /^已完成第 (\d+)\/(\d+) 批，正在保留候选术语…$/.exec(source);
    if (match) return locale === 'en-US' ? `Batch ${match[1]}/${match[2]} complete; preserving candidate terms…` : `${match[1]}/${match[2]}バッチが完了。候補用語を保持中…`;
    if (source === '正在合并跨批次的同义叫法…') return locale === 'en-US' ? 'Merging equivalent names across batches…' : 'バッチ間の同義語を統合中…';
    match = /^词典已保存，共 (\d+) 组术语。$/.exec(source);
    if (match) return locale === 'en-US' ? `Dictionary saved with ${match[1]} terminology groups.` : `用語辞書を保存しました。${match[1]}組です。`;
    return source;
  }

  function translateText(value) {
    const source = String(value || '');
    const leading = source.match(/^\s*/)?.[0] || '';
    const trailing = source.match(/\s*$/)?.[0] || '';
    const core = source.slice(leading.length, source.length - trailing.length || source.length);
    const translatedCore = currentLocale === localeApi.DEFAULT_LOCALE ? core : localizePattern(core);
    const translated = leading + translatedCore + trailing;
    rememberRenderedSource(translated, source);
    return translated;
  }

  const ignoredTags = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE']);
  const ignoredClasses = new Set(['report-content', 'report-editor', 'entry-text', 'report-source-entry', 'report-thinking-content']);
  const textSources = new WeakMap();
  const textRendered = new WeakMap();
  const attributeSources = new WeakMap();
  const attributeRendered = new WeakMap();
  // 动态渲染器通常会先调用 t() 再把结果放入 DOM。记录“译文 -> 源文案”，
  // 避免 MutationObserver 在非中文界面首次看到动态节点时，把译文误当成源文案。
  // 否则下一次切换语言时，节点没有可供反向翻译的中文键，会残留上一种语言。
  const renderedSourceHints = new Map();
  let titleSource = '';
  let titleRendered = '';

  function rememberRenderedSource(rendered, source) {
    if (!rendered || !source || rendered === source) return;
    const candidates = renderedSourceHints.get(rendered) || [];
    if (!candidates.includes(source)) candidates.push(source);
    // 用户可以长时间运行应用；限制提示表规模，避免动态错误文本无限增长。
    if (candidates.length > 8) candidates.splice(0, candidates.length - 8);
    renderedSourceHints.set(rendered, candidates);
    if (renderedSourceHints.size > 2000) {
      const oldest = renderedSourceHints.keys().next().value;
      if (oldest !== undefined) renderedSourceHints.delete(oldest);
    }
  }

  function sourceHintFor(rendered) {
    const candidates = renderedSourceHints.get(rendered);
    return candidates?.[candidates.length - 1] || '';
  }

  function shouldSkip(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el) {
      if (ignoredTags.has(el.tagName)) return true;
      if ([...ignoredClasses].some(name => el.classList?.contains(name))) return true;
      el = el.parentElement;
    }
    return false;
  }

  function translateTextNode(node) {
    if (!node || shouldSkip(node)) return;
    const current = node.nodeValue || '';
    const previous = textRendered.get(node);
    const source = sourceHintFor(current)
      || (previous !== undefined && current === previous ? textSources.get(node) || current : current);
    const translated = translateText(source);
    textSources.set(node, source);
    textRendered.set(node, translated);
    if (translated !== current) node.nodeValue = translated;
  }

  function translateElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      if (element.hasAttribute(attr)) {
        const current = element.getAttribute(attr) || '';
        const sources = attributeSources.get(element) || {};
        const rendered = attributeRendered.get(element) || {};
        const source = sourceHintFor(current)
          || (rendered[attr] !== undefined && current === rendered[attr]
            ? sources[attr] || current
            : current);
        const translated = translateText(source);
        sources[attr] = source;
        rendered[attr] = translated;
        attributeSources.set(element, sources);
        attributeRendered.set(element, rendered);
        if (translated !== current) element.setAttribute(attr, translated);
      }
    }
  }

  function applyDocument() {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = currentLocale;
    const currentTitle = document.title || '日报随手记';
    const sourceTitle = titleRendered && currentTitle === titleRendered ? titleSource : currentTitle;
    titleSource = sourceTitle;
    document.title = translateText(sourceTitle);
    titleRendered = document.title;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    textNodes.forEach(translateTextNode);
    document.querySelectorAll('*').forEach(translateElement);
  }

  async function setLocale(value) {
    const next = localeApi.normalizeLocale(value) || localeApi.DEFAULT_LOCALE;
    const serial = ++localeLoadSerial;
    if (!loadedLocales.has(next)) {
      const bundle = await loadLocaleBundle(next);
      if (!bundle || serial !== localeLoadSerial) return currentLocale;
    }
    if (serial !== localeLoadSerial) return currentLocale;
    currentLocale = next;
    try { localStorage.setItem('locale:cache', next); } catch { /* 忽略 */ }
    applyDocument();
    if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
      document.dispatchEvent(new CustomEvent('dr:locale-changed', { detail: next }));
    }
    return next;
  }

  const api = {
    get locale() { return currentLocale; },
    locales: localeApi.SUPPORTED_LOCALES.slice(),
    t: value => translateText(value),
    translateText,
    applyDocument,
    setLocale
  };
  root.DRI18n = api;

  if (typeof document !== 'undefined') {
    applyDocument();
    loadLocaleBundle(currentLocale).then(() => applyDocument());
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        else if (mutation.type === 'attributes') translateElement(mutation.target);
        else mutation.addedNodes.forEach(added => {
          if (added.nodeType === Node.TEXT_NODE) translateTextNode(added);
          else if (added.nodeType === Node.ELEMENT_NODE) {
            translateElement(added);
            added.querySelectorAll?.('*').forEach(translateElement);
            const walker = document.createTreeWalker(added, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            let node;
            while ((node = walker.nextNode())) textNodes.push(node);
            textNodes.forEach(translateTextNode);
          }
        });
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'placeholder', 'aria-label']
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
