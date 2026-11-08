/** Saved lines, stations, bus stops and routes: one tap from the home screen. Kept on this device only. */
import { useCallback, useState } from 'react';
import type { Route } from './route';

export interface SavedItem {
  route: Exclude<Route, { page: 'home' }>;
  name: string;
  /** Extra context, e.g. "towards Marble Arch" for a bus stop. */
  detail?: string;
}

const KEY = 'tfl:saved';
const same = (a: SavedItem['route'], b: SavedItem['route']) => a.page === b.page && a.id === b.id;

function read(): SavedItem[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? (v as SavedItem[]).filter((x) => x && x.route && typeof x.name === 'string') : [];
  } catch {
    return [];
  }
}

export function useSaved() {
  const [items, setItems] = useState<SavedItem[]>(read);
  const write = (next: SavedItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private mode or full storage: saving just won't persist.
    }
  };
  const isSaved = useCallback((r: SavedItem['route']) => items.some((i) => same(i.route, r)), [items]);
  const toggle = (item: SavedItem) =>
    write(isSaved(item.route) ? items.filter((i) => !same(i.route, item.route)) : [...items, item].slice(-12));
  return { items, isSaved, toggle };
}
