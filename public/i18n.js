import { english } from './locale-en.js';
const supported = new Set(['ko', 'en']);
function initialLocale() {
  if (typeof document === 'undefined') return 'ko';
  const requested = new URL(location.href).searchParams.get('lang');
  if (supported.has(requested)) return requested;
  try { const saved = localStorage.getItem('manage-a.locale'); if (supported.has(saved)) return saved; } catch {}
  return navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
let locale = initialLocale();
export function getLocale() { return locale; }
export function setLocale(value) {
  if (!supported.has(value)) throw new Error('Unsupported language');
  locale = value;
  if (typeof document !== 'undefined') {
    try { localStorage.setItem('manage-a.locale', value); } catch {}
    const url = new URL(location.href);
    url.searchParams.set('lang', value);
    location.assign(url.href);
  }
}
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(Object.keys(english).sort((a,b) => b.length - a.length).map(escapeRegExp).join('|'), 'g');
// Only source-owned literal segments pass through this function. Interpolated
// names, notes, paths and other user data are never translated implicitly.
export function t(value) {
  const text = String(value ?? '');
  return locale === 'ko' ? text : text.replace(pattern, source => english[source]);
}
export function ui(strings, ...values) {
  return strings.reduce((out, segment, i) => out + t(segment) + (i < values.length ? String(values[i] ?? '') : ''), '');
}
export function diagnostic(value) {
  const translated = t(value);
  if (locale === 'en' && /[가-힣]/.test(translated)) {
    return 'Check the connection, account permissions, and settings. Original diagnostic: ' + String(value ?? '');
  }
  return translated;
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale;
  document.title = locale === 'en' ? 'Manage-A — Local project dashboard' : 'Manage-A — 로컬 프로젝트 관리 대시보드';
  const loading = document.querySelector('#app > .loading');
  if (loading && locale === 'en') loading.textContent = 'Loading Manage-A…';
}

export function quotaLabel(value, source) {
  return ['claude_cli','claude_statusline','codex_cli','codex_app'].includes(source) ? t(value) : String(value ?? '');
}
export function accountAlias(account) {
  return account?.kind === 'token' ? account.label : t(account?.label || '');
}
