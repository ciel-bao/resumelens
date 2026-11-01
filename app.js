/* ============================================================
 * ResumeLens · 简历透视 — app.js
 * 纯浏览器运行：BYOK（自带密钥）+ OpenAI 兼容接口
 * 默认服务商：通义千问 Qwen（阿里云百炼 DashScope）
 * ============================================================ */
"use strict";

/* ---------- 服务商配置 ---------- */
const PROVIDERS = {
  qwen: {
    name: "通义千问 Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
    defaultModel: "qwen-plus",
    note: "阿里云百炼开通后创建 API Key，新用户有免费额度。"
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    note: "DeepSeek 开放平台创建 API Key，价格更低。"
  },
  custom: {
    name: "自定义",
    baseUrl: "",
    models: [],
    defaultModel: "",
    note: "任意 OpenAI 兼容接口（如 Kimi / 智谱 / 本地 Ollama）。"
  }
};

const STORE_KEY = "resumelens_settings_v1";

/* ---------- 设置（BYOK） ---------- */
function getSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { provider: "qwen", apiKey: "", baseUrl: PROVIDERS.qwen.baseUrl, model: PROVIDERS.qwen.defaultModel };
}
function saveSettings(s) { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }

/* ---------- DOM 工具 ---------- */
const $ = (id) => document.getElementById(id);
function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }
function setText(id, text) { $(id).textContent = text; }
function esc(str) {
  const d = document.createElement("div");
  d.textContent = String(str == null ? "" : str);
  return d.innerHTML;
}

/* ---------- 视图切换 ---------- */
const views = { upload: $("view-upload"), loading: $("view-loading"), results: $("view-results") };
function switchView(name) {
  Object.entries(views).forEach(([k, el]) => { k === name ? show(el) : hide(el); });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- 设置弹窗 ---------- */
const modal = $("settings-modal");
function openSettings() {
  const s = getSettings();
  $("set-provider").value = s.provider;
  $("set-key").value = s.apiKey;
  $("set-baseurl").value = s.baseUrl;
  $("set-model").value = s.model;
  renderProviderHint();
  show(modal);
}
function closeSettings() { hide(modal); }
function renderProviderHint() {
  const p = PROVIDERS[$("set-provider").value];
  $("settings-note").textContent = p ? p.note : "";
  const chips = $("model-chips");
  chips.innerHTML = "";
  (p.models || []).forEach((m) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = m;
    b.addEventListener("click", () => { $("set-model").value = m; });
    chips.appendChild(b);
  });
}
$("set-provider").addEventListener("change", () => {
  const p = PROVIDERS[$("set-provider").value];
  $("set-baseurl").value = p.baseUrl;
  $("set-model").value = p.defaultModel;
  renderProviderHint();
});
$("btn-settings").addEventListener("click", openSettings);
$("btn-settings-close").addEventListener("click", closeSettings);
modal.addEventListener("click", (e) => { if (e.target === modal) closeSettings(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeSettings(); });
$("btn-settings-save").addEventListener("click", () => {
  const provider = $("set-provider").value;
  saveSettings({
    provider,
    apiKey: $("set-key").value.trim(),
    baseUrl: $("set-baseurl").value.trim() || PROVIDERS[provider].baseUrl,
    model: $("set-model").value.trim() || PROVIDERS[provider].defaultModel
  });
  closeSettings();
  updateDemoBadge();
  toast("设置已保存（仅存本机浏览器）");
  // 配置 Key 后，若当前结果是本地预览，自动用 AI 重新分析同一份简历+JD
  const justKey = $("set-key").value.trim();
  if (justKey && (PENDING_RERUN || (RESULT && RESULT.local))) {
    PENDING_RERUN = false;
    toast("已配置 Key · 正在用 AI 重新分析你的简历…");
    runAnalysis();
  }
});
$("btn-settings-clear").addEventListener("click", () => {
  $("set-key").value = "";
  saveSettings({ ...getSettings(), apiKey: "" });
  updateDemoBadge();
  toast("已清除密钥");
});

/* ---------- 测试连接：用当前表单配置发一次最小请求 ---------- */
$("btn-settings-test").addEventListener("click", async () => {
  const provider = $("set-provider").value;
  const key = $("set-key").value.trim();
  const base = ($("set-baseurl").value.trim() || PROVIDERS[provider].baseUrl).replace(/\/+$/, "");
  const model = $("set-model").value.trim() || PROVIDERS[provider].defaultModel;
  const out = $("test-result");
  let host = base;
  try { host = new URL(base).host; } catch (e) { /* 保持原样 */ }

  if (!key) { out.textContent = "请先填写 API Key"; out.className = "test-result err"; return; }
  out.textContent = "测试中…（向 " + host + " 发一次最小请求）";
  out.className = "test-result";
  try {
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 8 })
    });
    if (res.ok) {
      out.textContent = "✓ 连接成功，" + model + " 可用。点「保存」即可开始分析";
      out.className = "test-result ok";
    } else if (res.status === 401) {
      out.textContent = "✗ 401：这个 Key 在 " + host + " 上无效。多半是「服务商」选错了——阿里云百炼的 Key 要选「通义千问」，DeepSeek 的 Key 要选 DeepSeek，两者不通用";
      out.className = "test-result err";
    } else if (res.status === 429) {
      out.textContent = "✗ 429：Key 有效但触发限流/额度不足，稍后重试或检查百炼控制台额度";
      out.className = "test-result err";
    } else {
      const detail = await res.text().catch(() => "");
      out.textContent = "✗ 接口报错 " + res.status + "：" + detail.slice(0, 160);
      out.className = "test-result err";
    }
  } catch (e) {
    out.textContent = "✗ 网络请求失败（检查网络 / Base URL 是否正确）";
    out.className = "test-result err";
  }
});

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg) {
  let t = $("rl-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "rl-toast";
    t.style.cssText = "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#141832;color:#fff;padding:10px 20px;border-radius:10px;font-size:14px;z-index:200;box-shadow:0 8px 24px rgba(0,0,0,.2);transition:opacity .3s";
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = "0"; }, 2600);
}

function updateDemoBadge() {
  const s = getSettings();
  const isDemo = !s.apiKey;
  const badge = $("demo-badge");
  badge.hidden = false;
  badge.textContent = isDemo ? "演示模式 · 未配置 Key" : s.provider === "qwen" ? "通义千问" : s.provider === "deepseek" ? "DeepSeek" : "自定义模型";
}

/* ---------- 文件解析 ---------- */
// PDF / Word 解析库已全部本地化（vendor/ 目录），不依赖任何公网 CDN，
// 在无外网、file:// 直开、GitHub Pages 环境下均可用。
function loadPdfJs() {
  if (!window.pdfjsLib) throw new Error("PDF 解析组件未加载，请刷新页面重试");
  // file:// 下创建 Worker 会被浏览器拦截，pdf.js 会自动降级为 fake worker，
  // 以普通脚本方式加载同一个本地文件，两种协议下都能正常工作。
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  return window.pdfjsLib;
}

async function extractText(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".pdf")) {
    const pdfjs = loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      out += tc.items.map((it) => it.str).join(" ") + "\n";
    }
    return out.trim();
  }
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    if (!window.mammoth) throw new Error("Word 解析组件未加载，请改用粘贴文本");
    const buf = await file.arrayBuffer();
    const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
    return (r.value || "").trim();
  }
  // txt / md / 其他按文本读
  return (await file.text()).trim();
}

/* ---------- 上传交互 ---------- */
const dropResume = $("drop-resume");
const fileResume = $("file-resume");
let resumeFile = null;

dropResume.addEventListener("click", () => fileResume.click());
dropResume.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileResume.click(); });
["dragover", "dragenter"].forEach((ev) => dropResume.addEventListener(ev, (e) => { e.preventDefault(); dropResume.classList.add("dragover"); }));
["dragleave", "drop"].forEach((ev) => dropResume.addEventListener(ev, (e) => { e.preventDefault(); dropResume.classList.remove("dragover"); }));
dropResume.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) setResumeFile(f);
});
fileResume.addEventListener("change", () => { if (fileResume.files[0]) setResumeFile(fileResume.files[0]); });

function setResumeFile(f) {
  resumeFile = f;
  dropResume.classList.add("has-file");
  setText("resume-title", f.name);
  setText("resume-sub", `${(f.size / 1024).toFixed(0)} KB · 点击可更换`);
  hide($("resume-text"));
}

$("btn-paste-toggle").addEventListener("click", () => {
  const ta = $("resume-text");
  ta.hidden = !ta.hidden;
  if (!ta.hidden) { ta.focus(); setText("resume-title", "粘贴简历文本"); setText("resume-sub", "或仍可选择上传文件"); dropResume.classList.remove("has-file"); resumeFile = null; }
});

/* ---------- TopNav ---------- */
document.querySelectorAll("#topnav a").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const nav = a.dataset.nav;
    document.querySelectorAll("#topnav a").forEach((x) => x.classList.remove("active"));
    a.classList.add("active");
    if (nav === "upload") switchView("upload");
    else if (nav && nav.startsWith("results-")) { switchView("results"); activateTab(nav.replace("results-", "")); }
  });
});

/* ---------- Tab ---------- */
function activateTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("panel-report").hidden = name !== "report";
  $("panel-screen").hidden = name !== "screen";
  $("panel-resume").hidden = name !== "resume";
}
document.querySelectorAll(".tab").forEach((t) => {
  if (t.dataset.tab) t.addEventListener("click", () => activateTab(t.dataset.tab));
});
$("btn-goto-resume").addEventListener("click", () => activateTab("resume"));
$("btn-again").addEventListener("click", () => switchView("upload"));
$("btn-banner-key").addEventListener("click", () => { PENDING_RERUN = true; openSettings(); });

/* ---------- LLM 调用（OpenAI 兼容） ---------- */
async function chatJSON(system, user, maxTokens = 3000) {
  const s = getSettings();
  if (!s.apiKey) throw new Error("NO_KEY");
  const url = s.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: s.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.3,
    max_tokens: maxTokens
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + s.apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    throw new Error("网络请求失败（检查网络 / Base URL / 代理）");
  } finally { clearTimeout(timer); }

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 300); } catch (e) { /* ignore */ }
    if (res.status === 401) {
      let host = s.baseUrl;
      try { host = new URL(s.baseUrl).host; } catch (e) { /* ignore */ }
      throw new Error(`API Key 无效或未授权（401，接口：${host}）。常见原因：① 服务商选错——阿里云百炼的 Key 必须选「通义千问」，DeepSeek 的 Key 选 DeepSeek，两者不通用；② Key 已被重新生成。到「设置 API Key」里改好后点「测试连接」验证`);
    }
    if (res.status === 429) throw new Error("调用频率/额度受限（429）：" + detail);
    throw new Error(`模型接口报错 ${res.status}：${detail}`);
  }
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "";
  return extractJSON(text);
}

/* 从模型输出中稳健地提取 JSON 对象 */
function extractJSON(text) {
  if (!text) throw new Error("模型返回为空");
  const cleaned = text.replace(/```json/gi, "```").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("模型未返回 JSON：" + cleaned.slice(0, 120));
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(cleaned.slice(start, i + 1)); } catch (e) { throw new Error("JSON 解析失败：" + e.message); } } }
    }
  }
  throw new Error("JSON 不完整（可能被截断），请重试或换用更长上下文的模型");
}

/* ---------- 提示词 ---------- */
const JSON_RULE = "只输出纯 JSON，不要 markdown 代码块，不要任何解释文字。不要编造简历中不存在的事实；缺失数据用提示性占位，不要虚构具体数字。";

const PROMPT_REPORT = `你是资深 HR 总监与简历诊断专家。用户会给你【简历】和【目标岗位JD】。请严格输出 JSON：
{"score": 整数0-100岗位匹配分, "percentile": 整数0-100击败同岗求职者的百分位, "verdict": "不超过30字的总体评价", "dimensions": [{"name": "岗位匹配度", "value": 整数0-100}, {"name": "经历量化", "value": 整数}, {"name": "关键词覆盖", "value": 整数}, {"name": "格式规范", "value": 整数}, {"name": "职业叙事", "value": 整数}], "hardIssues": ["致命硬伤，最多3条，每条具体且可修复"], "strengths": ["亮点，最多3条，真实"]}
评分规则：score 为五维加权（匹配度40%、量化20%、关键词20%、格式10%、叙事10%）；hardIssues 必须指向简历里真实存在的问题。${JSON_RULE}`;

const PROMPT_SCREEN = `你扮演该岗位最严苛的 hiring manager，第一轮简历初筛只有 8 秒。根据用户的【简历】和【JD】严格输出 JSON：
{"passRateBefore": 整数0-100 当前简历通过初筛的概率, "passRateAfter": 整数0-100 按建议修改后的通过率, "quote": "面试官第一人称点评，90-130字，直接犀利但具体，先讲为什么会被筛掉，再给一句肯定", "rejectReasons": ["会被筛掉的具体原因，最多3条"], "fixActions": ["补上就能进面试池的具体动作，最多3条，可执行"]}
概率要符合真实校招/社招筛选水平，不要全给高分。${JSON_RULE}`;

const PROMPT_RESUME = `你是顶级简历改写专家。根据用户的【原简历】和【目标岗位JD】生成优化版简历。严格输出 JSON：
{"beforeScore": 整数0-100, "afterScore": 整数0-100, "resume": {"name": "姓名", "title": "求职意向岗位", "sections": [{"title": "板块标题", "bullets": ["条目", "..."]}]}
要求：4-6 个板块（核心技能前置、工作/项目经历用 STAR+量化重写、教育背景等）；保留真实经历不编造；原简历缺数据的位置写"【建议补充：xxx数据】"；关键词对齐 JD 高频词。${JSON_RULE}`;

/* ---------- 分析主流程 ---------- */
let RESULT = null; // {report, screen, resume}
let SOURCE = null; // {resumeText, jdText}
let PENDING_RERUN = false; // 从提示条进入设置并保存 Key 后，自动重新分析

async function getResumeText() {
  if (resumeFile) return extractText(resumeFile);
  const pasted = $("resume-text").value.trim();
  if (pasted) return pasted;
  return "";
}

function setStep(step, state) {
  const el = document.querySelector(`.step[data-step="${step}"]`);
  if (el) { el.classList.remove("active", "done"); if (state) el.classList.add(state); }
}
function resetSteps() { ["report", "screen", "resume"].forEach((s) => setStep(s, null)); }

$("btn-analyze").addEventListener("click", runAnalysis);

/* ---------- 本地规则预览（未配置 Key 时的兜底，结果基于用户真实简历） ---------- */
const KW_STOP = /[的了与和及或等对在为有是要能会将从把被其该些个并而但因此进行使用通过可以以上相关具备拥良好较强优秀包含负责完成参与协助支持岗位职位任职要求描述职责者优先公司经验能力者熟精掌很更最如请应当需]/;

function extractKeywords(jd, max) {
  const score = new Map();
  const add = (t, v) => { if (t.length >= 2) score.set(t, (score.get(t) || 0) + v); };
  // 英文：先取多词短语（Power BI / Deep Learning），再取单词
  (jd.match(/[A-Za-z][A-Za-z0-9+#./-]*(?:\s+[A-Za-z][A-Za-z0-9+#./-]*)+/g) || []).forEach((p) => add(p.trim(), 4));
  (jd.match(/[A-Za-z][A-Za-z0-9+#./-]*/g) || []).forEach((w) => add(w.trim(), 3));
  // 中文 2-4 字滑窗词频
  const segs = jd.replace(/[^\u4e00-\u9fa5]+/g, " ").split(/\s+/).filter(Boolean);
  segs.forEach((seg) => {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        const t = seg.slice(i, i + n);
        if (KW_STOP.test(t)) continue;
        add(t, n >= 3 ? 2 : 1);
      }
    }
  });
  const cands = [...score.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const kept = [];
  for (const [t, v] of cands) {
    if (kept.some((k) => k.includes(t) || t.includes(k))) continue;
    // 3 字以上中文词需字头/字尾二元组同样高频，过滤滑窗残词（如「算管理」「营分析」）
    if (/^[\u4e00-\u9fa5]{3,}$/.test(t)) {
      const h = score.get(t.slice(0, 2)) || 0, tl = score.get(t.slice(-2)) || 0;
      if (Math.max(h, tl) < v) continue;
    }
    // 低频中文二字词多为切分噪声
    if (/^[\u4e00-\u9fa5]{2}$/.test(t) && v < 2) continue;
    // 与已保留词存在单字接缝的也视为切分残片（如「集团预」贴着「预算」）
    if (kept.some((k) => k.slice(-1) === t.slice(0, 1) || t.slice(-1) === k.slice(0, 1))) continue;
    kept.push(t);
    if (kept.length >= max) break;
  }
  return kept;
}

function localAnalyze(resumeText, jdText) {
  const kws = extractKeywords(jdText, 10);
  const hay = resumeText.toLowerCase();
  const matched = kws.filter((k) => hay.includes(k.toLowerCase()));
  const missing = kws.filter((k) => !hay.includes(k.toLowerCase()));
  const coverage = kws.length ? Math.round((matched.length / kws.length) * 100) : 50;

  const numHits = (resumeText.match(/\d+(\.\d+)?\s*(%|％|万|亿|k|K|人|天|月|年|元|¥|份|次|个)/g) || []).length;
  const quantified = Math.min(92, 25 + numHits * 9);
  const hasStruct = /(教育|工作经历|项目|技能|实习)/.test(resumeText);
  const lenOk = resumeText.length >= 300 && resumeText.length <= 5000;
  const structure = hasStruct ? (lenOk ? 85 : 65) : 45;
  const bullets = (resumeText.match(/[•·]|^\s*[-–—]\s|\d+[\.、]/gm) || []).length;
  const narrative = Math.min(90, 40 + Math.min(30, bullets * 3) + (lenOk ? 15 : 0));
  const score = clampInt(coverage * 0.4 + quantified * 0.2 + structure * 0.2 + narrative * 0.2, 10, 92);

  const missTxt = missing.slice(0, 3).join("」「");
  const matchTxt = matched.slice(0, 3).join("」「");

  const report = {
    score,
    percentile: clampInt(score - 12, 3, 95),
    verdict: score >= 75 ? "与目标岗位匹配度较高，补量化后更有竞争力" : score >= 55 ? "有一定基础，但与 JD 存在明显缺口" : "与目标岗位差距较大，需系统性修改",
    dimensions: [
      { name: "岗位匹配度", value: clampInt(coverage * 0.9 + 8, 5, 95) },
      { name: "经历量化", value: quantified },
      { name: "关键词覆盖", value: coverage },
      { name: "格式规范", value: structure },
      { name: "职业叙事", value: narrative }
    ],
    hardIssues: [
      missing.length ? `JD 核心关键词「${missTxt}」在简历中未出现` : null,
      numHits < 3 ? "经历描述缺少量化数据（% / 金额 / 周期 / 规模），难以证明实际成果" : null,
      !hasStruct ? "缺少清晰的结构分区（工作经历 / 教育背景 / 技能），HR 定位信息困难" : null
    ].filter(Boolean).slice(0, 3),
    strengths: [
      matched.length ? `已覆盖 ${matched.length} 个 JD 关键词（如「${matchTxt}」）` : null,
      numHits >= 3 ? `有 ${numHits} 处量化描述，成果意识较好` : null,
      hasStruct ? "结构分区清晰，HR 易于快速定位" : "内容完整，可直接进入优化环节"
    ].filter(Boolean).slice(0, 3)
  };

  const before = clampInt(coverage * 0.7 + 8, 5, 70);
  const screen = {
    passRateBefore: before,
    passRateAfter: clampInt(before + missing.length * 4 + 18, before + 5, 95),
    quote: `「这份简历我大概会花 ${clampInt(14 - Math.round(score / 10), 6, 20)} 秒。` +
      (missing.length
        ? `JD 里的「${missTxt}」我没有直接看到，没法确认你做过，这种情况下我不会往下翻。`
        : `基础匹配尚可，但缺少让我眼前一亮的量化成果。`) +
      `不过${matched.length ? `「${matchTxt}」对上了，方向是对的` : "专业背景是相关的"}，补上缺口我会再看你。」`,
    rejectReasons: [
      missing.length ? `初筛关键词不匹配：JD 要求的「${missTxt}」未体现` : null,
      numHits < 3 ? "经历没有数字支撑，无法评估真实产出" : null,
      resumeText.length > 5000 ? "篇幅过长，重点不突出" : null
    ].filter(Boolean).slice(0, 3),
    fixActions: [
      missing.length ? `把「${missTxt}」自然融入经历描述（确有相关经验才写）` : null,
      "为每段经历补 1-2 个量化结果（% / 金额 / 周期 / 规模）",
      "把与 JD 最相关的经历调整到最前面"
    ].filter(Boolean).slice(0, 3)
  };

  const lines = resumeText.split(/\n+/).map((s) => s.trim()).filter((s) => s.length >= 8).slice(0, 10);
  const resume = {
    beforeScore: score,
    afterScore: clampInt(score + missing.length * 3 + 12, score + 5, 96),
    resume: {
      name: (resumeText.split(/\n/)[0] || "").trim().slice(0, 12) || "你的姓名",
      title: (jdText.split(/\n/)[0] || "").trim().slice(0, 24) || "目标岗位",
      sections: [
        {
          title: "核心技能（对齐 JD）",
          bullets: [
            matched.length ? `已覆盖：${matched.join(" · ")}` : "（未检测到与 JD 重合的关键词，建议对照 JD 补充技能清单）",
            missing.length ? `待补全：${missing.join(" · ")}（如确有相关经验，务必写入简历）` : "关键词覆盖完整，保持即可"
          ]
        },
        {
          title: "工作经历（原文保留）",
          bullets: lines.length ? lines.map((l) => (l.length > 60 ? l.slice(0, 60) + "…" : l)) : ["（未能从原文提取到有效条目）"]
        },
        {
          title: "关于本预览",
          bullets: [
            "本地预览只做关键词与结构对齐，不会替你编造任何经历",
            "配置 API Key 后，AI 将基于你的真实经历按 STAR 原则重写全文并补齐量化建议"
          ]
        }
      ]
    }
  };

  return { report, screen, resume };
}

async function runAnalysis() {
  const errBox = $("upload-error");
  hide(errBox);
  const jdText = $("jd-text").value.trim();

  setText("loading-title", "正在提取简历内容…");
  switchView("loading");
  resetSteps();

  let resumeText = "";
  try {
    resumeText = await getResumeText();
  } catch (e) {
    showUploadError("简历解析失败：" + e.message + "。可改用「粘贴简历文本」。");
    return;
  }

  if (!resumeText) { showUploadError("请先上传简历文件或粘贴简历文本。"); return; }
  if (!jdText) { showUploadError("请粘贴目标岗位的 JD 描述。"); return; }
  if (resumeText.length < 50) { showUploadError("简历内容太短（不足 50 字），请检查文件是否解析成功。"); return; }

  SOURCE = { resumeText, jdText };
  const s = getSettings();
  const isLocal = !s.apiKey;
  const local = isLocal ? localAnalyze(resumeText, jdText) : null;
  $("btn-analyze").disabled = true;

  try {
    setText("loading-title", isLocal ? "本地预览 · 正在分析你的简历…" : "AI 正在体检你的简历…");
    setStep("report", "active");
    const report = isLocal ? local.report : await chatJSON(PROMPT_REPORT, ctx(), 2000);
    setStep("report", "done");

    setText("loading-title", isLocal ? "本地预览 · 正在分析你的简历…" : "面试官正在模拟初筛…");
    setStep("screen", "active");
    const screen = isLocal ? local.screen : await chatJSON(PROMPT_SCREEN, ctx(), 2000);
    setStep("screen", "done");

    setText("loading-title", isLocal ? "本地预览 · 正在分析你的简历…" : "正在生成优化版简历…");
    setStep("resume", "active");
    const resume = isLocal ? local.resume : await chatJSON(PROMPT_RESUME, ctx(), 4000);
    setStep("resume", "done");

    RESULT = { report, screen, resume, local: isLocal };
    renderAll();
    switchView("results");
    activateTab("report");
    updateTopnavForResults();
    if (isLocal) toast("本地预览已生成 · 配置 API Key 解锁 AI 深度分析与重写");
  } catch (e) {
    if (e.message === "NO_KEY") {
      switchView("upload");
      openSettings();
      showUploadError("尚未配置 API Key，无法进行真实分析。");
    } else if (RESULT) {
      // 已有旧结果时保留在结果页，只提示失败，避免用户丢失已生成内容
      switchView("results");
      toast("分析失败：" + e.message);
    } else {
      switchView("upload");
      showUploadError("分析失败：" + e.message);
    }
  } finally {
    $("btn-analyze").disabled = false;
  }
}

function ctx() {
  return `【简历】\n${SOURCE.resumeText.slice(0, 12000)}\n\n【目标岗位JD】\n${SOURCE.jdText.slice(0, 6000)}`;
}

function showUploadError(msg) {
  const el = $("upload-error");
  el.textContent = msg;
  show(el);
  switchView("upload");
}

function updateTopnavForResults() {
  document.querySelector('[data-nav="results-report"]').hidden = false;
  document.querySelector('[data-nav="results-screen"]').hidden = false;
  document.querySelector('[data-nav="results-resume"]').hidden = false;
}

/* ---------- 渲染 ---------- */
function renderAll() {
  $("local-banner").hidden = !RESULT.local;
  renderReport(RESULT.report);
  renderScreen(RESULT.screen);
  renderResume(RESULT.resume);
}

function renderReport(r) {
  const score = clampInt(r.score, 0, 100);
  const pct = clampInt(r.percentile, 0, 100);
  setText("report-pill", `岗位匹配度 ${score} / 100`);
  setText("score-value", String(score));
  setText("score-beat", `击败 ${pct}% 同岗求职者`);
  setText("score-verdict", r.verdict || "—");

  const dims = $("dims");
  dims.querySelectorAll(".dim").forEach((n) => n.remove());
  const list = Array.isArray(r.dimensions) ? r.dimensions.slice(0, 6) : [];
  list.forEach((d) => {
    const v = clampInt(d.value, 0, 100);
    const div = document.createElement("div");
    div.className = "dim";
    div.innerHTML = `<div class="dim-row"><span class="dim-name">${esc(d.name)}</span><span class="dim-val">${v}%</span></div>
      <div class="dim-track"><div class="dim-fill" style="width:0%"></div></div>`;
    dims.appendChild(div);
    requestAnimationFrame(() => requestAnimationFrame(() => { div.querySelector(".dim-fill").style.width = v + "%"; }));
  });

  fillList("hard-issues", r.hardIssues);
  fillList("strengths", r.strengths);
}

function renderScreen(r) {
  const before = clampInt(r.passRateBefore, 0, 100);
  const after = clampInt(r.passRateAfter, 0, 100);
  setText("screen-pill", `通过率 ${before}% → ${after}%`);
  setText("screen-quote", r.quote || "—");
  fillList("reject-reasons", r.rejectReasons);
  fillList("fix-actions", r.fixActions);
}

function renderResume(r) {
  const before = clampInt(r.beforeScore, 0, 100);
  const after = clampInt(r.afterScore, 0, 100);
  setText("resume-pill", `改造前 ${before}% → 改造后 ${after}%`);
  setText("compare-value", `+${Math.max(0, after - before)} 分`);

  const doc = r.resume || {};
  const html = [];
  html.push(`<div class="rd-name">${esc(doc.name || "姓名")}</div>`);
  if (doc.title) html.push(`<div class="rd-bullet" style="padding-left:0">求职意向：${esc(doc.title)}</div>`);
  (doc.sections || []).forEach((sec) => {
    html.push(`<div class="rd-section-title">${esc(sec.title || "")}</div>`);
    (sec.bullets || []).forEach((b) => html.push(`<div class="rd-bullet">${esc(b)}</div>`));
  });
  $("resume-doc-content").innerHTML = html.join("");
}

function fillList(id, arr) {
  const el = $(id);
  el.innerHTML = "";
  (Array.isArray(arr) ? arr : []).slice(0, 4).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/* ---------- 导出 ---------- */
function resumeToMarkdown() {
  const r = RESULT.resume.resume || {};
  const lines = [];
  lines.push(`# ${r.name || ""}`);
  if (r.title) lines.push(`**求职意向：${r.title}**`);
  lines.push("");
  (r.sections || []).forEach((sec) => {
    lines.push(`## ${sec.title || ""}`);
    (sec.bullets || []).forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  });
  lines.push("---");
  lines.push("由 ResumeLens · 简历透视 生成（AI 优化，请核实后投递）");
  return lines.join("\n");
}

$("btn-download").addEventListener("click", () => {
  const blob = new Blob([resumeToMarkdown()], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "优化版简历.md";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(resumeToMarkdown());
    toast("已复制到剪贴板");
  } catch (e) {
    toast("复制失败，请手动选择文本复制");
  }
});

$("btn-print").addEventListener("click", () => {
  const r = RESULT.resume.resume || {};
  const pa = $("print-area");
  let html = `<h1>${esc(r.name || "")}</h1>`;
  if (r.title) html += `<div class="pr-title">求职意向：${esc(r.title)}</div>`;
  (r.sections || []).forEach((sec) => {
    html += `<h2>${esc(sec.title || "")}</h2><ul>`;
    (sec.bullets || []).forEach((b) => { html += `<li>${esc(b)}</li>`; });
    html += `</ul>`;
  });
  html += `<p style="margin-top:24px;color:#888;font-size:11px">由 ResumeLens · 简历透视 生成（AI 优化，请核实后投递）</p>`;
  pa.innerHTML = html;
  hide(pa); // 保持 display:none 由打印样式接管
  window.print();
});

/* ---------- 演示数据（与设计稿一致） ---------- */
const DEMO = {
  report: {
    score: 87, percentile: 82,
    verdict: "总体：具备面试竞争力，需补齐量化成果",
    dimensions: [
      { name: "岗位匹配度", value: 87 },
      { name: "经历量化", value: 64 },
      { name: "关键词覆盖", value: 91 },
      { name: "格式规范", value: 80 },
      { name: "职业叙事", value: 72 }
    ],
    hardIssues: ["经历缺乏量化，3 段均无数据支撑", "关键技能埋在第 3 屏，8 秒扫读易错过", "与 JD 高频词重合度低，ATS 易判不匹配"],
    strengths: ["教育背景与岗位方向高度契合", "有跨部门协作经验，符合团队需求"]
  },
  screen: {
    passRateBefore: 32, passRateAfter: 81,
    quote: "“你的简历大概率会在 8 秒内被筛掉——经历没有量化、关键技能埋太深。但底子不错，补上 STAR 重写和关键词对齐，进面试池没问题。”",
    rejectReasons: ["无量化成果，看不出价值", "关键技能埋在第 3 屏", "与 JD 关键词重合度低"],
    fixActions: ["用 STAR 重写 3 段经历", "把核心技能提到首屏", "对齐 JD 高频词 12 处"]
  },
  resume: {
    beforeScore: 41, afterScore: 92,
    resume: {
      name: "张明 ｜ 高级产品经理", title: "高级产品经理",
      sections: [
        { title: "核心技能（首屏前置）", bullets: ["数据分析 · 增长策略 · SQL · 用户研究 · 团队管理"] },
        { title: "工作经历（STAR 重写）", bullets: [
          "主导电商增长项目，3 个月带动 GMV 提升 32%（¥1,200万 → ¥1,584万）",
          "搭建 8 人跨职能团队，将需求交付周期从 21 天缩短至 12 天",
          "推动 A/B 实验体系落地，年节省试错成本约 ¥300 万"
        ] },
        { title: "教育背景", bullets: ["XX大学 · 硕士 · 管理科学与工程"] }
      ]
    }
  }
};

/* ---------- #demo 直达演示（可分享链接：index.html#demo） ---------- */
const DEMO_SOURCE = {
  resumeText: "张明 · 产品经理\n工作经历：负责电商增长项目；搭建跨职能团队；推动 A/B 实验体系落地。\n技能：数据分析、SQL、用户研究。\n教育背景：XX大学 硕士 管理科学与工程。",
  jdText: "招聘：高级产品经理。职责：负责电商增长方向，搭建增长实验体系，带领跨职能团队交付。任职要求：3年以上产品经验，数据分析能力强，熟悉 SQL 与 A/B 测试，具备团队管理经验。"
};

function runDemo(tab) {
  SOURCE = DEMO_SOURCE;
  RESULT = { report: DEMO.report, screen: DEMO.screen, resume: DEMO.resume, local: false };
  switchView("loading");
  resetSteps();
  ["report", "screen", "resume"].forEach((s) => setStep(s, "done"));
  setText("loading-title", "演示模式 · 生成示例报告…");
  setTimeout(() => {
    renderAll();
    switchView("results");
    activateTab(tab || "report");
    updateTopnavForResults();
  }, 500);
}

/* ---------- 初始化 ---------- */
updateDemoBadge();
if (location.hash.startsWith("#demo")) {
  const tab = location.hash === "#demo-screen" ? "screen" : location.hash === "#demo-resume" ? "resume" : "report";
  runDemo(tab);
}
