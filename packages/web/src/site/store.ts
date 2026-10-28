import { useCallback, useEffect, useState } from 'react';

const event = 'color-study-store';
const read = <T,>(key: string, fallback: T): T => {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => read(key, initial));
  useEffect(() => {
    const listener = (e: Event) => { if ((e as CustomEvent<string>).detail === key) setValue(read(key, initial)); };
    window.addEventListener(event, listener); return () => window.removeEventListener(event, listener);
  }, [key, initial]);
  const update = useCallback((next: T | ((previous: T) => T)) => {
    setValue(previous => {
      const resolved = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
      localStorage.setItem(key, JSON.stringify(resolved));
      window.dispatchEvent(new CustomEvent(event, { detail: key }));
      return resolved;
    });
  }, [key]);
  return [value, update] as const;
}
export type StudyStatus = 'none' | 'learning' | 'done';
export interface LocalWork { id: string; title: string; url: string; author: string; note: string; addedAt: string }
export interface AiSettings { baseUrl: string; model: string; imageSupport: boolean; remember: boolean }
export const defaultAi: AiSettings = { baseUrl: '', model: '', imageSupport: false, remember: false };

export const useFavorites = () => useStored<string[]>('cs:favorites', []);
export const useNotes = () => useStored<Record<string, string>>('cs:notes', {});
export const useStatuses = () => useStored<Record<string, StudyStatus>>('cs:statuses', {});
export const useWorks = () => useStored<LocalWork[]>('cs:works', []);
export const useAi = () => useStored<AiSettings>('cs:ai', defaultAi);
export const useTheme = () => useStored<'dark' | 'light'>('cs:theme', 'dark');

const KEY = 'cs:ai:key';
export const readApiKey = (remember: boolean) => remember ? localStorage.getItem(KEY) ?? '' : sessionStorage.getItem(KEY) ?? '';
export const saveApiKey = (key: string, remember: boolean) => {
  if (remember) { localStorage.setItem(KEY, key); sessionStorage.removeItem(KEY); }
  else { sessionStorage.setItem(KEY, key); localStorage.removeItem(KEY); }
};
export const clearApiKey = () => { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); };
export const hasApiKey = (remember: boolean) => Boolean(readApiKey(remember) || localStorage.getItem(KEY) || sessionStorage.getItem(KEY));

export function exportLocalData() {
  return { version: 1, exportedAt: new Date().toISOString(), favorites: read('cs:favorites', []), notes: read('cs:notes', {}), statuses: read('cs:statuses', {}), works: read('cs:works', []), ai: read('cs:ai', defaultAi) };
}
export function importLocalData(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('文件不是有效的调色书房数据。');
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.favorites) || typeof data.notes !== 'object' || typeof data.statuses !== 'object' || !Array.isArray(data.works)) throw new Error('文件缺少收藏、笔记、状态或作品数据。');
  localStorage.setItem('cs:favorites', JSON.stringify(data.favorites));
  localStorage.setItem('cs:notes', JSON.stringify(data.notes));
  localStorage.setItem('cs:statuses', JSON.stringify(data.statuses));
  localStorage.setItem('cs:works', JSON.stringify(data.works));
  if (data.ai && typeof data.ai === 'object') localStorage.setItem('cs:ai', JSON.stringify(data.ai));
  window.dispatchEvent(new CustomEvent(event, { detail: 'import' }));
}
export function clearLocalData() {
  for (const key of ['cs:favorites', 'cs:notes', 'cs:statuses', 'cs:works', 'cs:chats']) localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent(event, { detail: 'clear' }));
}
