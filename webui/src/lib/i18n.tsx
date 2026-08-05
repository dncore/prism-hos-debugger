import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'prism-lang';

function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'zh') return stored;
  const nav = navigator.language || '';
  return nav.startsWith('zh') ? 'zh' : 'en';
}

// ── Translation dictionary ──────────────────────────────────────────

const dict: Record<Lang, Record<string, string>> = {
  en: {
    'app.no_debuggable': 'No debuggable apps',
    'app.loading': 'Loading apps...',
    'app.select': 'Select target app...',
    'app.device_offline': 'Device offline',

    'capture.capturing': 'Capturing PID {pid}',
    'capture.failed': 'Capture failed: {msg}',
    'capture.restart_title': 'Restart Required',
    'capture.restart_message': 'The app was already running and profiler hooks only attach to new connections. Kill the app, then manually reopen it on the device?',
    'capture.restart_confirm': 'Kill App',
    'capture.restart_cancel': 'Skip',
    'capture.app_killed': 'App killed — reopen it on the device. Waiting for new PID...',
    'capture.kill_failed': 'Failed to kill app: {msg}',
    'capture.initializing': 'Initializing...',
    'capture.listening': 'Listening',
    'capture.idle': 'Idle',
    'capture.clear': 'Clear',
    'capture.reconnecting': 'App restarted (PID {pid}) — reconnecting',

    'device.connected': 'Connected: {id}',
    'device.offline': 'Device {id} is offline — apps may be empty',
    'device.select_failed': 'Failed to select device: {msg}',
    'device.no_device': 'No device',

    'detail.select': 'Select a request',
    'detail.no_body': 'No response body',
    'detail.no_timing': 'No timing data',
    'detail.override': 'Override',
    'detail.override_tag': 'OVERRIDE',

    'empty.select_app': 'Select an app above to begin capture',

    'filter.system_on': 'Showing user apps only (click to show all)',
    'filter.system_off': 'Showing all apps (click to hide system)',
    'filter.filter_urls': 'method:GET status:4xx type:json…',

    'headers.label': 'Headers',
    'headers.request': 'Request Headers',
    'headers.response': 'Response Headers',
    'headers.empty': '{label}: (empty)',
    'headers.remote': 'Remote: {addr}',

    'override.title': 'Override Rules',
    'override.quick': 'Quick Override',
    'override.matching': 'Matching Rules ({n})',
    'override.all': 'All Rules ({n})',
    'override.no_match': 'No rules match this URL',
    'override.no_rules': 'No rules yet',
    'override.new_rule': 'New Rule',
    'override.edit_rule': 'Edit Rule',
    'override.name_placeholder': 'Rule name (auto-generated if empty)',
    'override.pattern_placeholder': 'URL pattern (prefix match)',
    'override.redirect_placeholder': 'Redirect target URL',
    'override.status_placeholder': 'Status code (e.g. 404)',
    'override.latency_placeholder': 'Latency in ms (e.g. 2000)',
    'override.body_placeholder': 'Response body (JSON or text)...',
    'override.save': 'Create',
    'override.update': 'Update',
    'override.cancel': 'Cancel',
    'override.saving': 'Saving...',
    'override.block': 'Block',
    'override.redirect': 'Redirect',
    'override.mock_body': 'Mock Body',
    'override.status': 'Status',
    'override.latency': 'Latency',
    'override.delete': 'Delete?',
    'override.deleted': 'Rule deleted',
    'override.created': 'Created',
    'override.updated': 'Updated',

    'payload.label': 'Payload',
    'payload.request_body': 'Request Body',
    'payload.none': 'None',

    'preview.label': 'Preview',

    'refresh.app_list': 'Refresh app list',

    'requests.count': '{n} requests',
    'requests.name': 'Name',
    'requests.time': 'Time',
    'requests.waterfall': 'Waterfall',

    'response.label': 'Response',
    'response.body_size': 'Body ({n} bytes)',

    'rule.block': 'Block Request',
    'rule.redirect': 'Redirect URL',
    'rule.mock_body': 'Mock Response Body',
    'rule.status': 'Modify Status Code',
    'rule.latency': 'Add Latency',
    'rule.header_modify': 'Modify Request Headers',
    'rule.response_headers': 'Modify Response Headers',

    'tab.headers': 'Headers',
    'tab.payload': 'Payload',
    'tab.preview': 'Preview',
    'tab.response': 'Response',
    'tab.timing': 'Timing',
    'tab.override': 'Override',

    'timing.label': 'Timing',
    'timing.dns': 'DNS',
    'timing.tcp': 'TCP',
    'timing.tls': 'TLS',
    'timing.ttfb': 'TTFB',
    'timing.download': 'Download',

    'tooltip.title': 'Capture flow',
    'tooltip.step1': 'App must set "profileable": true in AppScope/app.json5',
    'tooltip.step2': 'Start prism before launching the app',
    'tooltip.step3': 'Kill & reopen the app on the device',
    'tooltip.step4': 'Select the app in the picker to begin capture',
    'tooltip.footer': 'Without profileable, the system blocks the profiler from hooking the process. The app must be killed and restarted after prism starts — existing connections cannot be captured.',

    'theme.toggle': 'Toggle theme',
  },
  zh: {
    'app.no_debuggable': '无可调试应用',
    'app.loading': '加载应用中...',
    'app.select': '选择目标应用...',
    'app.device_offline': '设备离线',

    'capture.capturing': '正在捕获 PID {pid}',
    'capture.failed': '捕获失败: {msg}',
    'capture.restart_title': '需要重启',
    'capture.restart_message': '应用已在运行，profiler hook 只能拦截新建连接。杀掉应用后在设备上手动重新打开？',
    'capture.restart_confirm': '杀应用',
    'capture.restart_cancel': '跳过',
    'capture.app_killed': '应用已杀 — 请在设备上手动重新打开。等待新 PID...',
    'capture.kill_failed': '杀进程失败: {msg}',
    'capture.initializing': '初始化中...',
    'capture.listening': '监听中',
    'capture.idle': '空闲',
    'capture.clear': '清空',
    'capture.reconnecting': '应用已重启 (PID {pid}) — 重新连接',

    'device.connected': '已连接: {id}',
    'device.offline': '设备 {id} 离线 — 应用列表可能为空',
    'device.select_failed': '切换设备失败: {msg}',
    'device.no_device': '无设备',

    'detail.select': '选择一个请求',
    'detail.no_body': '无响应体',
    'detail.no_timing': '无耗时数据',
    'detail.override': 'Override',
    'detail.override_tag': 'OVERRIDE',

    'empty.select_app': '在上方选择一个应用开始捕获',

    'filter.system_on': '仅显示用户应用 (点击显示全部)',
    'filter.system_off': '显示全部应用 (点击隐藏系统)',
    'filter.filter_urls': 'method:GET status:4xx -status:200 type:json…',

    'headers.label': 'Headers',
    'headers.request': '请求头',
    'headers.response': '响应头',
    'headers.empty': '{label}: (空)',
    'headers.remote': '远端: {addr}',

    'override.title': 'Override 规则',
    'override.quick': '快速 Override',
    'override.matching': '匹配的规则 ({n})',
    'override.all': '全部规则 ({n})',
    'override.no_match': '没有规则匹配此 URL',
    'override.no_rules': '暂无规则',
    'override.new_rule': '新建规则',
    'override.edit_rule': '编辑规则',
    'override.name_placeholder': '规则名称 (留空自动生成)',
    'override.pattern_placeholder': 'URL 模式 (前缀匹配)',
    'override.redirect_placeholder': '重定向目标 URL',
    'override.status_placeholder': '状态码 (如 404)',
    'override.latency_placeholder': '延迟毫秒 (如 2000)',
    'override.body_placeholder': '响应体 (JSON 或文本)...',
    'override.save': '创建',
    'override.update': '更新',
    'override.cancel': '取消',
    'override.saving': '保存中...',
    'override.block': '拦截',
    'override.redirect': '重定向',
    'override.mock_body': '模拟响应',
    'override.status': '状态码',
    'override.latency': '延迟',
    'override.delete': '确认删除?',
    'override.deleted': '已删除',
    'override.created': '已创建',
    'override.updated': '已更新',

    'payload.label': 'Payload',
    'payload.request_body': '请求体',
    'payload.none': '无',

    'preview.label': '预览',

    'refresh.app_list': '刷新应用列表',

    'requests.count': '{n} 个请求',
    'requests.name': '名称',
    'requests.time': '耗时',
    'requests.waterfall': '瀑布图',

    'response.label': '响应',
    'response.body_size': '响应体 ({n} bytes)',

    'rule.block': '拦截请求',
    'rule.redirect': '重定向 URL',
    'rule.mock_body': '模拟响应体',
    'rule.status': '修改状态码',
    'rule.latency': '增加延迟',
    'rule.header_modify': '修改请求头',
    'rule.response_headers': '修改响应头',

    'tab.headers': 'Headers',
    'tab.payload': 'Payload',
    'tab.preview': '预览',
    'tab.response': '响应',
    'tab.timing': '耗时',
    'tab.override': 'Override',

    'timing.label': 'Timing',
    'timing.dns': 'DNS',
    'timing.tcp': 'TCP',
    'timing.tls': 'TLS',
    'timing.ttfb': 'TTFB',
    'timing.download': '下载',

    'tooltip.title': '捕获流程',
    'tooltip.step1': 'App 必须在 AppScope/app.json5 配置 "profileable": true',
    'tooltip.step2': '先启动 prism，再启动目标应用',
    'tooltip.step3': '设备上杀掉并重新打开应用',
    'tooltip.step4': '在 Web UI 选择器中选中应用开始捕获',
    'tooltip.footer': '没有 profileable 配置，系统会阻止 profiler hook 进程。应用必须在 prism 启动后被杀死并重启 — 已有连接无法被捕获。',

    'theme.toggle': '切换主题',
  },
};

// ── Context ──────────────────────────────────────────────────────────

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nCtx>(null!);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let s = dict[lang][key] ?? dict.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(`{${k}}`, String(v));
        }
      }
      return s;
    },
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
