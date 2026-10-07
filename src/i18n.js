import ru from './locales/ru.json';
import en from './locales/en.json';

const catalogs = { ru, en };
const STORAGE_KEY = 'stlStudio.language';
let language = 'ru';
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (Object.hasOwn(catalogs, saved)) language = saved;
} catch { /* File URLs and restricted browsers may disable local storage. */ }

export function getLanguage() { return language; }
export function locale() { return language === 'en' ? 'en-US' : 'ru-RU'; }
export function t(key, values = {}) {
  const message = catalogs[language][key] ?? ru[key] ?? key;
  return message.replace(/\{(\w+)\}/g, (placeholder, name) => {
    if (!Object.hasOwn(values, name)) return placeholder;
    const value = values[name];
    return value?.translationKey ? t(value.translationKey) : (value?.message ?? String(value));
  });
}
export function localizedError(key) {
  const error = new Error(t(key));
  error.translationKey = key;
  return error;
}
export function setLanguage(value) {
  language = Object.hasOwn(catalogs, value) ? value : 'ru';
  try { localStorage.setItem(STORAGE_KEY, language); } catch { /* The switch still works for this session. */ }
  translateDOM();
}
export function translateDOM() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)); });
  const select = document.getElementById('language');
  if (select) select.value = language;
}
