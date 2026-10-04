'use strict';
/**
 * วัดความแม่นยำของทั้งระบบตามค่าที่ใช้งานจริง (end-to-end)
 * อ่านคำสั่งระบบ เครื่องมือ และคำสำคัญจากไฟล์ workflow, จำลองการค้นฐานความรู้แบบเดียวกับระบบ,
 * ใช้เครื่องคำนวณตัวจริง แล้วตรวจคำตอบกับ test-questions-official.json (ผลรายข้อเก็บใน evaluation/results)
 *
 * วิธีรัน (Node.js 18 ขึ้นไป)
 *   node evaluation/run-accuracy-test.js                                ค่าเริ่มต้น --model=gemini
 *   node evaluation/run-accuracy-test.js --runs=3                       รันซ้ำดูความคงเส้นคงวา
 *   node evaluation/run-accuracy-test.js --model=typhoon                เลือกผู้ให้บริการ gemini|openai|typhoon
 *   node evaluation/run-accuracy-test.js --model=gemini --list-models   ดูรุ่นที่เรียกใช้ได้
 *   node evaluation/run-accuracy-test.js --name=<รุ่น> --rpm=15         ระบุรุ่นย่อยและคำขอต่อนาที
 *   ใส่ --fresh เพื่อทิ้งผลเดิมแล้วเริ่มใหม่ (ปกติจะวัดต่อจากจุดบันทึก)
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  calculateThaiPIT,
  calculateLatePenalty,
  ตรวจที่มาของค่าลดหย่อน,
  ตรวจความสอดคล้องของประเภทเงินได้,
  ปฏิเสธเพราะประเภทเงินได้ขัดแย้ง,
  ตรวจคีย์วางผิดชั้น,
  ปฏิเสธเพราะคีย์วางผิดชั้น,
  ตรวจค่าผิดชนิด,
  ปฏิเสธเพราะค่าผิดชนิด,
  ผนวกผลด่าน,
} = require('../n8n/tools/tax-calculator');

const ROOT = path.join(__dirname, '..');

// ---- อ่านค่าจากไฟล์ .env (ค่าใน process.env มาก่อน) ----
function loadEnv() {
  const p = path.join(ROOT, '.env');
  const env = { ...process.env };
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in env)) env[k] = v;
  }
  return env;
}
const ENV = loadEnv();

const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: ENV.GEMINI_MODEL || 'gemini-3-flash-preview',
    apiKey: ENV.GEMINI_API_KEY,
    // เว้นจังหวะตามโควตาฟรีต่อนาที (ข้อหนึ่งใช้ ≥2 คำขอ) ไม่งั้นเจอ 429 ตั้งแต่ข้อแรก ๆ
    rpmLimit: Number(ENV.GEMINI_RPM_LIMIT) || 5,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: ENV.OPENAI_API_KEY,
    rpmLimit: 60,
  },
  typhoon: {
    label: 'Typhoon (รันในเครื่อง)',
    baseUrl: (ENV.OLLAMA_BASE_URL || 'http://localhost:11434') + '/v1',
    model: ENV.TYPHOON_MODEL || 'scb10x/typhoon2.5-qwen3-4b',
    apiKey: 'ollama',
    rpmLimit: 0,
  },
};

// ---- อ่านการตั้งค่าจริงจากไฟล์ workflow ----
function loadProductionConfig() {
  const wf = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'n8n/workflows/tax-advisor-workflow.json'), 'utf8')
  );
  const byName = (n) => wf.nodes.find((x) => x.name === n);

  const agent = byName('AI Agent (Tax Advisor)');
  if (!agent) throw new Error('ไม่พบ node AI Agent ในไฟล์ workflow');

  // คำสั่งระบบขึ้นต้นด้วย = เพราะเป็นนิพจน์ของ n8n ต้องตัดออก
  let systemMessage = agent.parameters.options.systemMessage.replace(/^=/, '');

  const tools = wf.nodes
    .filter((n) => n.type.endsWith('toolCode'))
    .map((n) => ({
      name: n.parameters.name,
      description: n.parameters.description,
      schema: JSON.parse(n.parameters.inputSchema),
    }));

  const searchNode = byName('Search Tax Knowledge');
  // ดึงตารางคำสำคัญโดยยึดจุดจบที่ "; var tbl" — ถ้าแก้ลำดับตัวแปรใน KEYWORD_EXPRESSION ต้องแก้ regex นี้ด้วย
  const mapMatch = /var map = (\[[\s\S]*?\]); var tbl/.exec(
    searchNode.parameters.options.queryReplacement
  );
  if (!mapMatch) {
    throw new Error(
      'อ่านตารางคำสำคัญจากโหนด Search Tax Knowledge ไม่ได้\n' +
        'สาเหตุที่พบบ่อยคือมีการแก้ KEYWORD_EXPRESSION ใน n8n/build-workflow.py\n' +
        'แล้วนิพจน์ที่ใช้ดึงค่าตรงนี้ไม่ตรงกับรูปแบบใหม่'
    );
  }
  const keywordMap = JSON.parse(mapMatch[1]);

  // configHash = ลายนิ้วมือของทุกอย่างที่มีผลต่อคำตอบ: workflow ทั้งไฟล์ เครื่องคำนวณ คำสำคัญ กฎเจตนา และชื่อเรื่องในฐานความรู้
  // ถ้าอย่างใดเปลี่ยน จะไม่หยิบผลเดิมจากจุดบันทึกมาใช้ (กันรายงานผลเก่าว่าเป็นผลใหม่)
  const intentRules = loadIntentRules();
  const kbFingerprint = loadKnowledgeBase()
    .map((r) => r.title)
    .sort()
    .join('|');

  const workflowRaw = fs.readFileSync(
    path.join(ROOT, 'n8n/workflows/tax-advisor-workflow.json'),
    'utf8'
  );
  const calculatorRaw = fs.readFileSync(
    path.join(ROOT, 'n8n/tools/tax-calculator.js'),
    'utf8'
  );

  const hash = require('node:crypto')
    .createHash('sha256')
    .update(
      workflowRaw +
        calculatorRaw +
        JSON.stringify(keywordMap) +
        JSON.stringify(intentRules) +
        kbFingerprint
    )
    .digest('hex')
    .slice(0, 16);

  return { systemMessage, tools, keywordMap, intentRules, hash };
}

// ---- จำลองการสืบค้นฐานข้อมูลด้วยตรรกะเดียวกับระบบจริง ----
function loadKnowledgeBase() {
  // หาไฟล์ seed อัตโนมัติ (ไม่เขียนรายชื่อตายตัว) กันลืมไฟล์ใหม่แล้ววัดด้วยข้อมูลเก่า
  const dir = path.join(ROOT, 'postgres');
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^seed-tax-(law|forms).*\.sql$/.test(f))
    .sort()
    .map((f) => path.join('postgres', f));

  if (files.length === 0) {
    throw new Error('ไม่พบไฟล์ข้อมูลกฎหมายใน postgres/ เลย');
  }

  const recs = [];
  const re = /\(\s*'([^']+)',\s*'([^']+)',\s*'((?:[^']|'')*)',\s*'([^']*)',\s*(\d+)\s*\)/g;
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const sql = fs.readFileSync(p, 'utf8');
    let m;
    while ((m = re.exec(sql)) !== null) {
      recs.push({
        category: m[1],
        title: m[2],
        content: m[3].replace(/''/g, "'"),
        source: m[4],
      });
    }
  }

  // จำลองคำสั่งลบรายการที่ถูกแทนที่ (ท้าย seed-tax-law-full.sql) ให้ตรงกับฐานข้อมูลจริง
  const fullPath = path.join(ROOT, 'postgres/seed-tax-law-full.sql');
  if (fs.existsSync(fullPath)) {
    const sql = fs.readFileSync(fullPath, 'utf8');
    const block = /AND title IN \(([\s\S]*?)\);/.exec(sql);
    if (block) {
      const titles = new Set((block[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
      return recs.filter((r) => !(titles.has(r.title) && !r.source.includes('[ชุดที่ 3]')));
    }
  }
  return recs;
}

// ---- จำแนกเจตนาด้วยกฎชุดเดียวกับโหนด Build Context ----
// กฎอ่านจาก n8n/intent-rules.json ซึ่ง build-workflow.py สร้างและฝังลงเวิร์กโฟลว์ด้วย
function loadIntentRules() {
  const p = path.join(ROOT, 'n8n/intent-rules.json');
  if (!fs.existsSync(p)) {
    throw new Error('ไม่พบ n8n/intent-rules.json ให้รัน python n8n/build-workflow.py ก่อน');
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function classifyIntent(question, rules) {
  const q = (question || '').toLowerCase();
  const hasDigit = /[0-9\u0e50-\u0e59]/.test(q);
  // ตัวเลขที่เป็นอายุล้วน ๆ (เช่น "65 ปี") ไม่ทำให้เป็นหมวดคำนวณ — ต้องตรงกับ Build Context
  const digitsAreAgeOnly = !/[0-9๐-๙]/.test(
    q.replace(/[0-9๐-๙,]+\s*ปี/g, '')
  );
  const moneyWords = rules.incomeWords.concat(['บาท']);
  const looksLikeAgeQuestion =
    hasDigit && digitsAreAgeOnly && !moneyWords.some((w) => q.indexOf(w) >= 0);

  let category = 'อื่นๆ';
  for (const rule of rules.intentRules) {
    if (rule.requireDigit && (!hasDigit || looksLikeAgeQuestion)) continue;
    if (rule.keywords.some((k) => q.indexOf(k) >= 0)) {
      category = rule.category;
      break;
    }
  }
  if (category === 'อื่นๆ' && hasDigit && rules.incomeWords.some((k) => q.indexOf(k) >= 0)) {
    category = 'คำนวณภาษี';
  }
  if (category === 'อื่นๆ' && q.indexOf('ภาษี') >= 0) category = 'กฎหมายภาษี';
  return category;
}

// ---- รองรับคำสะกดผิด (ต้องตรงกับ KEYWORD_EXPRESSION ใน n8n/build-workflow.py) ----
// เทียบตรงตัวก่อน แล้วจึงเทียบแบบยุบพยัญชนะพ้องเสียง เฉพาะตัวดักยาวตั้งแต่ 4 ตัวอักษร
// ไม่ตัดวรรณยุกต์ เพราะทำให้ตัวดักสั้นจับกว้างเกินไป
const กลุ่มพยัญชนะพ้องเสียง = [
  ['ส', 'ศ', 'ษ', 'ซ'],
  ['พ', 'ภ', 'ผ'],
  ['ท', 'ธ', 'ฑ', 'ฒ', 'ถ', 'ฐ'],
  ['ค', 'ข', 'ฆ', 'ฃ', 'ฅ'],
  ['น', 'ณ'],
  ['ล', 'ฬ'],
  ['ด', 'ฎ'],
  ['ต', 'ฏ'],
  ['ย', 'ญ'],
  ['ช', 'ฌ', 'ฉ'],
  ['บ', 'ป'],
];
const ตารางพ้องเสียง = {};
for (const กลุ่ม of กลุ่มพยัญชนะพ้องเสียง) {
  for (const ตัว of กลุ่ม) ตารางพ้องเสียง[ตัว] = กลุ่ม[0];
}
const ความยาวต่ำสุดที่ปรับรูปได้ = 4;

/** ยุบพยัญชนะพ้องเสียงให้เหลือตัวแทนกลุ่ม โดยไม่แตะวรรณยุกต์ */
function ปรับรูปพ้องเสียง(s) {
  let out = '';
  const t = s || '';
  for (let i = 0; i < t.length; i++) out += ตารางพ้องเสียง[t[i]] || t[i];
  return out;
}

function retrieve(question, keywordMap, kb, limit = 3, isCalc = false) {
  const q = (question || '').toLowerCase();
  const qn = ปรับรูปพ้องเสียง(q);
  const found = [];
  for (const [trigger, term] of keywordMap) {
    let hit = q.indexOf(trigger) >= 0;
    if (!hit && trigger.length >= ความยาวต่ำสุดที่ปรับรูปได้) {
      hit = qn.indexOf(ปรับรูปพ้องเสียง(trigger)) >= 0;
    }
    if (hit && found.indexOf(term) < 0) found.push(term);
  }
  const keys = found.length ? found : ['ภาษี'];

  const scored = kb
    .map((r) => {
      const t = r.title.toLowerCase();
      const c = r.category.toLowerCase();
      const b = r.content.toLowerCase();
      // น้ำหนักเดียวกับคำสั่ง SQL ในระบบจริง: ชื่อเรื่อง x5, หมวด x3, เนื้อหา x1
      const score =
        keys.filter((k) => t.includes(k)).length * 5 +
        keys.filter((k) => c.includes(k)).length * 3 +
        keys.filter((k) => b.includes(k)).length;
      return { ...r, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // จำกัดขนาดบริบทเท่าโหนด Build Context — ค่าต้องตรงกับ CONTEXT_BUDGET ใน n8n/build-workflow.py
  const CONTEXT_BUDGET = isCalc ? 1200 : 3000;
  const render = (list) =>
    list
      .map((r, i) => `[${i + 1}] หมวด: ${r.category}\nหัวข้อ: ${r.title}\n${r.content}\nแหล่งที่มา: ${r.source}`)
      .join('\n\n---\n\n');

  // ไล่ตามอันดับ หยิบรายการที่ยังใส่ในงบได้ ข้ามรายการที่ใหญ่เกิน (ตรรกะเดียวกับ Build Context)
  let selected = [];
  for (const row of scored) {
    const trial = selected.concat([row]);
    if (render(trial).length <= CONTEXT_BUDGET) selected = trial;
  }
  if (selected.length === 0 && scored.length > 0) selected = [scored[0]];

  const context = selected.length
    ? render(selected)
    : 'ไม่พบข้อมูลที่ตรงกับคำถามนี้ในฐานข้อมูล ให้ตอบจากความรู้ทั่วไปด้านภาษี และแนะนำให้ผู้ใช้ตรวจสอบกับกรมสรรพากรอีกครั้ง';

  return { context, hits: selected.length, titles: selected.map((r) => r.title) };
}

// ---- เรียก API โดยเว้นจังหวะตาม rpmLimit และลองใหม่อัตโนมัติ ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
let apiTimeMs = 0;
let promptCharsMax = 0;

async function chat(provider, messages, tools) {
  const minGap = provider.rpmLimit > 0 ? Math.ceil(60000 / provider.rpmLimit) : 0;
  for (let attempt = 1; ; attempt++) {
    if (minGap) {
      const wait = minGap - (Date.now() - lastCall);
      if (wait > 0) await sleep(wait);
    }
    lastCall = Date.now();

    const body = { model: provider.model, messages, temperature: 0.3 };
    if (tools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const t0 = Date.now();
    let res, text;
    try {
      res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
      text = await res.text();
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(5000 * attempt);
      continue;
    }

    if (res.ok) {
      apiTimeMs += Date.now() - t0;
      return JSON.parse(text);
    }

    // โควตารายวันหมด (quotaId มีคำว่า PerDay) รอในสคริปต์ไม่มีประโยชน์ จึงหยุดเลย
    // ส่วนรายนาทีรอแล้วลองใหม่ด้านล่าง (ถ้าเจอบ่อยให้ลด GEMINI_RPM_LIMIT)
    const isDailyQuota = /PerDay|per day|daily/i.test(text);
    if (res.status === 429 && isDailyQuota) {
      throw new Error('โควตารายวันของแบบจำลองหมดแล้ว ต้องรอรีเซ็ตข้ามวัน');
    }

    const retryable = res.status === 429 || res.status === 503 || res.status === 500;
    if (retryable && attempt < 5) {
      const m = /"retryDelay"\s*:\s*"(\d+)s"/.exec(text);
      const wait = m ? Number(m[1]) * 1000 : Math.min(10000 * 2 ** (attempt - 1), 90000);
      process.stdout.write(`\r    ถูกจำกัดอัตราการเรียก (${res.status}) รอ ${Math.round(wait / 1000)} วินาที...`);
      await sleep(wait);
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
      continue;
    }

    let detail = text.slice(0, 150);
    try {
      const p = JSON.parse(text);
      detail = (Array.isArray(p) ? p[0] : p)?.error?.message || detail;
    } catch (_) {}
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 150)}`);
  }
}

const TOOL_IMPL = {
  calculate_thai_personal_income_tax: calculateThaiPIT,
  calculate_late_filing_penalty: calculateLatePenalty,
};

// ---- จำลองด่านตรวจข้อมูลนำเข้าเครื่องคำนวณ ให้ตรงกับโหนดเครื่องมือในระบบจริง ----
// ต้องตรงกับท่อนที่ load_calculator_code ใน n8n/build-workflow.py ต่อท้ายไว้ (tests/test-tax-calculator.js ตรวจให้)
function เรียกเครื่องมือ(ชื่อ, ข้อมูลนำเข้า, คำถาม, ตัวดักคำถามต่อเนื่อง) {
  const fn = TOOL_IMPL[ชื่อ];
  if (!fn) return { ข้อผิดพลาด: 'ไม่รู้จักเครื่องมือนี้' };
  if (ชื่อ !== 'calculate_thai_personal_income_tax') return fn(ข้อมูลนำเข้า);

  // 1) คีย์วางผิดชั้น ตรวจก่อนด่านอื่น เพราะถ้าโครงสร้างผิด ด่านที่เหลือจะอ่านค่าว่างแล้วสรุปผิด
  const คีย์ผิดชั้น = ตรวจคีย์วางผิดชั้น(ข้อมูลนำเข้า);
  if (คีย์ผิดชั้น.length > 0) return ปฏิเสธเพราะคีย์วางผิดชั้น(คีย์ผิดชั้น);

  // 2) ค่าผิดชนิด เช่น ส่งข้อความแทนจำนวนเงิน
  const ค่าผิดชนิด = ตรวจค่าผิดชนิด(ข้อมูลนำเข้า);
  if (ค่าผิดชนิด.length > 0) return ปฏิเสธเพราะค่าผิดชนิด(ค่าผิดชนิด);

  // 3) ประเภทเงินได้ขัดแย้งกัน ปฏิเสธไม่คำนวณ (ถ้าส่งตัวเลขพร้อมคำเตือน แบบจำลองจะหยิบตัวเลขไปตอบเลย)
  const คำเตือน = ตรวจความสอดคล้องของประเภทเงินได้(ข้อมูลนำเข้า);
  if (คำเตือน.length > 0) return ปฏิเสธเพราะประเภทเงินได้ขัดแย้ง(คำเตือน);

  // 4) ตรวจที่มาของค่าลดหย่อนกับคำถาม (ข้ามถ้าเป็นคำถามต่อเนื่อง)
  const q =String(คำถาม || '').toLowerCase();
  const เป็นคำถามต่อเนื่อง = (ตัวดักคำถามต่อเนื่อง || []).some((คำ) => q.indexOf(คำ) >= 0);
  if (เป็นคำถามต่อเนื่อง) return fn(ข้อมูลนำเข้า);

  const ผลตรวจ = ตรวจที่มาของค่าลดหย่อน(ข้อมูลนำเข้า, คำถาม);
  return ผนวกผลด่าน(fn(ผลตรวจ['ข้อมูล']), ผลตรวจ['ตัดออก']);
}

/** ถามระบบหนึ่งคำถาม โดยจำลองเส้นทางเดียวกับที่รันจริง */
async function askSystem(provider, cfg, kb, question) {
  apiTimeMs = 0;
  const category = classifyIntent(question, cfg.intentRules);
  const needsCalc = cfg.intentRules.calcCategories.indexOf(category) >= 0;
  // คำถามคำนวณใช้บริบท 2 รายการและงบเล็กกว่า เหมือนระบบจริง
  const { context, hits, titles } = retrieve(question, cfg.keywordMap, kb, needsCalc ? 2 : 3, needsCalc);

  // แทนที่นิพจน์ของ n8n ในคำสั่งระบบด้วยค่าจริง
  const systemMessage = cfg.systemMessage
    .replace(/\{\{\s*\$json\.retrievedContext\s*\}\}/g, context)
    .replace(/\{\{[^}]*display_name[^}]*\}\}/g, 'ผู้ทดสอบระบบ')
    .replace(/\{\{[^}]*questionCategory[^}]*\}\}/g, category);

  // ต่อ calcDirective ท้ายคำถามเมื่อเป็นหมวดคำนวณ แบบเดียวกับ Build Context
  const userContent = needsCalc ? question + cfg.intentRules.calcDirective : question;

  const messages = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userContent },
  ];
  const toolDefs = cfg.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.schema },
  }));

  // เก็บขนาดข้อมูลนำเข้าสูงสุด ไว้เตือนกรณีเกินหน้าต่างบริบท (Ollama ตัดส่วนหน้าทิ้งเงียบ ๆ)
  const promptChars = systemMessage.length + question.length + JSON.stringify(toolDefs).length;
  promptCharsMax = Math.max(promptCharsMax, promptChars);

  let toolsCalled = [];
  let toolArgs = [];
  let resp = await chat(provider, messages, toolDefs);
  let choice = resp.choices?.[0];

  // เรียกเครื่องมือได้หลายรอบแบบ AI Agent ของ n8n แต่จำกัดรอบไว้ไม่ให้วนนาน
  const MAX_ROUNDS = 6;
  let rounds = 0;
  let stillWantsTool = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const calls = choice?.message?.tool_calls;
    if (!calls || calls.length === 0) break;
    rounds++;
    if (round === MAX_ROUNDS - 1) stillWantsTool = true;
    messages.push(choice.message);
    for (const call of calls) {
      toolsCalled.push(call.function.name);
      // เก็บอาร์กิวเมนต์ที่ส่งให้เครื่องมือ ไว้ดูว่าแบบจำลองอ่านโจทย์พลาดตรงไหน
      toolArgs.push(call.function.arguments || '{}');
      let out;
      try {
        out = เรียกเครื่องมือ(
          call.function.name,
          JSON.parse(call.function.arguments || '{}'),
          question,
          cfg.intentRules.followupMarkers
        );
      } catch (e) {
        out = { สำเร็จ: false, ข้อผิดพลาด: String(e.message) };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out) });
    }
    resp = await chat(provider, messages, toolDefs);
    choice = resp.choices?.[0];
  }

  const msg = choice?.message || {};
  const answer = String(msg.content || '').trim();

  // ไม่มีคำตอบ: แยกสาเหตุ วนเรียกเครื่องมือไม่จบ / มีแต่ความคิดภายใน / ข้อความว่าง (แก้คนละทาง)
  let emptyReason = '';
  if (!answer) {
    const thinking = String(msg.reasoning_content || msg.reasoning || msg.thinking || '').trim();
    if (stillWantsTool) emptyReason = `วนเรียกเครื่องมือครบ ${MAX_ROUNDS} รอบโดยไม่สรุปคำตอบ`;
    else if (thinking) emptyReason = 'มีแต่ความคิดภายใน ไม่ได้ส่งข้อความให้ผู้ใช้';
    else emptyReason = 'แบบจำลองส่งข้อความว่างกลับมา';
  }

  return {
    answer,
    emptyReason,
    rounds,
    toolsCalled,
    toolArgs,
    knowledgeHits: hits,
    knowledgeTitles: titles,
    responseTimeMs: apiTimeMs,
  };
}

// ---- การตรวจคำตอบ ----
function numbersIn(text) {
  return (String(text).match(/[\d,]+(?:\.\d+)?/g) || [])
    .map((s) => Number(s.replace(/,/g, '')))
    .filter(Number.isFinite);
}

function grade(q, r) {
  const a = r.answer || '';
  if (!a) return { pass: false, reason: r.emptyReason || 'ไม่มีคำตอบ' };

  // คำตอบที่เป็นข้อมูลดิบถือว่าไม่ผ่านทันที
  if (/^[\s`]*[{[]/.test(a)) return { pass: false, reason: 'ตอบเป็นข้อมูลดิบ ไม่ใช่ภาษาที่ผู้ใช้อ่านได้' };

  if (q.check === 'exactNumber') {
    if (q.requiresTool && r.toolsCalled.length === 0) {
      return { pass: false, reason: 'ไม่ได้เรียกเครื่องมือคำนวณ ตัวเลขจึงเชื่อถือไม่ได้' };
    }
    // ภาษีที่ถูกคือ 0 บาท: ยอมรับประโยคอย่าง "ไม่ต้องเสียภาษี" ด้วย ไม่บังคับให้เขียนเลข 0
    if (q.expected === 0) {
      const saysNoTax =
        /ไม่ต้อง(เสีย|ชำระ)ภาษี|ไม่มีภาษีที่ต้อง(เสีย|ชำระ)|ได้รับยกเว้นภาษี|ภาษี\s*(ที่ต้องชำระ)?\s*(คือ|เท่ากับ|เป็น)?\s*0\s*บาท/.test(a);
      const hasZero = numbersIn(a).some((n) => n === 0);
      if (saysNoTax || hasZero) {
        return { pass: true, reason: 'ตอบถูกว่าไม่ต้องเสียภาษี' };
      }
      return { pass: false, reason: 'ไม่ได้ระบุชัดว่าไม่ต้องเสียภาษี' };
    }

    const found = numbersIn(a).some((n) => Math.abs(n - q.expected) < 1);
    return {
      pass: found,
      reason: found ? `พบ ${q.expected.toLocaleString('en-US')}` : `ไม่พบ ${q.expected.toLocaleString('en-US')}`,
    };
  }

  if (q.check === 'keywords') {
    // สมาชิกที่เป็นอาร์เรย์ = หลายสำนวนที่ถูกเท่ากัน พบตัวใดตัวหนึ่งก็ผ่าน (วัดความถูก ไม่ใช่วัดสำนวน)
    const hit = (k) => (Array.isArray(k) ? k.some((alt) => a.includes(alt)) : a.includes(k));
    const label = (k) => (Array.isArray(k) ? k.join(' หรือ ') : k);
    const missing = q.expected.filter((k) => !hit(k));
    return {
      pass: missing.length === 0,
      reason: missing.length ? `ขาด: ${missing.map(label).join(', ')}` : 'ครบ',
    };
  }

  if (q.check === 'scope') {
    const ok = q.expected.some((k) => a.includes(k));
    return { pass: ok, reason: ok ? 'แจ้งขอบเขตถูกต้อง' : 'ไม่ได้แจ้งขอบเขต' };
  }

  return { pass: false, reason: 'ไม่รู้จักเกณฑ์ตรวจ' };
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

// ---- ส่วนหลัก ----
async function main() {
  const args = { runs: 1, model: 'gemini', fresh: false, name: '', rpm: 0, listModels: false };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--runs=')) args.runs = Math.max(1, parseInt(a.slice(7), 10) || 1);
    if (a.startsWith('--model=')) args.model = a.slice(8).trim();
    // --name= สลับรุ่นย่อยโดยไม่ต้องแก้ .env (โควตาฟรีแต่ละรุ่นต่างกันมาก จึงต้องสลับบ่อย)
    if (a.startsWith('--name=')) args.name = a.slice(7).trim();
    if (a.startsWith('--rpm=')) args.rpm = Math.max(0, parseInt(a.slice(6), 10) || 0);
    if (a === '--fresh') args.fresh = true;
    if (a === '--list-models') args.listModels = true;
  }

  const provider = PROVIDERS[args.model];
  if (!provider) {
    console.error(`ไม่รู้จักผู้ให้บริการ "${args.model}" เลือกได้: ${Object.keys(PROVIDERS).join(', ')}`);
    process.exit(1);
  }
  if (args.name) provider.model = args.name;
  if (args.rpm) provider.rpmLimit = args.rpm;
  if (!provider.apiKey) {
    console.error(`ไม่พบกุญแจ API ของ ${provider.label} ในไฟล์ .env`);
    process.exit(1);
  }

  // --list-models: ถามรายชื่อรุ่นที่บัญชีนี้ใช้ได้จริงจาก Gemini API แทนการเดา (รุ่นเก่าอาจถูกปิดแล้ว ได้ 404)
  if (args.listModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${provider.apiKey}`;
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`เรียกดูรายชื่อรุ่นไม่สำเร็จ HTTP ${r.status}`);
      process.exit(1);
    }
    const data = await r.json();
    const usable = (data.models || []).filter((m) =>
      (m.supportedGenerationMethods || []).includes('generateContent')
    );
    console.log(`\nรุ่นที่บัญชีนี้เรียกใช้ได้ ${usable.length} รุ่น\n`);
    for (const m of usable) {
      console.log(`  ${m.name.replace('models/', '').padEnd(42)} ${m.displayName || ''}`);
    }
    console.log('\nนำชื่อรุ่นไปใส่ต่อท้าย --name= เพื่อวัดด้วยรุ่นนั้น');
    console.log('เลือกรุ่นที่ไม่ใช่ preview ก่อน เพราะโควตารายวันมักใช้ได้จริงมากกว่า\n');
    return;
  }

  const cfg = loadProductionConfig();
  const kb = loadKnowledgeBase();
  const dataset = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'test-questions-official.json'), 'utf8')
  );
  const questions = dataset.questions;

  console.log('='.repeat(78));
  console.log('  การวัดความแม่นยำของระบบที่ปรึกษาด้านภาษี (ตามการตั้งค่าที่ใช้งานจริง)');
  console.log('='.repeat(78));
  console.log(`แบบจำลองภาษา    : ${provider.label} (${provider.model})`);
  console.log(`ฐานข้อมูล        : ${kb.length} รายการ`);
  console.log(`เครื่องมือที่ให้ AI : ${cfg.tools.map((t) => t.name).join(', ')}`);
  console.log(`คำสั่งระบบ        : อ่านจากไฟล์ workflow ${cfg.systemMessage.length.toLocaleString('en-US')} ตัวอักษร`);
  console.log(`ชุดคำถาม          : ${questions.length} ข้อ x ${args.runs} รอบ\n`);

  // ---- จุดบันทึก (checkpoint) ----
  // บันทึกผลรายข้อทันทีที่วัดเสร็จ ถ้าโควตาหมดกลางทาง รันใหม่จะข้ามข้อที่วัดแล้ว แบ่งวัดหลายวันได้
  const RESULT_DIR = path.join(__dirname, 'results');
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  // แยกไฟล์จุดบันทึกตามผู้ให้บริการและรุ่นย่อย กันผลต่างรุ่นปนกัน
  const ckptFile = path.join(
    RESULT_DIR,
    `.checkpoint-${args.model}-${provider.model.replace(/[\\/:*?"<>|]/g, '-')}.json`
  );

  // สร้างคำสั่งสำหรับวัดต่อโดยไม่มี --fresh (ถ้ารันซ้ำพร้อม --fresh ผลที่วัดไว้จะถูกทิ้งหมด)
  function วิธีวัดต่อ(a) {
    const คำสั่ง =
      `node evaluation/run-accuracy-test.js --model=${a.model}` +
      (a.runs > 1 ? ` --runs=${a.runs}` : '') +
      (a.name ? ` --name=${a.name}` : '');
    return (
      (a.fresh
        ? 'ครั้งต่อไปห้ามใส่ --fresh มิฉะนั้นผลที่วัดไว้แล้วจะถูกลบทิ้งแล้วเริ่มนับหนึ่งใหม่\n  ' +
          'ให้รันคำสั่งนี้แทน เพื่อวัดต่อจากข้อที่ค้างไว้\n    '
        : 'รันคำสั่งนี้อีกครั้งเมื่อโควตากลับมา ระบบจะวัดต่อจากข้อที่ค้างไว้เอง\n    ') + คำสั่ง
    );
  }

  let checkpoint = {};
  if (!args.fresh && fs.existsSync(ckptFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(ckptFile, 'utf8'));
      // ใช้ผลเดิมเฉพาะเมื่อ configHash และรุ่นตรงกัน กันผลคนละเวอร์ชันปนกัน
      if (saved.configHash === cfg.hash && saved.model === provider.model) {
        checkpoint = saved.records || {};
        const n = Object.keys(checkpoint).length;
        if (n) console.log(`พบผลที่วัดไว้แล้ว ${n} รายการ จะวัดต่อจากของเดิม (ใช้ --fresh เพื่อเริ่มใหม่)\n`);
      } else {
        console.log('การตั้งค่าเปลี่ยนไปจากครั้งก่อน จึงเริ่มวัดใหม่ทั้งหมด\n');
      }
    } catch (_) {}
  }

  const saveCheckpoint = () => {
    fs.writeFileSync(
      ckptFile,
      JSON.stringify({ configHash: cfg.hash, model: provider.model, records: checkpoint }, null, 2),
      'utf8'
    );
  };

  let quotaFails = 0;
  let stoppedEarly = false;

  const rows = [];
  for (const q of questions) {
    for (let run = 1; run <= args.runs; run++) {
      const key = `${q.id}#${run}`;
      if (checkpoint[key]) {
        rows.push(checkpoint[key]);
        console.log(`  ${q.id} ${checkpoint[key].ผล.padEnd(7)} ${String(checkpoint[key].เวลา_ms).padStart(6)} ms  ${q.category.padEnd(14)} (ผลเดิม)`);
        continue;
      }
      if (stoppedEarly) break;
      const rec = {
        รหัส: q.id, หมวด: q.category, ความยาก: q.difficulty, รอบที่: run,
        คำถาม: q.question, ผล: '', เหตุผล: '',
        เรียกเครื่องมือ: '', ข้อมูลที่ส่งให้เครื่องมือ: '', รอบที่เรียกเครื่องมือ: '', ความรู้ที่ค้นเจอ: '', เวลา_ms: '', คำตอบ: '',
        ฐานกฎหมาย: q.ฐานกฎหมาย || '', แหล่งอ้างอิง: (q.แหล่งอ้างอิง || []).join(' '),
      };
      try {
        const r = await askSystem(provider, cfg, kb, q.question);

        // ข้อความว่างล้วน (ไม่มีความคิดภายใน ไม่ได้วนเรียกเครื่องมือ) = บริการขัดข้องแบบเดียวกับ 503 ไม่ใช่ตอบผิด
        // โยนเป็นข้อผิดพลาด จึงไม่นับในความแม่นยำและไม่ลงจุดบันทึก ข้อนั้นจะถูกวัดใหม่รอบหน้า
        // (วนเรียกเครื่องมือไม่จบ หรือมีแต่ความคิดภายใน ยังนับเป็นไม่ผ่าน)
        if (r.emptyReason === 'แบบจำลองส่งข้อความว่างกลับมา') {
          throw new Error(
            'ผู้ให้บริการส่งข้อความว่างกลับมาโดยไม่มีคำตอบและไม่มีความคิดภายใน ' +
              'ถือเป็นความขัดข้องของบริการ ไม่ใช่คำตอบผิด จึงไม่นับรวมในความแม่นยำ'
          );
        }

        const g = grade(q, r);
        rec.ผล = g.pass ? 'ผ่าน' : 'ไม่ผ่าน';
        rec.เหตุผล = g.reason;
        rec.เรียกเครื่องมือ = r.toolsCalled.join(',') || '-';
        rec.ข้อมูลที่ส่งให้เครื่องมือ = (r.toolArgs || []).join(' ; ');
        rec.รอบที่เรียกเครื่องมือ = r.rounds;
        rec.ความรู้ที่ค้นเจอ = r.knowledgeTitles.join(' | ');
        rec.เวลา_ms = r.responseTimeMs;
        rec.คำตอบ = r.answer.replace(/\s+/g, ' ').slice(0, 600);
        console.log(`  ${q.id} ${g.pass ? 'ผ่าน   ' : 'ไม่ผ่าน'} ${String(r.responseTimeMs).padStart(6)} ms  ${q.category.padEnd(14)} ${g.reason}`);
        quotaFails = 0;
        checkpoint[key] = rec;
        saveCheckpoint();
      } catch (e) {
        const msg = String(e.message);
        rec.ผล = 'ผิดพลาด';
        rec.เหตุผล = msg.slice(0, 150);
        // ข้อผิดพลาด (รวมโควตาหมด) ไม่ใช่ตอบผิด: ไม่ลง checkpoint และไม่นับในความแม่นยำ
        const isQuota = /HTTP 429|quota|โควตา|rate limit/i.test(msg);
        const isDaily = /รายวัน/.test(msg);
        if (isQuota) {
          quotaFails++;
          console.log(`  ${q.id} ยังไม่ได้วัด  ${isDaily ? 'โควตารายวันหมด' : 'โควตาแบบจำลองหมด'}`);
          // โควตารายวันหมดให้หยุดทันที ส่วนรายนาทีหยุดเมื่อพลาดติดกัน 3 ครั้ง
          if (isDaily) {
            stoppedEarly = true;
            console.log('\n  หยุดการวัด เพราะโควตารายวันของแบบจำลองหมดแล้ว');
            console.log('  โควตารีเซ็ตเที่ยงคืนเวลาแปซิฟิก (ประมาณ 14:00 น. เวลาไทย)');
            console.log('  ' + วิธีวัดต่อ(args));
          } else if (quotaFails >= 3) {
            stoppedEarly = true;
            console.log('\n  หยุดการวัดชั่วคราว เพราะโควตาของแบบจำลองหมดแล้ว');
            console.log('  ผลที่วัดได้แล้วถูกบันทึกไว้');
            console.log('  ' + วิธีวัดต่อ(args));
          }
        } else {
          console.log(`  ${q.id} ผิดพลาด  ${rec.เหตุผล}`);
        }
      }
      rows.push(rec);
    }
    if (stoppedEarly) break;
  }

  // ---- สรุปผล (ไม่นับข้อที่ผิดพลาด) ----
  const done = rows.filter((r) => r.ผล !== 'ผิดพลาด');
  const pass = done.filter((r) => r.ผล === 'ผ่าน');
  const times = done.filter((r) => typeof r.เวลา_ms === 'number').map((r) => r.เวลา_ms);
  const overall = done.length ? (pass.length / done.length) * 100 : 0;

  console.log('\n' + '='.repeat(78));
  console.log('  สรุปผล');
  console.log('='.repeat(78));
  const totalPlanned = questions.length * args.runs;
  const notMeasured = totalPlanned - done.length;
  console.log(`\nความแม่นยำโดยรวม : ${overall.toFixed(1)}%  (${pass.length}/${done.length} ข้อ)`);
  if (notMeasured > 0) {
    console.log(`ยังไม่ได้วัด      : ${notMeasured} ข้อ จากทั้งหมด ${totalPlanned} ข้อ`);
    console.log('                    ตัวเลขข้างต้นคิดจากเฉพาะข้อที่วัดได้ ยังสรุปผลไม่ได้');
  }
  console.log(`เวลาตอบสนองเฉลี่ย : ${mean(times).toFixed(0)} ms  (SD ${sd(times).toFixed(0)})`);

  const group = (key) => {
    const g = {};
    for (const r of done) {
      g[r[key]] = g[r[key]] || { total: 0, pass: 0 };
      g[r[key]].total++;
      if (r.ผล === 'ผ่าน') g[r[key]].pass++;
    }
    return g;
  };

  console.log('\nแยกตามหมวดคำถาม');
  for (const [k, v] of Object.entries(group('หมวด'))) {
    const p = ((v.pass / v.total) * 100).toFixed(1);
    console.log(`  ${k.padEnd(16)} ${String(p).padStart(6)}%  (${v.pass}/${v.total})`);
  }

  console.log('\nแยกตามระดับความยาก');
  for (const k of ['ง่าย', 'ปานกลาง', 'ยาก']) {
    const v = group('ความยาก')[k];
    if (!v) continue;
    const p = ((v.pass / v.total) * 100).toFixed(1);
    console.log(`  ${k.padEnd(16)} ${String(p).padStart(6)}%  (${v.pass}/${v.total})`);
  }

  // ตัวชี้วัดที่สำคัญที่สุดต่อความปลอดภัยในการใช้งานจริง
  const needTool = done.filter((r) => {
    const q = questions.find((x) => x.id === r.รหัส);
    return q && q.requiresTool;
  });
  const usedTool = needTool.filter((r) => r.เรียกเครื่องมือ !== '-');
  console.log('\nตัวชี้วัดด้านความปลอดภัย');
  console.log(`  เรียกเครื่องมือคำนวณเมื่อจำเป็น : ${needTool.length ? ((usedTool.length / needTool.length) * 100).toFixed(1) : '-'}%  (${usedTool.length}/${needTool.length})`);
  const calcQ = done.filter((r) => r.หมวด === 'คำนวณภาษี' || r.หมวด === 'บทลงโทษ');
  const calcPass = calcQ.filter((r) => r.ผล === 'ผ่าน');
  console.log(`  ความถูกต้องของคำถามที่มีตัวเลข : ${calcQ.length ? ((calcPass.length / calcQ.length) * 100).toFixed(1) : '-'}%  (${calcPass.length}/${calcQ.length})`);

  // ---- ตัวชี้วัดความไวในการตอบ ----
  // เพดานจริงคืออายุ reply token ของ LINE (ราว 60 วินาที) เกินนั้นผู้ใช้ไม่ได้รับคำตอบเลย
  const LINE_TOKEN_LIMIT_MS = 60000;
  const GOOD_UX_MS = 20000;
  const overLimit = times.filter((t) => t > LINE_TOKEN_LIMIT_MS).length;
  const overUx = times.filter((t) => t > GOOD_UX_MS).length;
  console.log('\nตัวชี้วัดด้านความไวในการตอบ');
  if (times.length) {
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    console.log(`  เวลาตอบช้าที่สุด (P95)          : ${(p95 / 1000).toFixed(1)} วินาที`);
    console.log(`  เกิน 60 วินาที (reply token หมดอายุ) : ${overLimit} ข้อ จาก ${times.length}`);
    console.log(`  เกิน 20 วินาที (ผู้ใช้เริ่มรู้สึกช้า)  : ${overUx} ข้อ จาก ${times.length}`);
    if (overLimit > 0) {
      console.log('  แปลว่าในการใช้งานจริง ผู้ใช้จะไม่ได้รับคำตอบเลยในข้อเหล่านั้น');
      console.log('  แม้คำตอบจะถูกต้อง เพราะ LINE ปฏิเสธ reply token ที่หมดอายุแล้ว');
    }
  }

  // ---- ตัวชี้วัดความครบถ้วนของฐานข้อมูล ----
  // ข้อที่ค้นไม่เจอ แบบจำลองต้องตอบจากความรู้ทั่วไป ซึ่งตรวจสอบย้อนกลับไปยังตัวบทไม่ได้
  const noHit = done.filter((r) => !r.ความรู้ที่ค้นเจอ);
  const hitRate = done.length ? ((done.length - noHit.length) / done.length) * 100 : 0;
  console.log('\nตัวชี้วัดด้านความครบถ้วนของฐานข้อมูล');
  console.log(`  ค้นเจอข้อมูลอ้างอิง            : ${hitRate.toFixed(1)}%  (${done.length - noHit.length}/${done.length})`);
  if (noHit.length) {
    console.log(`  คำถามที่ค้นไม่เจอเลย ${noHit.length} ข้อ (ตอบจากความรู้ทั่วไป ตรวจสอบย้อนกลับไม่ได้)`);
    for (const r of noHit) console.log(`    ${r.รหัส} [${r.หมวด}] ${String(r.คำถาม).slice(0, 50)}`);
    console.log('  วิธีอุด: เพิ่มข้อมูลใน postgres/seed-tax-law-extra.sql');
    console.log('           หรือเพิ่มคำสำคัญใน DOMAIN_KEYWORDS ของ n8n/build-workflow.py');
  }

  // ประมาณโทเคนแบบหยาบ: ภาษาไทยราว 1 โทเคนต่อ 1.5 ตัวอักษร
  const estTokens = Math.round(promptCharsMax / 1.5);
  console.log(`\nขนาดข้อมูลนำเข้าสูงสุด : ${promptCharsMax.toLocaleString('en-US')} ตัวอักษร (~${estTokens.toLocaleString('en-US')} โทเคน)`);

  // typhoon: ถามค่า num_ctx จริงจาก Ollama และแยกสถานะ "อ่านค่าได้" กับ "ติดต่อไม่ได้"
  // ไม่เงียบแล้วใช้ค่าเดา เพราะรายงานจะชี้ไปที่หน้าต่างบริบทผิด ๆ ทั้งที่ปัญหาคือ Ollama ไม่ทำงาน
  let ollamaCtx = null;
  let เหตุที่อ่านค่าไม่ได้ = null;
  if (args.model === 'typhoon') {
    const base = (ENV.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/v1\/?$/, '');
    try {
      const res = await fetch(`${base}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: provider.model }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const info = await res.json();
        const m = /num_ctx\s+(\d+)/.exec(info.parameters || '');
        ollamaCtx = m ? Number(m[1]) : 4096; // ไม่ได้ตั้งไว้ = ใช้ค่าเริ่มต้น
      } else if (res.status === 404) {
        เหตุที่อ่านค่าไม่ได้ =
          `Ollama ตอบว่าไม่มีแบบจำลองชื่อ "${provider.model}" (HTTP 404)\n` +
          `  ตรวจด้วย  ollama list  แล้วสร้างใหม่ตาม n8n/ollama/README.md\n` +
          '  หรือแก้ค่า TYPHOON_MODEL ในไฟล์ .env ให้ตรงกับชื่อที่มีอยู่';
      } else {
        เหตุที่อ่านค่าไม่ได้ = `Ollama ตอบกลับด้วย HTTP ${res.status}`;
      }
    } catch (e) {
      เหตุที่อ่านค่าไม่ได้ =
        `ติดต่อ Ollama ที่ ${base} ไม่ได้ (${e.name === 'TimeoutError' ? 'หมดเวลารอ' : e.message})\n` +
        '  ตรวจว่า Ollama ทำงานอยู่  docker compose ps  หรือ  ollama list';
    }
    if (ollamaCtx !== null) {
      console.log(`หน้าต่างบริบทของแบบจำลอง : ${ollamaCtx.toLocaleString('en-US')} โทเคน (อ่านจาก Ollama โดยตรง)`);
    }
  }

  // ติดต่อ Ollama ไม่ได้และวัดไม่สำเร็จสักข้อ: บอกสาเหตุจริง ห้ามเตือนเรื่องหน้าต่างบริบทจากค่าเดา
  if (เหตุที่อ่านค่าไม่ได้ && done.length === 0) {
    console.log('\n  สาเหตุที่วัดไม่ได้เลยแม้แต่ข้อเดียว');
    console.log('  ' + เหตุที่อ่านค่าไม่ได้);
    console.log('  หมายเหตุ ตัวเลขหน้าต่างบริบทด้านล่างจะไม่แสดง เพราะยังอ่านค่าจริงไม่ได้');
  } else {
    const ctxLimit = ollamaCtx !== null ? ollamaCtx : 4096;
    if (args.model === 'typhoon' && estTokens > ctxLimit * 0.85) {
      const ที่มาของค่า = ollamaCtx !== null ? 'ค่าจริงจาก Ollama' : 'ค่าเดา เพราะอ่านค่าจริงไม่ได้';
      console.log(
        `  คำเตือน: ข้อมูลนำเข้าใกล้เต็มหน้าต่างบริบท (${ctxLimit.toLocaleString('en-US')} โทเคน, ${ที่มาของค่า})`
      );
      console.log('  Ollama จะตัดข้อมูลส่วนหน้าทิ้งเงียบ ๆ ซึ่งคือคำสั่งระบบและกฎหมายที่ค้นมา');
      console.log('  ผลที่วัดได้ในสภาพนี้ไม่ได้สะท้อนความสามารถจริงของแบบจำลอง');
      console.log('  วิธีแก้: สร้างแบบจำลองที่ตั้งหน้าต่างบริบทใหม่ ดู n8n/ollama/README.md');
      if (เหตุที่อ่านค่าไม่ได้) console.log('  ' + เหตุที่อ่านค่าไม่ได้);
    }
  }

  const failed = done.filter((r) => r.ผล !== 'ผ่าน');

  // จัดกลุ่มสาเหตุที่ไม่ผ่าน เรียงจากพบบ่อย เพื่อดูว่าควรแก้อะไรก่อน
  if (failed.length) {
    const bucket = (reason) => {
      if (/วนเรียกเครื่องมือ/.test(reason)) return 'วนเรียกเครื่องมือไม่ยอมสรุปคำตอบ';
      if (/ความคิดภายใน|ข้อความว่าง|ไม่มีคำตอบ/.test(reason)) return 'ไม่ส่งข้อความตอบกลับ';
      if (/ข้อมูลดิบ/.test(reason)) return 'ตอบเป็นข้อมูลดิบ';
      if (/ไม่ได้เรียกเครื่องมือ/.test(reason)) return 'ไม่เรียกเครื่องมือคำนวณ';
      if (/^ไม่พบ/.test(reason)) return 'ตัวเลขไม่ตรง';
      if (/^ขาด/.test(reason)) return 'เนื้อหาไม่ครบตามที่กฎหมายกำหนด';
      return 'อื่นๆ';
    };
    const tally = {};
    for (const r of failed) tally[bucket(r.เหตุผล)] = (tally[bucket(r.เหตุผล)] || 0) + 1;
    console.log('\nสาเหตุที่ไม่ผ่าน (เรียงจากพบบ่อยที่สุด)');
    for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(3)} ข้อ  ${k}`);
    }
  }

  console.log('\nรายการที่ไม่ผ่าน');
  if (failed.length === 0) console.log('  ไม่มี');
  for (const r of failed) console.log(`  ${r.รหัส} [${r.หมวด}] ${r.เหตุผล}`);

  // ---- บันทึกผลรายข้อเป็น CSV ----
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  // ชื่อรุ่นบางตัวมี / (เช่น scb10x/typhoon2.5-qwen3-4b) ใช้เป็นชื่อไฟล์ไม่ได้
  const safeModel = provider.model.replace(/[\\/:*?"<>|]/g, '-');
  const file = path.join(outDir, `accuracy-${safeModel}-${stamp}.csv`);
  fs.writeFileSync(file, '﻿' + csv, 'utf8');

  console.log(`\nบันทึกผลรายข้อไว้ที่: ${file}`);

  // ---- การตีความผลเพื่อตัดสินใจนำไปใช้จริง ----
  console.log('\n' + '='.repeat(78));
  console.log('  การตีความผล');
  console.log('='.repeat(78));
  const toolRate = needTool.length ? (usedTool.length / needTool.length) * 100 : 0;
  if (notMeasured > 0) {
    console.log(`  ยังสรุปไม่ได้ เพราะวัดได้เพียง ${done.length} จาก ${totalPlanned} ข้อ`);
    console.log('  ' + วิธีวัดต่อ(args));
    console.log('  หรือใช้ --model=typhoon ซึ่งรันในเครื่อง ไม่มีโควตาจำกัด\n');
  }
  // พร้อมใช้จริงต้องผ่านครบสามด้าน: ความถูกต้อง ความไว ความครบถ้วนของฐานข้อมูล
  const pass3 = {
    'ความถูกต้อง (≥80%)': overall >= 80,
    'ตอบทันก่อน reply token หมดอายุ': overLimit === 0,
    'ฐานข้อมูลครอบคลุม (≥90%)': hitRate >= 90,
  };
  console.log('  สรุปสามด้านที่ใช้ตัดสิน');
  for (const [k, v] of Object.entries(pass3)) {
    console.log(`    ${v ? 'ผ่าน    ' : 'ยังไม่ผ่าน'} ${k}`);
  }
  console.log('');

  if (overall >= 90 && toolRate >= 98) {
    console.log('  ผลอยู่ในระดับที่นำไปทดลองใช้กับผู้ใช้จริงได้ โดยยังต้องแสดงคำเตือนทุกครั้ง');
  } else if (overall >= 80) {
    console.log('  ผลอยู่ในระดับใช้สาธิตได้ แต่ยังไม่ควรเปิดให้ประชาชนทั่วไปใช้');
    console.log('  ให้ดูรายการที่ไม่ผ่านด้านบนว่าพลาดเพราะเหตุใด แล้วแก้ที่ต้นเหตุ');
  } else {
    console.log('  ผลยังไม่พร้อมนำไปใช้ ควรตรวจสอบรายการที่ไม่ผ่านและปรับปรุงก่อน');
  }
  if (toolRate < 100 && needTool.length) {
    console.log(`  ข้อควรระวัง: มี ${needTool.length - usedTool.length} ครั้งที่ระบบตอบตัวเลขโดยไม่ผ่านเครื่องมือคำนวณ`);
    console.log('  ตัวเลขเหล่านั้นไม่มีอะไรรับประกันความถูกต้อง ถือเป็นความเสี่ยงสูงสุดของระบบนี้');
  }
}

// ส่งออกให้สคริปต์อื่นและชุดทดสอบใช้ตรรกะชุดเดียวกัน ไม่ต้องมีโค้ดสืบค้นซ้ำสองที่
module.exports = { loadProductionConfig, loadKnowledgeBase, retrieve };

if (require.main === module) {
  main().catch((e) => {
    console.error('\nเกิดข้อผิดพลาด:', e.message);
    process.exit(1);
  });
}
