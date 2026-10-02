import { describe, expect, it } from 'vitest';
import { dictionaries } from '../src/i18n/locales';
import { LOCALES } from '../src/i18n/types';
import { DELETE_ACCOUNT_PHRASES } from '../src/i18n/deleteAccountPhrase';

// 递归收集所有叶子键路径
function leafPaths(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafPaths(value, prefix ? `${prefix}.${key}` : key)
  );
}

function valueAt(dict: unknown, path: string): unknown {
  return path.split('.').reduce<any>((node, segment) => node?.[segment], dict);
}

function placeholders(value: unknown): string[] {
  return typeof value === 'string' ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : [];
}

// 类型层已能挡住漏键，这层用于挡住「用 as any 绕过类型」以及空文案、占位符不一致
describe('多语言字典一致性', () => {
  const basePaths = leafPaths(dictionaries['zh-CN']).sort();

  it('三种语言的键集合完全一致', () => {
    for (const locale of LOCALES) {
      expect(leafPaths(dictionaries[locale]).sort(), `语言 ${locale} 的键与基准不一致`).toEqual(basePaths);
    }
  });

  it('不存在空文案', () => {
    for (const locale of LOCALES) {
      const empty = basePaths.filter((path) => {
        const value = valueAt(dictionaries[locale], path);
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(empty, `语言 ${locale} 存在空文案`).toEqual([]);
    }
  });

  it('插值占位符在各语言中保持一致', () => {
    for (const locale of LOCALES) {
      for (const path of basePaths) {
        expect(
          placeholders(valueAt(dictionaries[locale], path)),
          `语言 ${locale} 的 ${path} 占位符与基准不一致`
        ).toEqual(placeholders(valueAt(dictionaries['zh-CN'], path)));
      }
    }
  });

  // 服务端接受的注销短语是一份手工维护的常量数组，类型系统管不到它：
  // 新增语言时字典会被 lint 强制补齐，但没人会想起还要往数组里加一条，
  // 结果该语言的用户会永久收到 CONFIRMATION_MISMATCH 而无法注销，且 CI 全绿。
  it('服务端接受的注销短语与三份字典逐条对应', () => {
    const fromDictionaries = LOCALES.map((locale) => dictionaries[locale].workspace.deleteAccountPhrase);
    expect([...DELETE_ACCOUNT_PHRASES].sort(), 'DELETE_ACCOUNT_PHRASES 与字典中的短语不一致').toEqual(
      [...fromDictionaries].sort()
    );
  });
});
