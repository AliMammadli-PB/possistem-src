/**
 * The website support assistant. Deterministic: small talk, then the owner's
 * own numbers (when signed in), then retrieval over the knowledge base, with
 * follow-up buttons and a short conversation memory the client carries.
 */
import { appendFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { sql } from 'drizzle-orm';
import { parseBody, clientIp } from '../lib/validate.js';
import { requireSuperadmin } from '../plugins/auth.js';
import { rows } from '../lib/support-dispatch.js';
import { writeAudit } from '../lib/audit.js';
import { KnowledgeIndex, type Entry, type Link, type Trio } from '../lib/assistant/engine.js';
import { SITE_KB } from '../lib/assistant/kb-site.js';
import { OPS_KB } from '../lib/assistant/kb-ops.js';
import { detectLanguage, fold, type Lang, type Term } from '../lib/assistant/text.js';
import { catalogLines, catalogSearch } from '../lib/assistant/facts.js';
import { answerAccount, confirmPending, detectAccountIntent, weakProductIntent } from '../lib/assistant/account.js';

export const assistantIndex = new KnowledgeIndex([...SITE_KB, ...OPS_KB]);

const ANSWER_AT = 0.42;
const SUGGEST_AT = 0.24;
/** Unanswered questions, for growing the knowledge base. Production only, so test runs stay out of it. */
const MISS_LOG = process.env.ASSISTANT_MISS_LOG ?? (process.env.NODE_ENV === 'production' ? '/var/log/possistem-pos-control/assistant-misses.log' : '');

type Chip = { label: string; send: string };
export type AssistantReply = { id: string; title?: string; text: string; links: { href: string; label: string }[]; chips: Chip[]; confirm?: { token: string; summary: string }; needLogin?: boolean; handoff?: boolean };
type Context = { last?: string; turn?: number; offered?: boolean };

const pick = (x: Trio, lang: Lang) => x[lang] || x.az;
const say = (lang: Lang, az: string, en: string, ru: string) => (lang === 'ru' ? ru : lang === 'en' ? en : az);

/** Buttons that run an account question rather than open an article. */
const SPECIAL_CHIPS: Record<string, { label: Trio; send: string }> = {
  agent_yes: { label: { az: 'Bəli, əməkdaşa yönləndir', en: 'Yes, connect me', ru: 'Да, соедините' }, send: '#agent:yes' },
  agent_no: { label: { az: 'Xeyr, təşəkkürlər', en: 'No, thanks', ru: 'Нет, спасибо' }, send: '#agent:no' },
  // "Talk to a person" buttons ask first instead of jumping straight into the hand-over.
  human: { label: { az: 'Əməkdaşa yönləndir', en: 'Talk to an agent', ru: 'Связаться со специалистом' }, send: '#agent:ask' },
  low_stock_chip: { label: { az: 'Az qalan mallar', en: 'Low stock', ru: 'Что заканчивается' }, send: 'az qalan mallar' },
  acc_profit_chip: { label: { az: 'Qazancımı göstər', en: 'Show my profit', ru: 'Показать прибыль' }, send: 'qazancımı de' },
  top_chip: { label: { az: 'Ən çox satılanlar', en: 'Best sellers', ru: 'Лидеры продаж' }, send: 'ən çox satılan mallar' },
};

function chipsFor(ids: string[] | undefined, lang: Lang, skip?: string): Chip[] {
  const out: Chip[] = [];
  for (const id of ids ?? []) {
    if (id === skip) continue;
    const special = SPECIAL_CHIPS[id];
    if (special) { out.push({ label: pick(special.label, lang), send: special.send }); continue; }
    const entry = assistantIndex.byId.get(id);
    if (entry) out.push({ label: pick(entry.title, lang), send: `#kb:${id}` });
  }
  return out.slice(0, 4);
}

const links = (list: Link[] | undefined, lang: Lang) => (list ?? []).map((l) => ({ href: l.href, label: pick(l.label, lang) }));

const AGENT_QUESTION: Trio = { az: 'Sizi canlı əməkdaşa yönləndirim?', en: 'Shall I connect you with a live agent?', ru: 'Соединить вас со специалистом?' };

/** Bot first, then a live agent: the answer ends by offering the hand-over (WhatsApp comes only if no agent takes it). */
function offerAgent(reply: AssistantReply, lang: Lang): AssistantReply {
  return { ...reply, text: `${reply.text}\n\n${pick(AGENT_QUESTION, lang)}`, chips: [...chipsFor(['agent_yes', 'agent_no'], lang), ...reply.chips.filter((c) => c.send !== '#agent:ask')].slice(0, 4) };
}

async function render(app: FastifyInstance, entry: Entry, lang: Lang, customerId: string | null, prefix = ''): Promise<AssistantReply> {
  const body = typeof entry.a === 'function' ? await entry.a({ app, lang, customerId }) : entry.a;
  const reply: AssistantReply = { id: entry.id, title: pick(entry.title, lang), text: prefix + pick(body, lang), links: links(entry.links, lang), chips: chipsFor(entry.chips, lang, entry.id) };
  return entry.offerAgent ? offerAgent(reply, lang) : reply;
}

const GREETING = /^(salam|slm|sa|selam|salamlar|salam aleykum|salam eleykum|salamaleykum|aleykum salam|hello|hi|hey|good (morning|afternoon|evening)|sabahiniz xeyir|sabahin xeyir|axsaminiz xeyir|axsamin xeyir|gunortaniz xeyir|привет|здравствуйте|добрый (день|вечер)|доброе утро)\b\s*/;

function smallTalk(f: string, lang: Lang): AssistantReply | 'greet-prefix' | null {
  const r = (id: string, text: string, chips: string[] = []): AssistantReply => ({ id, text, links: [], chips: chipsFor(chips, lang) });
  const rest = f.replace(GREETING, '').trim();
  if (GREETING.test(f) && (!rest || /^(necesen|necesiz|necesiniz|ne var ne yox|how are you|как дела|qardas|xanim|bey)$/.test(rest))) {
    return r('greeting', say(lang, 'Salam! Buyurun, sizə necə kömək edə bilərəm? Proqram, quraşdırma, avadanlıq və ya hesabınızdakı satış haqqında soruşa bilərsiniz.', 'Hello! How can I help? Ask about the software, installation, hardware or your own sales.', 'Здравствуйте! Чем помочь? Спросите о программе, установке, оборудовании или своих продажах.'), ['products', 'install', 'pricing', 'assistant_skills']);
  }
  if (GREETING.test(f) && rest) return 'greet-prefix';
  if (/^(sen |siz |bes siz |bes sen )?(necesen|necesiz|necesiniz|netersen|ne var ne yox|how are you|как дела|как ты)( sen| siz)?$/.test(f)) {
    return r('wellbeing', say(lang, 'Çox sağ olun, yaxşıyam! Siz necəsiniz? Possistem ilə bağlı nə sualınız var?', 'I’m well, thank you! How can I help with Possistem?', 'Спасибо, всё хорошо! Чем помочь с Possistem?'));
  }
  if (/^(yaxsiyam|yaxsiyiq|ela|normalam|normal|pis deyil|fine|good|хорошо|нормально)( cox sag ol| sagol| tesekkurler| thanks)?$/.test(f)) {
    return r('wellbeing', say(lang, 'Çox gözəl! Sizə hansı mövzuda kömək edim?', 'Great! What can I help you with?', 'Отлично! Чем могу помочь?'), ['products', 'install', 'assistant_skills']);
  }
  if (/^(cox )?(sag ol(un)?|sagol(un)?|tesekkur(ler)?( edirem)?|minnetdaram|thanks|thank you|thx|спасибо|благодарю)( cox| size| qardas)?$/.test(f)) {
    return r('thanks', say(lang, 'Buyurun! Başqa sualınız olsa, yazın.', 'You’re welcome! Ask anything else any time.', 'Пожалуйста! Пишите, если будут вопросы.'));
  }
  if (/^(helelik|gorusenedek|gorusmek uzre|bye|goodbye|до свидания|пока)$/.test(f)) {
    return r('farewell', say(lang, 'Görüşənədək! Yenə sualınız olsa, buradayam.', 'Goodbye! I’m here if you need anything.', 'До свидания! Обращайтесь.'));
  }
  if (/^(hell oldu|hell olundu|duzeldi|indi isleyir|alindi|oldu|it works|fixed|решено|заработало|получилось)$/.test(f)) {
    return r('resolved', say(lang, 'Sevindim! Başqa sualınız varsa, yazın.', 'Glad it works! Anything else?', 'Рад, что получилось! Ещё вопросы?'));
  }
  if (/^(ok|oke|okay|tamam|aydindir|basa dusdum|hm+|ага|понятно|ясно)$/.test(f)) {
    return r('ack', say(lang, 'Əla. Başqa nə ilə kömək edim?', 'Great. What else can I help with?', 'Хорошо. Чем ещё помочь?'));
  }
  if (/^(live agent|liveagent|canli (destek|emekdas)|operator|emekdasa yaz|insanla danis(maq)?|human|agent|оператор)$/.test(f)) {
    return { id: 'handoff', text: say(lang, 'Sizi əməkdaşa yönləndirirəm.', 'Connecting you with an agent.', 'Передаю специалисту.'), links: [], chips: [], handoff: true };
  }
  return null;
}

const CATALOG_ASK = /(^| )(sizde|sizden|satirsiz|satirsiniz|satilir|satisda var|do you (sell|have)|есть у вас|продаете|продаёте)( |$)/;
const PROBLEM_ONLY = new Set(['@problem', '@support', '@human']);
const FAULT_BY_TOPIC: Record<string, string> = { '@demo': 'demo_problem', '@stock': 'stock_problem', '@printer': 'printer_problem', '@scanner': 'scanner_problem', '@scale': 'scale_problem', '@drawer': 'drawer_problem', '@login': 'login_problem', '@install': 'install_problem', '@update': 'update_problem', '@sync': 'sync_problem' };
const PLATFORM_ENTRIES = new Set(['mac', 'win7', 'requirements', 'ios', 'android_app', 'install', 'install_problem']);

async function catalogReply(app: FastifyInstance, f: string, lang: Lang, requireHit: boolean): Promise<AssistantReply | null> {
  const found = await catalogSearch(app, f);
  const catalogLink = { href: '/mehsul/avadanliq/', label: say(lang, 'Avadanlıq kataloqu', 'Hardware catalogue', 'Каталог оборудования') };
  if (found.hits.length) {
    const more = found.total > found.hits.length ? say(lang, `\n…və daha ${found.total - found.hits.length} məhsul kataloqda.`, `\n…and ${found.total - found.hits.length} more in the catalogue.`, `\n…и ещё ${found.total - found.hits.length} в каталоге.`) : '';
    const product = (p: { slug?: string; id: string; name: string }) => ({ href: `/mehsul/avadanliq/${encodeURIComponent(p.slug || p.id)}/`, label: p.name });
    return offerAgent({
      id: 'catalog',
      text: `${say(lang, 'Kataloqda tapdım', 'Found in the catalogue', 'Нашёл в каталоге')} (${found.total}):\n${catalogLines(found.hits, lang)}${more}\n\n${say(lang, 'Qiyməti göstərilməyən məhsulu əməkdaşımızdan soruşa bilərsiniz. Partnyorlar daxil olub xüsusi qiyməti görür.', 'For items without a listed price, ask our agent. Partners see special prices after signing in.', 'Цену товара без цены уточнит специалист. Партнёры видят спеццены после входа.')}`,
      links: [...found.hits.slice(0, 2).map(product), catalogLink].slice(0, 4),
      chips: chipsFor(['hw_buy', 'hardware'], lang),
    }, lang);
  }
  if (requireHit && !found.brandAsked) return null;
  const name = found.brandAsked ? found.brandAsked.toUpperCase() : '';
  return offerAgent({
    id: 'catalog_none',
    text: say(lang,
      `${name ? `Kataloqda «${name}» üzrə məhsul tapmadım.` : 'Kataloqda belə məhsul tapmadım.'} Kataloqdakı markalar: ${found.brands.join(', ')}.\n\nLazım olan modeli əməkdaşımız dəqiqləşdirə bilər.`,
      `${name ? `I found nothing for “${name}” in the catalogue.` : 'I found no such product in the catalogue.'} Brands we carry: ${found.brands.join(', ')}.\n\nOur agent can check the model you need.`,
      `${name ? `В каталоге по «${name}» ничего нет.` : 'В каталоге такого товара нет.'} Бренды в каталоге: ${found.brands.join(', ')}.\n\nНужную модель уточнит специалист.`),
    links: [catalogLink],
    chips: chipsFor(['hardware'], lang),
  }, lang);
}

function problemIntake(lang: Lang): AssistantReply {
  return {
    id: 'problem_intake',
    text: say(lang,
      'Kömək edim. Problemi bir cümlə ilə yazın: harada baş verir (kassa, printer, giriş, anbar, portal) və ekranda nə yazılır? Məsələn: “printer çap etmir”, “proqram açılmır”, “PIN səhvdir deyir”. Və ya aşağıdan seçin.',
      'Happy to help. Describe the problem in one sentence: where it happens (till, printer, sign-in, stock, portal) and what the screen says. E.g. “printer does not print”, “app will not open”. Or pick below.',
      'Помогу. Опишите проблему одним предложением: где (касса, принтер, вход, склад, портал) и что написано на экране. Например: «принтер не печатает», «программа не открывается». Или выберите ниже.'),
    links: [],
    chips: chipsFor(['printer_problem', 'install_problem', 'login_problem', 'sync_problem'], lang),
  };
}

function fallback(lang: Lang): AssistantReply {
  return {
    id: 'unknown',
    text: say(lang,
      'Sualınızı tam başa düşmədim. Başqa sözlə, bir cümlə ilə yazın — məsələn: “printer çap etmir”, “proqramı necə quraşdırım”, “bugünkü satış”, “anbarda cola var?”.\n\nVə ya sizi canlı əməkdaşa yönləndirim?',
      'I did not quite get that. Try one sentence in other words — e.g. “printer does not print”, “how do I install it”, “today’s sales”.\n\nOr shall I connect you with a live agent?',
      'Не совсем понял вопрос. Напишите одним предложением иначе — например: «принтер не печатает», «как установить», «продажи сегодня».\n\nИли соединить вас со специалистом?'),
    links: [],
    chips: chipsFor(['agent_yes', 'agent_no', 'products', 'install'], lang),
  };
}

async function logMiss(text: string, lang: Lang, best: number) {
  if (!MISS_LOG) return;
  const line = JSON.stringify({ at: new Date().toISOString(), lang, best: Number(best.toFixed(3)), text: text.slice(0, 300) });
  await appendFile(MISS_LOG, line + '\n').catch(() => undefined);
}

export async function assistantReply(app: FastifyInstance, raw: string, ui: Lang, customerId: string | null, context: Context = {}): Promise<{ reply: AssistantReply; context: Context }> {
  const text = raw.trim().slice(0, 1000);
  const lang = detectLanguage(text, ui);
  const next = (reply: AssistantReply): { reply: AssistantReply; context: Context } => ({ reply, context: { last: assistantIndex.byId.has(reply.id) ? reply.id : context.last, turn: (context.turn ?? 0) + 1, offered: reply.chips.some((c) => c.send === '#agent:yes') } });
  // A typed "hə" / "yox" answers the hand-over question we just asked.
  if (context.offered) {
    const answer = fold(text);
    if (/^(he|hee|beli|ok|oke|okay|olsun|olar|yes|yeah|sure|да|давайте|yonlendir|yonlendirin)$/.test(answer)) return assistantReply(app, '#agent:yes', lang, customerId, { ...context, offered: false });
    if (/^(yox|yoxe|xeyr|no|nope|нет|lazim deyil|ehtiyac yoxdur)$/.test(answer)) return assistantReply(app, '#agent:no', lang, customerId, { ...context, offered: false });
  }

  if (text === '#agent:yes') return next({ id: 'handoff', text: say(ui, 'Sizi əməkdaşa yönləndirirəm.', 'Connecting you with an agent.', 'Передаю специалисту.'), links: [], chips: [], handoff: true });
  if (text === '#agent:no') return next({ id: 'agent_declined', text: say(ui, 'Yaxşı. Başqa sualınız olsa, yazın — buradayam.', 'Okay. Ask anything else — I am here.', 'Хорошо. Пишите, если будут вопросы.'), links: [], chips: [] });
  if (text === '#agent:ask') return next({ id: 'agent_offer', text: pick(AGENT_QUESTION, ui), links: [], chips: chipsFor(['agent_yes', 'agent_no'], ui) });

  const direct = /^#kb:([a-z0-9_]+)$/.exec(text);
  if (direct) {
    const entry = assistantIndex.byId.get(direct[1]!);
    if (entry) return next(await render(app, entry, ui, customerId));
  }

  let f = fold(text);
  let prefix = '';
  const talk = smallTalk(f, lang);
  if (talk === 'greet-prefix') {
    f = f.replace(GREETING, '').trim();
    prefix = say(lang, 'Salam! ', 'Hello! ', 'Здравствуйте! ');
  } else if (talk) return next(talk);

  // Signed in, "mal əti var?" names a real product before it names an article.
  const weakFirst = customerId ? weakProductIntent(f) : null;
  if (weakFirst) {
    const answer = await answerAccount(app, customerId, weakFirst, lang);
    if (answer.id === 'acc_product') return next({ id: answer.id, text: prefix + answer.text, links: links(answer.links, lang), chips: chipsFor(answer.chips, lang) });
  }

  const intent = detectAccountIntent(f);
  if (intent) {
    const answer = await answerAccount(app, customerId, intent, lang);
    return next({ id: answer.id, text: prefix + answer.text, links: links(answer.links, lang), chips: chipsFor(answer.chips, lang), confirm: answer.confirm, needLogin: answer.needLogin });
  }

  const query = assistantIndex.analyse(f);
  let ranked = assistantIndex.rank(query);
  // A brand or model ("xprinter", "hp noutbuk") is a catalogue question — unless it asks about platforms ("Apple-da işləyir?").
  const catalogFirst = await catalogSearch(app, f);
  if (catalogFirst.brandKnown && !PLATFORM_ENTRIES.has(ranked[0]?.entry.id ?? '')) {
    const reply = await catalogReply(app, f, lang, true);
    if (reply) return next({ ...reply, text: prefix + reply.text });
  }
  const strong = query.filter((t) => t.weight >= 0.5);
  if (!context.last && strong.length > 0 && strong.every((t) => PROBLEM_ONLY.has(t.key)) && strong.some((t) => t.key === '@problem')) {
    return next({ ...problemIntake(lang), text: prefix + problemIntake(lang).text });
  }
  // "bəs restoran üçün?", "neçəyədir?" — short follow-ups lean on the previous answer.
  const last = context.last ? assistantIndex.byId.get(context.last) : undefined;
  // "işləmir", "çap etmir" right after a device or feature answer is about that device.
  const shortFault = query.some((t) => t.key === '@problem') && query.filter((t) => t.weight >= 0.5).length <= 2;
  if (last && ((ranked[0]?.score ?? 0) < ANSWER_AT || shortFault) && query.filter((t) => t.weight >= 0.5).length <= 3) {
    const carry: Term[] = assistantIndex.analyse(last.q[0] ?? '').filter((t) => !query.some((q) => q.key === t.key)).map((t) => ({ ...t, weight: t.weight * 0.6 }));
    const merged = assistantIndex.rank([...query, ...carry]);
    const better = (merged[0]?.score ?? 0) > (ranked[0]?.score ?? 0) || (shortFault && (merged[0]?.score ?? 0) >= ANSWER_AT);
    if (better && merged[0]!.entry.id !== last.id) ranked = merged;
  }

  // "anbarda və demoda problem var" — two named areas with a fault: ask which one first, do not guess.
  if (query.some((t) => t.key === '@problem')) {
    const named = [...new Set(query.map((t) => FAULT_BY_TOPIC[t.key]).filter((id): id is string => Boolean(id)))];
    if (named.length >= 2) return next({ id: 'problem_choice', text: prefix + say(lang, 'Bir neçə ayrı problem yazmısınız. Hansından başlayaq?', 'You mentioned more than one problem. Which one first?', 'Вы упомянули несколько проблем. С какой начнём?'), links: [], chips: chipsFor([...named.slice(0, 3), 'human'], lang) });
  }
  const best = ranked[0];
  // "operatorla danışmaq istəyirəm" is already the answer to the question we would ask.
  if (best && best.score >= ANSWER_AT && best.entry.id === 'human') return next({ id: 'handoff', text: say(lang, 'Sizi əməkdaşa yönləndirirəm.', 'Connecting you with an agent.', 'Передаю специалисту.'), links: [], chips: [], handoff: true });
  if (best && best.score >= ANSWER_AT) {
    const reply = await render(app, best.entry, lang, customerId, prefix);
    const second = ranked[1];
    if (second && second.score >= ANSWER_AT && best.score - second.score < 0.05 && !reply.chips.some((c) => c.send === `#kb:${second.entry.id}`)) {
      reply.chips = [...chipsFor([second.entry.id], lang), ...reply.chips].slice(0, 4);
    }
    return next(reply);
  }
  if (strong.length && strong.every((t) => PROBLEM_ONLY.has(t.key)) && strong.some((t) => t.key === '@problem')) return next({ ...problemIntake(lang), text: prefix + problemIntake(lang).text });
  // "LG var sizdə?" — nothing in the articles, so try the catalogue before giving up.
  if (CATALOG_ASK.test(f) || /(^| )(var|varmi)$/.test(f)) {
    const reply = await catalogReply(app, f, lang, !CATALOG_ASK.test(f));
    if (reply) return next({ ...reply, text: prefix + reply.text });
  }
  void logMiss(text, lang, best?.score ?? 0);
  if (best && best.score >= SUGGEST_AT) {
    const options = ranked.filter((m) => m.score >= SUGGEST_AT).slice(0, 3).map((m) => m.entry.id);
    return next({
      id: 'clarify',
      text: prefix + say(lang, 'Dəqiq başa düşdüyümə əmin deyiləm. Bunlardan birini soruşursunuz?', 'I am not sure I understood. Did you mean one of these?', 'Не уверен, что понял. Вы об одном из этого?'),
      links: [],
      chips: [...chipsFor(options, lang), ...chipsFor(['human'], lang)].slice(0, 4),
    });
  }
  const miss = fallback(lang);
  miss.text = prefix + miss.text;
  return next(miss);
}

export async function assistantRoutes(app: FastifyInstance) {
  app.post('/customer/assistant/reply', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parseBody(z.object({
      text: z.string().trim().min(1).max(1000),
      language: z.enum(['az', 'en', 'ru']).default('az'),
      context: z.object({ last: z.string().max(60).optional(), turn: z.number().int().min(0).max(10_000).optional(), offered: z.boolean().optional() }).optional(),
    }), req.body, reply);
    if (!body) return;
    reply.header('Cache-Control', 'no-store');
    try {
      return await assistantReply(app, body.text, body.language, req.customer?.id ?? null, body.context);
    } catch (error) {
      req.log.error({ err: error }, 'assistant_reply_failed');
      return { reply: { id: 'error', text: body.language === 'ru' ? 'Сейчас не получилось ответить. Попробуйте ещё раз или нажмите «Написать специалисту».' : body.language === 'en' ? 'I could not answer just now. Try again or choose “Contact an agent”.' : 'İndi cavab verə bilmədim. Bir daha yazın və ya “Əməkdaşa yaz” seçin.', links: [], chips: [] }, context: body.context ?? {} };
    }
  });

  const Rating = z.enum(['bad', 'fine', 'good']);
  const Line = z.object({ author: z.enum(['me', 'helper']), body: z.string().max(16000), createdAt: z.string().max(40).optional(), topic: z.string().max(80).optional(), rating: Rating.optional(), key: z.string().max(40).optional() });
  app.post('/customer/assistant/feedback', { bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin !== 'https://possistem.az') return reply.code(403).send({ error: 'Origin not allowed' });
    const body = parseBody(z.object({
      sessionKey: z.string().uuid(), messageKey: z.string().min(1).max(40), rating: Rating,
      replyId: z.string().max(80).default(''), question: z.string().max(2000).default(''), answer: z.string().max(16000).default(''),
      comment: z.string().trim().max(1000).default(''), language: z.enum(['az', 'en', 'ru']).default('az'),
      transcript: z.array(Line).max(300).default([]),
    }), req.body, reply);
    if (!body) return;
    const customerId = req.customer?.id ?? null;
    const [row] = await rows<{ id: string }>(app.db, sql`
      INSERT INTO support_assistant_feedback (session_key, message_key, customer_id, rating, reply_id, question, answer, comment, language)
      VALUES (${body.sessionKey}::uuid, ${body.messageKey}, ${customerId}::uuid, ${body.rating}, ${body.replyId}, ${body.question}, ${body.answer}, ${body.comment}, ${body.language})
      ON CONFLICT (session_key, message_key) DO UPDATE SET rating = excluded.rating, comment = CASE WHEN excluded.comment <> '' THEN excluded.comment ELSE support_assistant_feedback.comment END,
        customer_id = COALESCE(excluded.customer_id, support_assistant_feedback.customer_id), updated_at = now()
      RETURNING id`);
    if (body.rating !== 'bad') return { ok: true, id: row?.id };
    // One complaint per conversation: a new "bad" refreshes the transcript and puts it back to "new".
    const bad = await rows<{ question: string; reply_id: string; comment: string }>(app.db, sql`
      SELECT question, reply_id, comment FROM support_assistant_feedback WHERE session_key = ${body.sessionKey}::uuid AND rating = 'bad' ORDER BY updated_at`);
    const summary = bad.map((b) => `👎 «${b.question.slice(0, 160)}» → ${b.reply_id || '?'}${b.comment ? ` · Müştəri: ${b.comment.slice(0, 200)}` : ''}`).join('\n').slice(0, 2000);
    const raw = body.transcript.length ? body.transcript : [{ author: 'me' as const, body: body.question }, { author: 'helper' as const, body: body.answer, topic: body.replyId, rating: 'bad' as const }];
    // The admin page shows body and topic; make the rated answer impossible to miss there.
    const notes = new Map(bad.map((b) => [b.question, b.comment]));
    const transcript = raw.map((line, i) => line.author === 'helper' && line.rating === 'bad'
      ? { ...line, body: `👎 MÜŞTƏRİ BU CAVABI PİS QİYMƏTLƏNDİRDİ${(() => { const q = raw.slice(0, i).reverse().find((x) => x.author === 'me')?.body ?? ''; const c = notes.get(q); return c ? ` — «${c}»` : ''; })()}\n\n${line.body}`, topic: `pis cavab · ${line.topic || '?'}` }
      : line);
    const [report] = await rows<{ id: string }>(app.db, sql`
      INSERT INTO support_assistant_reports (request_key, customer_id, language, reason, comment, transcript)
      VALUES (${body.sessionKey}::uuid, ${customerId}::uuid, ${body.language}, 'Pis cavab (👎)', ${summary}, ${JSON.stringify(transcript)}::jsonb)
      ON CONFLICT (request_key) DO UPDATE SET transcript = excluded.transcript, comment = excluded.comment, reason = excluded.reason,
        customer_id = COALESCE(excluded.customer_id, support_assistant_reports.customer_id), status = 'new', updated_at = now()
      RETURNING id`);
    if (report) await app.db.execute(sql`UPDATE support_assistant_feedback SET report_id = ${report.id}::uuid WHERE session_key = ${body.sessionKey}::uuid`);
    return { ok: true, id: row?.id, reportId: report?.id };
  });

  // Ratings overview for the admin: totals and the topics customers mark as bad most often.
  app.get('/support/assistant-feedback/stats', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const days = Math.min(365, Math.max(1, Number((req.query as { days?: string }).days ?? 30) || 30));
    const totals = await rows(app.db, sql`SELECT rating, count(*)::int AS count FROM support_assistant_feedback WHERE created_at > now() - make_interval(days => ${days}) GROUP BY rating`);
    const topics = await rows(app.db, sql`SELECT reply_id AS "replyId", count(*)::int AS count, (array_agg(question ORDER BY updated_at DESC))[1:3] AS examples
      FROM support_assistant_feedback WHERE rating = 'bad' AND created_at > now() - make_interval(days => ${days}) GROUP BY reply_id ORDER BY count DESC LIMIT 20`);
    return { days, totals, badTopics: topics };
  });

  app.post('/customer/assistant/confirm', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
    const body = parseBody(z.object({ token: z.string().uuid(), password: z.string().min(1).max(200), language: z.enum(['az', 'en', 'ru']).default('az') }), req.body, reply);
    if (!body) return;
    const result = await confirmPending(app, req.customer.id, body.token, body.password, body.language);
    if (result.ok) await writeAudit(app, { actorCustomerId: req.customer.id, action: 'customer.assistant_stock_adjust', entityType: 'market_product', meta: { via: 'assistant' }, ip: clientIp(req) });
    return reply.code(result.ok ? 200 : 400).send(result.ok ? { text: result.text } : { error: result.text });
  });
}
