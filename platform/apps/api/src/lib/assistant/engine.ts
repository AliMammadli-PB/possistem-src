/**
 * Retrieval over the knowledge base: every entry carries example questions,
 * each question becomes a weighted term set, and a query is scored against the
 * closest example (idf-weighted cosine). No model, no network.
 */
import type { FastifyInstance } from 'fastify';
import { terms, type Lang, type Term } from './text.js';

export type Trio = { az: string; en: string; ru: string };
export type Link = { href: string; label: Trio };
export type DynamicContext = { lang: Lang; customerId: string | null; app: FastifyInstance };
export const t = (az: string, en: string, ru: string): Trio => ({ az, en, ru });
export const link = (href: string, az: string, en: string, ru: string): Link => ({ href, label: t(az, en, ru) });
export type Entry = {
  id: string;
  title: Trio;
  q: string[];
  a: Trio | ((ctx: DynamicContext) => Promise<Trio>);
  links?: Link[];
  /** Follow-up entry ids offered as buttons. */
  chips?: string[];
  /** End the answer by asking whether to hand over to a live agent. */
  offerAgent?: boolean;
  /** At least one of these concepts must be in the query. */
  needs?: string[];
  /** Halve the score when one of these concepts is in the query. */
  avoid?: string[];
};

export type Match = { entry: Entry; score: number };

type Indexed = { entry: Entry; patterns: { terms: Map<string, number>; norm: number }[] };

export class KnowledgeIndex {
  private readonly items: Indexed[];
  private readonly idf = new Map<string, number>();
  readonly vocabulary = new Set<string>();
  readonly byId = new Map<string, Entry>();

  constructor(entries: Entry[]) {
    const raw = entries.map((entry) => {
      this.byId.set(entry.id, entry);
      return { entry, patterns: entry.q.map((q) => terms(q)) };
    });
    const df = new Map<string, number>();
    for (const item of raw) {
      const seen = new Set<string>();
      for (const pattern of item.patterns) for (const t of pattern) { seen.add(t.key); if (!t.key.startsWith('@')) this.vocabulary.add(t.key); }
      for (const key of seen) df.set(key, (df.get(key) ?? 0) + 1);
    }
    const n = raw.length;
    for (const [key, count] of df) this.idf.set(key, Math.log(1 + n / count));
    this.items = raw.map(({ entry, patterns }) => ({
      entry,
      patterns: patterns.map((pattern) => {
        const map = new Map<string, number>();
        for (const t of pattern) map.set(t.key, t.weight * this.weightOf(t.key));
        const norm = Math.sqrt([...map.values()].reduce((s, w) => s + w * w, 0)) || 1;
        return { terms: map, norm };
      }),
    }));
  }

  private weightOf(key: string): number {
    return this.idf.get(key) ?? 1;
  }

  analyse(text: string): Term[] {
    return terms(text, this.vocabulary);
  }

  rank(query: Term[], limit = 5): Match[] {
    const q = new Map<string, number>();
    for (const t of query) q.set(t.key, t.weight * (this.idf.get(t.key) ?? 1.2));
    const qNorm = Math.sqrt([...q.values()].reduce((s, w) => s + w * w, 0)) || 1;
    const concepts = new Set(query.map((t) => t.key));
    const out: Match[] = [];
    for (const item of this.items) {
      if (item.entry.needs && !item.entry.needs.some((c) => concepts.has(c))) continue;
      let best = 0;
      for (const pattern of item.patterns) {
        let dot = 0;
        for (const [key, w] of q) { const p = pattern.terms.get(key); if (p) dot += w * p; }
        if (!dot) continue;
        const cos = dot / (qNorm * pattern.norm);
        if (cos > best) best = cos;
      }
      if (!best) continue;
      if (item.entry.avoid?.some((c) => concepts.has(c))) best *= 0.5;
      // On a tie the entry that demanded a concept is the more specific answer.
      if (item.entry.needs) best += 0.002;
      out.push({ entry: item.entry, score: best });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
