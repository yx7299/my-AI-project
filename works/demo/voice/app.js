/* ==========================================================================
 * 语音交互助手 —— 前端逻辑
 * --------------------------------------------------------------------------
 * 函数式架构，一个函数干一件事：
 *
 *   listen()               —— 麦克风录音 + 语音识别（浏览器 SpeechRecognition）
 *   think(text)            —— 把文字发给 Flask 后端，拿回大模型回答（架构不变）
 *   speak(text)            —— 朗读编排：优先 edge-tts，失败自动降级
 *     ├─ speak_with_edge_tts(text, voice_name) —— 调后端 edge-tts 拿高音色 mp3
 *     └─ speak_fallback(text)                  —— 浏览器 speechSynthesis 保底
 *   remember(user_msg, ai_msg) —— 维护 messages 对话记忆，只保留最近 10 轮
 *
 * 完整链路：点击麦克风 → listen() → think() → remember() → speak()
 * ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
 * 一、全局状态与 DOM 引用
 * ------------------------------------------------------------------------ */

/** 记忆容量：最多保留 10 轮对话（一轮 = 一问一答 = 2 条消息） */
const MAX_HISTORY_TURNS = 10;

/**
 * 本地兜底音色表：/api/voices 拿不到时用它，保证下拉框不空。
 * 正常情况下以后端返回的在线清单为准（后端还会做缓存）。
 */
const FALLBACK_EDGE_VOICES = [
  { name: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声 · 温柔' },
  { name: 'zh-CN-XiaoyiNeural',   label: '晓伊 · 女声 · 活泼' },
  { name: 'zh-CN-YunjianNeural',  label: '云健 · 男声 · 浑厚' },
  { name: 'zh-CN-YunxiNeural',    label: '云希 · 男声 · 阳光' },
  { name: 'zh-CN-YunxiaNeural',   label: '云夏 · 男声 · 少年' },
  { name: 'zh-CN-YunyangNeural',  label: '云扬 · 男声 · 播报' },
  { name: 'zh-HK-HiuMaanNeural',  label: '晓曼 · 女声 · 粤语' },
  { name: 'zh-TW-HsiaoChenNeural', label: '晓臻 · 女声 · 国语' },
];

/* --------------------------------------------------------------------------
 * 零、演示模式 · 本地检索问答引擎
 * --------------------------------------------------------------------------
 * 真机版本里 think() 会请求 Flask 后端（大模型 + edge-tts）。
 * 为了让作品集在没有服务器的纯静态环境下也能「真的能用」，这里把后端
 * 换成了浏览器内的等价实现：
 *
 *   - 检索：把内置资料按段落切块，用字符二元组（bigram）算重合度排序，
 *           命中超过阈值就当作「查到了」，与后端 search_knowledge_base 同构。
 *   - 回答：从命中的段落里挑出最相关的句子拼成回复；完全没命中就明确
 *           回答「资料里没有提到」，而不是编一个答案。
 *   - 上传：在页面上传的 .md / .txt 会真的进入检索范围，立刻可被问到。
 * ------------------------------------------------------------------------ */

const LOCAL_KB = [
  {
    name: '公司资料.md',
    text: `# 智语AI语音助手产品手册

## 1. 产品概述
智语AI语音助手是一款基于DeepSeek大模型开发的智能对话设备

## 2. 核心参数
续航时间：48小时（标准使用模式）
待机时间：720小时（30天）
重量：200克
尺寸：120mm × 60mm × 25mm
语音识别准确率：98.5%（普通话）
响应延迟：平均1.2秒

## 3. 功能说明
支持语音交互
支持知识库问答
支持多轮对话记忆（支持最近10轮）

## 4. 使用指南
首次开机、日常操作

## 5. 常见问题
设备无法联网怎么办？
语音识别不准确怎么办？
可以更换大模型吗？

## 6. 保修政策
保修期限：自购买之日起两年免费保修
客服热线：400-888-6666
服务邮箱：support@zhiyu-ai.com

## 7. 安全注意事项`
  },
  {
    name: '示例资料-产品说明.md',
    text: `# 示例资料 · 星辰盒子 产品说明

## 基本信息
星辰盒子（型号 XB-200）是一款家用智能终端，官方售价 899 元。

## 硬件规格
支持 2.4G / 5G 双频 Wi-Fi，也支持有线千兆网口
内置 8000mAh 电池，典型续航 12 小时，待机 7 天
支持蓝牙 5.3，可同时连接 2 个音频设备
存储为 4GB 内存 + 64GB 闪存，不支持扩展卡

## 保修与售后
整机保修 2 年，电池等易损件保修 6 个月
人为损坏不在保修范围内
退换货需保留原始包装，7 天内可无理由退货

## 固件升级
在「设置 - 关于本机 - 检查更新」中点击升级，升级过程约 3 分钟，升级时请保持通电，不要断电。`
  },
  {
    name: '示例资料-员工手册.md',
    text: `# 示例资料 · 员工手册

## 年假制度
入职满 1 年：每年 5 天年假
入职满 3 年：每年 10 天年假
入职满 5 年：每年 15 天年假
年假需提前 3 个工作日申请，当年未休完最多结转 5 天到次年 3 月 31 日。

## 差旅报销
出差交通费凭票据实报实销，市内交通每天上限 80 元
住宿标准：一线城市每晚 500 元，其他城市每晚 350 元
报销单需在出差结束后 15 个工作日内提交
超过 30 个工作日未提交的，原则上不再受理

## 考勤与弹性
标准工作时间为 9:30 - 18:30，含 1 小时午休
允许前后弹性 1 小时上下班
每月迟到累计超过 3 次，会影响当月全勤奖

## 加班补助
工作日加班到 20:00 之后，餐补 30 元/天
周末加班可申请调休，调休需在 3 个月内用完`
  },
];

/** 把一份资料切成检索小块（按标题 / 空行切，块内保留换行以便按句取用） */
function chunkDoc(doc) {
  return doc.text
    .split(/\n{2,}|(?=\n#{1,4}\s)/)
    .map(s => s.replace(/^#{1,4}\s*/, '').replace(/[ \t]*\n[ \t]*/g, '\n').trim())
    .filter(s => s.length > 8)
    .map(s => ({ src: doc.name, text: s }));
}

let LOCAL_CHUNKS = [];
function rebuildIndex() {
  LOCAL_CHUNKS = [];
  LOCAL_KB.forEach(d => { LOCAL_CHUNKS = LOCAL_CHUNKS.concat(chunkDoc(d)); });
}
rebuildIndex();

/** 取字符串的字符二元组（去标点），用于相似度比对 */
function bigrams(s) {
  const t = String(s).replace(/[\s，。！？、：；「」《》（）()"'·\-—…!?,.:;]/g, '');
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.substr(i, 2));
  return out;
}

/** 在本地知识库里检索，返回命中的片段（按重合度排序） */
function searchKB(query, topK) {
  const qb = bigrams(query);
  if (!qb.length) return [];
  return LOCAL_CHUNKS
    .map(c => {
      let hit = 0;
      qb.forEach(b => { if (c.text.indexOf(b) > -1) hit++; });
      return { src: c.src, text: c.text, score: hit / qb.length, hit: hit };
    })
    .filter(x => x.hit >= 1 && x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK || 3);
}

/** 一些不需要查资料的寒暄 / 介绍类问题 */
const SMALL_TALK = [
  { keys: ['你好', '您好', 'hello', 'hi', '在吗', '嗨'],
    reply: '你好，我是语音交互助手。你可以直接对着麦克风说话，也可以用下面的输入框提问；问到知识库里的内容时，我会先去查资料再回答。' },
  { keys: ['你是谁', '介绍', '能做什么', '会什么', '功能', '干嘛'],
    reply: '我是语音交互助手：先听你说一句话，把它识别成文字，交给模型思考，再把答案读出来。我还能查本地知识库，查不到会直接告诉你资料里没有。' },
  { keys: ['怎么用', '如何使用', '使用方法'],
    reply: '点麦克风开始说，说完自动结束；也可以直接用输入框打字。想让我回答特定资料里的内容，把资料上传到知识库即可。' },
];

/** localAnswer() —— 本地生成回答 + 决策过程，等价于后端 /api/agent */
function localAnswer(query) {
  const t0 = performance.now();
  const low = query.toLowerCase();

  for (const st of SMALL_TALK) {
    if (st.keys.some(k => low.indexOf(k) > -1)) {
      return { reply: st.reply, hits: [], sources: [], used: false, t0 };
    }
  }

  const hits = searchKB(query, 3);
  if (!hits.length) {
    return {
      reply: '资料里没有提到这个内容。你可以把相关的中文资料上传到知识库，我再试着回答。',
      hits: [], sources: [], used: true, t0
    };
  }

  const qb = bigrams(query);
  const picked = [];
  hits.forEach(h => {
    const sents = h.text.split(/[。！？；\n]/).map(s => s.trim()).filter(s => s.length > 3);
    const cand = sents
      .map(s => {
        let c = 0;
        qb.forEach(b => { if (s.indexOf(b) > -1) c++; });
        return { s: s, c: c };
      })
      .filter(x => x.c >= 1 && !isHeading(x.s))
      .sort((a, b) => b.c - a.c || b.s.length - a.s.length);

    const strong = cand.filter(x => x.c >= 2).slice(0, 2).map(x => x.s);
    if (strong.length) strong.forEach(s => picked.push({ src: h.src, s: s }));
    else if (cand.length) picked.push({ src: h.src, s: cand[0].s });
  });

  const top = picked.slice(0, 3);
  const sources = Array.from(new Set(top.map(p => p.src)));
  // 命中得越扎实，措辞越肯定；勉强命中就说得保守一点，不硬编答案
  const strongHit = hits[0].score >= 0.45;
  const head = strongHit ? '根据我知识库里的资料：' : '资料里没有直接写，不过我找到相关内容：';
  return {
    reply: head + top.map(p => p.s).join('；') + '。',
    hits, sources, used: true, t0
  };
}

/** 判断一句是不是纯标题（标题本身不含信息量，不该拿来当答案） */
function isHeading(s) {
  if (s.length < 6) return true;
  if (/^(\d+[\.、]|[一二三四五六七八九十]+、|#)/.test(s)) return true;
  if (/(示例资料|公司资料)/.test(s)) return true;
  return /(产品手册|产品说明|员工手册|保修政策|功能说明|硬件规格|基本信息|保修与售后|核心参数|常见问题|安全注意事项|年假制度|差旅报销|考勤与弹性|加班补助|固件升级|使用指南|设计流程|日程管理|文件管理)$/.test(s);
}

/** 应用状态，用一个对象集中管理，避免散落的全局变量 */
const state = {
  recognizing: false,     // 是否正在录音识别
  busy: false,            // 是否正在等待后端回答（此时不允许再次录音）

  messages: [],           // 对话记忆 [{role, content}]，由 remember() 维护
  engine: 'edge',         // 朗读引擎：'edge' | 'browser'
  edgeAvailable: null,    // edge-tts 是否可用：null 未探测 / true / false
  edgeVoices: [],         // edge-tts 音色列表
  edgeVoiceName: '',      // 选中的 edge 音色名
  browserVoices: [],      // 浏览器音色列表
  browserVoiceName: '',   // 选中的浏览器音色名

  kbDocuments: [],        // 知识库文档列表
  stopAudio: null,        // 用于中断正在播放的 edge-tts 音频（避免 await 卡死）
};

/* 语音识别对象的构造函数（不同浏览器前缀不同） */
const SpeechRecognitionCtor =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

/** 是否支持浏览器语音合成 */
const ttsSupported = 'speechSynthesis' in window;

/* DOM 引用集中在这里，方便统一改名 */
const $ = (id) => document.getElementById(id);

const el = {
  chatLog:      $('chatLog'),
  emptyTip:     $('emptyTip'),
  interim:      $('interim'),
  interimText:  $('interimText'),
  micBtn:       $('micBtn'),
  micHint:      $('micHint'),
  engineSelect: $('engineSelect'),
  voiceSelect:  $('voiceSelect'),
  autoSpeak:    $('autoSpeak'),
  showTrace:    $('showTrace'),
  memoryBadge:  $('memoryBadge'),
  clearBtn:     $('clearBtn'),
  kbToggle:     $('kbToggle'),
  kbBadge:      $('kbBadge'),
  kbPanel:      $('kbPanel'),
  kbDrop:       $('kbDrop'),
  kbFile:       $('kbFile'),
  kbList:       $('kbList'),
  kbEmpty:      $('kbEmpty'),
  textForm:     $('textForm'),
  textInput:    $('textInput'),
  sendBtn:      $('sendBtn'),
  statusPill:   $('statusPill'),
  statusText:   $('statusText'),
  toast:        $('toast'),
};

/* 空状态提示的原始 HTML，清空对话时用来还原 */
let emptyTipHTML = '';


/* --------------------------------------------------------------------------
 * 二、通用小工具（UI 辅助，非核心逻辑）
 * ------------------------------------------------------------------------ */

/**
 * 创建一条消息的骨架：头像 + 主体容器。
 * 主体容器（.body）里先放决策过程（如果有），再放回答气泡。
 * @param {'user'|'ai'|'error'} role 角色
 * @returns {{wrap: HTMLElement, body: HTMLElement}}
 */
function buildMessageNode(role) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? '🙋' : '🤖';

  const body = document.createElement('div');
  body.className = 'body';

  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return { wrap, body };
}

/**
 * 在对话区新增一条消息气泡。
 * @param {string} text  消息文本
 * @param {'user'|'ai'|'error'} role 角色，决定气泡样式和头像
 * @returns {HTMLElement} 新建的气泡元素
 */
function addMessage(text, role) {
  if (el.emptyTip) el.emptyTip.style.display = 'none';

  const { wrap, body } = buildMessageNode(role);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;      // 用 textContent 而非 innerHTML，防止 XSS

  body.appendChild(bubble);
  el.chatLog.appendChild(wrap);

  scrollToBottom();
  return bubble;
}

/**
 * 把一个气泡标记为错误样式（气泡元素来自 addTypingBubble / addMessage）。
 * @param {HTMLElement} bubble 气泡元素
 * @param {string} text 错误文本
 */
function markError(bubble, text) {
  const wrap = bubble.closest('.msg');
  if (wrap) {
    wrap.classList.remove('ai');
    wrap.classList.add('error');
  }
  bubble.textContent = text;
}

/** 插入一个「正在思考」的动画气泡，返回气泡元素供后续替换 */
function addTypingBubble() {
  if (el.emptyTip) el.emptyTip.style.display = 'none';

  const { wrap, body } = buildMessageNode('ai');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const dots = document.createElement('div');
  dots.className = 'typing';
  dots.innerHTML = '<span></span><span></span><span></span>';

  bubble.appendChild(dots);
  body.appendChild(bubble);
  el.chatLog.appendChild(wrap);
  scrollToBottom();
  return bubble;
}

/** 滚动到对话区底部 */
function scrollToBottom() {
  requestAnimationFrame(() => {
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  });
}

/**
 * 顶部提示条
 * @param {string} message 内容
 * @param {'info'|'ok'|'error'} type 类型
 * @param {number} duration 显示时长（毫秒），0 表示不自动隐藏
 */
function toast(message, type = 'info', duration = 3200) {
  el.toast.textContent = message;
  el.toast.className = `toast show ${type === 'info' ? '' : type}`;
  if (toast._timer) clearTimeout(toast._timer);
  if (duration > 0) {
    toast._timer = setTimeout(() => { el.toast.className = 'toast'; }, duration);
  }
}

/** 设置底部麦克风上方的提示文字 */
function setHint(text) { el.micHint.textContent = text; }

/** 更新顶部状态胶囊（后端连通性 / API Key / edge-tts 情况） */
function setStatus(text, level = '') {
  el.statusText.textContent = text;
  el.statusPill.className = `status-pill ${level}`;
}

/** 统一控制按钮可用状态，避免思考/朗读期间重复触发 */
function refreshButtons() {
  const canClick = !state.busy;
  el.micBtn.disabled = !canClick;
  el.sendBtn.disabled = !canClick;
}


/* --------------------------------------------------------------------------
 * 三、remember() —— 对话记忆管理
 * ------------------------------------------------------------------------ */

/**
 * remember() —— 记录一轮问答，并裁剪掉超出容量的旧记忆。
 *
 * 只保留最近 MAX_HISTORY_TURNS 轮（10 问 10 答），
 * 这样上下文不会无限膨胀，token 消耗可控，也不会聊到后面跑题。
 *
 * 单独传 userMessage 或 aiMessage 都可以（传 null 表示这轮还没有对应内容）。
 *
 * @param {string|null} userMessage 用户说的话
 * @param {string|null} aiMessage   助手的回答
 * @returns {Array} 裁剪后的 messages 数组
 */
function remember(userMessage, aiMessage) {
  if (userMessage && String(userMessage).trim()) {
    state.messages.push({ role: 'user', content: String(userMessage).trim() });
  }
  if (aiMessage && String(aiMessage).trim()) {
    state.messages.push({ role: 'assistant', content: String(aiMessage).trim() });
  }

  // 超容量就把最早的那几条丢掉（slice 负数取尾部）
  const maxItems = MAX_HISTORY_TURNS * 2;
  if (state.messages.length > maxItems) {
    state.messages = state.messages.slice(-maxItems);
  }

  updateMemoryBadge();
  return state.messages;
}

/** forgetAll() —— 清空全部记忆，重新开始一段对话 */
function forgetAll() {
  state.messages = [];
  updateMemoryBadge();
  return state.messages;
}

/** 刷新界面上的记忆容量角标 */
function updateMemoryBadge() {
  const turns = Math.floor(state.messages.length / 2);
  el.memoryBadge.textContent = `记忆 ${turns}/${MAX_HISTORY_TURNS} 轮`;
}

/**
 * clearConversation() —— 清空记忆 + 清空界面，回到初始状态。
 */
function clearConversation() {
  stopSpeaking();
  forgetAll();
  el.chatLog.innerHTML = emptyTipHTML;
  el.emptyTip = $('emptyTip');     // innerHTML 重建后要重新抓引用
  toast('对话已清空', 'ok', 1800);
}


/* --------------------------------------------------------------------------
 * 四、speak() 家族 —— 语音合成
 * ------------------------------------------------------------------------ */

/** stopSpeaking() —— 停止当前所有正在播放的语音（浏览器 TTS + edge 音频） */
function stopSpeaking() {
  if (ttsSupported) window.speechSynthesis.cancel();
  // 音频必须显式"结束"，否则 speak_with_edge_tts 的 Promise 不会 resolve，
  // 上层的 state.busy 就会一直卡在 true，界面彻底锁死。
  if (typeof state.stopAudio === 'function') {
    state.stopAudio();
    state.stopAudio = null;
  }
}

/**
 * 从浏览器音色列表里挑一个最适合中文的音色。
 * 优先级：用户手动选的 > 名称含中文语音标识的 > 默认音色。
 * @returns {SpeechSynthesisVoice|null}
 */
function pickBrowserVoice() {
  const voices = state.browserVoices;
  if (!voices.length) return null;

  if (state.browserVoiceName) {
    const chosen = voices.find(v => v.name === state.browserVoiceName);
    if (chosen) return chosen;
  }

  const zhVoices = voices.filter(v => /^zh/i.test(v.lang));
  if (zhVoices.length) {
    return (
      zhVoices.find(v => /Xiaoxiao|Yaoyao|Huihui|Tingting|Mei|Female|女/i.test(v.name)) ||
      zhVoices.find(v => v.localService) ||
      zhVoices[0]
    );
  }
  return voices.find(v => v.default) || voices[0];
}

/** 读取系统音色列表（部分浏览器是异步加载的，需要监听 onvoiceschanged） */
function loadBrowserVoices() {
  if (!ttsSupported) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) {
    state.browserVoices = voices;
    if (state.engine === 'browser') refreshVoiceOptions();
  }
}

/**
 * refreshVoiceOptions() —— 按当前引擎渲染音色下拉框。
 * edge 模式显示 edge-tts 音色；browser 模式显示系统音色。
 * 两种模式各自记住自己的选择，来回切换不会丢。
 */
function refreshVoiceOptions() {
  el.voiceSelect.innerHTML = '';

  if (state.engine === 'edge') {
    const list = state.edgeVoices.length ? state.edgeVoices : FALLBACK_EDGE_VOICES;
    list.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.label || v.name;
      el.voiceSelect.appendChild(opt);
    });
    const want = state.edgeVoiceName || (list[0] && list[0].name) || '';
    el.voiceSelect.value = want;
    state.edgeVoiceName = el.voiceSelect.value;
    el.voiceSelect.disabled = false;
    return;
  }

  // ---- 浏览器音色 ----
  const voices = state.browserVoices;
  if (!voices.length) {
    el.voiceSelect.innerHTML = '<option value="">系统暂无可用音色</option>';
    el.voiceSelect.disabled = true;
    return;
  }

  // 中文音色排前面，方便找
  [...voices]
    .sort((a, b) => {
      const az = /^zh/i.test(a.lang) ? 0 : 1;
      const bz = /^zh/i.test(b.lang) ? 0 : 1;
      return az - bz || a.name.localeCompare(b.name);
    })
    .forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      el.voiceSelect.appendChild(opt);
    });

  const auto = pickBrowserVoice();
  if (auto) {
    el.voiceSelect.value = auto.name;
    state.browserVoiceName = auto.name;
  }
  el.voiceSelect.disabled = false;
}

/**
 * speak_with_edge_tts() —— 调后端 /api/tts，拿回 mp3 并用 <audio> 播放。
 *
 * 任何失败（断网、后端没装 edge-tts、音色名错误、浏览器拦截自动播放）
 * 都会 reject，由 speak() 捕获后降级到 speak_fallback()。
 *
 * @param {string} text       要朗读的文本
 * @param {string} voiceName  edge-tts 音色名，如 'zh-CN-XiaoxiaoNeural'
 * @returns {Promise<'edge'>} 播放完成后 resolve
 */
async function speak_with_edge_tts(text, voiceName) {
  const resp = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text, voice: voiceName }),
  });

  // 后端失败时返回 503 + JSON；如果回来不是音频，一律视为失败
  const contentType = resp.headers.get('Content-Type') || '';
  if (!resp.ok || !contentType.includes('audio')) {
    let msg = `edge-tts 合成失败（HTTP ${resp.status}）`;
    try {
      const data = await resp.json();
      if (data && data.error) msg = data.error;
    } catch (e) { /* 返回体不是 JSON，就用默认提示 */ }
    throw new Error(msg);
  }

  const blob = await resp.blob();
  if (!blob.size) throw new Error('edge-tts 返回了空音频');

  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const audio = new Audio(objectUrl);
    let settled = false;

    // 无论正常结束、播放出错还是被中途打断，都必须收尾：
    // 释放 blob URL、清掉中断句柄、让 Promise 落地。
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      if (state.stopAudio === stopThis) state.stopAudio = null;
    };
    const ok = () => { if (settled) return; settled = true; cleanup(); resolve('edge'); };
    const fail = (err) => { if (settled) return; settled = true; cleanup(); reject(err); };
    const stopThis = () => { try { audio.pause(); } catch (e) {} ok(); };

    audio.onended = ok;
    audio.onerror = () => fail(new Error('音频解码或播放失败'));
    state.stopAudio = stopThis;

    audio.play().catch(err => fail(new Error(`无法播放音频：${err.message}`)));
  });
}

/**
 * speak_fallback() —— 浏览器自带 speechSynthesis 朗读（保底方案）。
 *
 * 不依赖任何外部服务，断网也能用。返回 Promise，
 * 并且带一个保险定时器：即使某些浏览器 cancel 后不触发 onend，
 * 也不会让上层的 await 永远挂住。
 *
 * @param {string} text 要朗读的文本
 * @returns {Promise<'browser'|'none'>}
 */
function speak_fallback(text) {
  return new Promise((resolve) => {
    if (!ttsSupported || !text || !text.trim()) return resolve('none');

    // 先清掉上一段没播完的语音，避免叠加
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickBrowserVoice();
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang || 'zh-CN';
    } else {
      utter.lang = 'zh-CN';
    }
    utter.rate = 1.05;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    let settled = false;
    let watchdog = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      resolve('browser');
    };

    utter.onend = finish;
    utter.onerror = finish;

    // 保险丝：按字数粗估最长播放时间，超时就当读完了，避免死等
    watchdog = setTimeout(finish, Math.max(5000, text.length * 320 + 4000));

    window.speechSynthesis.speak(utter);
  });
}

/**
 * speak() —— 朗读编排函数，前端只需要调它。
 *
 * 策略：edge-tts 优先（音色自然得多），一旦失败就自动降级到
 * 浏览器 speechSynthesis，并且把引擎开关切到 browser，避免每次
 * 都白等一次超时。
 *
 * @param {string} text 要朗读的文本
 * @returns {Promise<void>}
 */
async function speak(text) {
  if (!text || !text.trim()) return;
  if (!el.autoSpeak.checked) return;

  if (state.engine === 'edge' && state.edgeAvailable !== false) {
    try {
      setHint('正在生成语音…');
      await speak_with_edge_tts(text, state.edgeVoiceName);
      setHint('点击麦克风开始说话');
      return;
    } catch (err) {
      // ---- 降级分支 ----
      state.edgeAvailable = false;
      state.engine = 'browser';
      el.engineSelect.value = 'browser';
      refreshVoiceOptions();
      setStatus('已降级为浏览器朗读', 'warn');
      toast(`edge-tts 不可用，已自动降级：${err.message}`, 'error', 5000);
    }
  }

  await speak_fallback(text);
}


/* --------------------------------------------------------------------------
 * 五、think() —— 调用后端 Agent 接口（函数名与调用方式保持不变）
 * ------------------------------------------------------------------------ */

/**
 * think() —— 把用户输入的文字发送给后端，拿回回答。
 *
 * Agent 化之后这里改走 /api/agent：后端会用 Function Calling 让模型
 * 自己决定要不要调 search_knowledge_base 查资料，并把完整的决策过程
 * （trace）一起带回来，前端据此展示「AI 到底调没调用工具」。
 *
 * 记忆升级：把 remember() 维护的 messages 作为 history 一起传过去。
 *
 * @param {string} text 用户说的话（或打字输入的内容）
 * @returns {Promise<object>} {ok, reply, error, elapsed, used_tools, tool_names, sources, trace, ...}
 */
async function think(text) {
  // —— 演示模式：不请求后端，改由页面内的检索引擎生成回答 ——
  const r = localAnswer(text);
  const elapsed = ((performance.now() - r.t0) / 1000).toFixed(2);

  const trace = [];
  if (!r.used) {
    // 寒暄类：不需要查资料
    trace.push({ type: 'decision', round: 1, calls: [] });
    trace.push({ type: 'final', round: 1 });
  } else if (r.hits.length) {
    trace.push({
      type: 'decision', round: 1,
      calls: [{ name: 'search_knowledge_base', arguments: { query: text } }]
    });
    trace.push({ type: 'tool_result', found: true, count: r.hits.length, sources: r.sources });
    trace.push({ type: 'final', round: 1 });
  } else {
    trace.push({
      type: 'decision', round: 1,
      calls: [{ name: 'search_knowledge_base', arguments: { query: text } }]
    });
    trace.push({ type: 'tool_result', found: false, message: '知识库中没有匹配内容' });
    trace.push({ type: 'final', round: 1 });
  }

  return {
    ok: true,
    reply: r.reply,
    elapsed: elapsed,
    used_tools: !!r.used,
    tool_names: r.hits.length ? ['search_knowledge_base'] : [],
    sources: r.sources || [],
    trace: trace,
  };
}


/* --------------------------------------------------------------------------
 * 六、listen() —— 麦克风录音 + 语音识别（架构保持不变）
 * ------------------------------------------------------------------------ */

/** 语音识别实例（惰性创建，全局复用一个即可） */
let recognizer = null;

/**
 * 创建并配置 SpeechRecognition 实例。
 * 只在第一次调用时真正创建，后续复用。
 * @returns {SpeechRecognition|null}
 */
function createRecognizer() {
  if (!SpeechRecognitionCtor) return null;
  if (recognizer) return recognizer;

  const rec = new SpeechRecognitionCtor();
  rec.lang = 'zh-CN';           // 识别中文
  rec.continuous = false;       // 说一句话自动结束，适合对话式交互
  rec.interimResults = true;    // 边说边显示中间结果，反馈更自然
  rec.maxAlternatives = 1;

  // --- 开始录音 ---
  rec.onstart = () => {
    state.recognizing = true;
    el.micBtn.classList.add('recording');
    el.interim.hidden = false;
    el.interimText.textContent = '请开始说话…';
    setHint('正在聆听，说完会自动结束');
  };

  // --- 识别过程中的中间结果 / 最终结果 ---
  rec.onresult = (event) => {
    let interim = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }

    // 实时回显
    el.interim.hidden = false;
    el.interimText.textContent = finalText || interim || '…';

    // 拿到最终结果 → 走「思考 → 记忆 → 朗读」流程
    if (finalText.trim()) {
      handleUserInput(finalText.trim());
    }
  };

  // --- 出错 ---
  rec.onerror = (event) => {
    const messages = {
      'not-allowed':         '麦克风权限被拒绝，请在浏览器地址栏允许麦克风访问。',
      'service-not-allowed': '浏览器语音识别服务不可用，请改用 Chrome / Edge，或用下方输入框提问。',
      'no-speech':           '没有听到声音，请再说一次。',
      'audio-capture':       '没有检测到麦克风设备，请检查设备连接。',
      'network':             '语音识别需要联网，请检查网络连接。',
      'aborted':             '',   // 用户主动停止，不算错误
    };
    const msg = messages[event.error];
    if (msg) toast(msg, 'error');
    else if (event.error !== 'aborted') toast(`语音识别出错：${event.error}`, 'error');
  };

  // --- 结束（正常结束 / 出错 / 手动停止都会走到这里）---
  rec.onend = () => {
    state.recognizing = false;
    el.micBtn.classList.remove('recording');
    el.interim.hidden = true;
    el.interimText.textContent = '';
    if (!state.busy) setHint('点击麦克风开始说话');
    refreshButtons();
  };

  recognizer = rec;
  return rec;
}

/**
 * listen() —— 开始或停止录音。
 *
 * 交互设计：点一下开始录音，再点一下提前结束；
 *          正常情况下说完一句话会自动结束并触发识别结果。
 *
 * @returns {boolean} 调用后是否处于录音状态
 */
function listen() {
  if (!SpeechRecognitionCtor) {
    toast('当前浏览器不支持语音识别，请使用 Chrome / Edge，或在下方输入框提问。', 'error', 5000);
    return false;
  }

  const rec = createRecognizer();

  // 正在录音 → 这次点击表示「停止」
  if (state.recognizing) {
    try { rec.stop(); } catch (e) { /* 忽略重复 stop 的异常 */ }
    return false;
  }

  // 正在等待回答 → 不允许开始新录音
  if (state.busy) {
    toast('正在思考中，请稍候…', 'info', 1500);
    return false;
  }

  // 如果上一段语音还在播放，先打断它
  stopSpeaking();

  try {
    rec.start();
    return true;
  } catch (e) {
    // 极少数情况下会抛 InvalidStateError，稍等重试即可
    toast('录音启动失败，请再点一次。', 'error');
    return false;
  }
}


/* --------------------------------------------------------------------------
 * 七、决策过程展示 + 知识库管理
 * ------------------------------------------------------------------------ */

/**
 * 构造一行决策过程。
 * @param {string} icon 图标
 * @param {string} text 文字
 * @param {string|null} detail 补充细节（如工具参数），会以等宽字体显示
 * @param {string} cls 额外样式类
 * @returns {HTMLElement}
 */
function traceStep(icon, text, detail, cls) {
  const row = document.createElement('div');
  row.className = 'trace-step' + (cls ? ' ' + cls : '');

  const iconEl = document.createElement('span');
  iconEl.className = 'trace-icon';
  iconEl.textContent = icon;

  const textEl = document.createElement('span');
  textEl.className = 'trace-text';
  textEl.textContent = text;

  row.appendChild(iconEl);
  row.appendChild(textEl);

  if (detail) {
    const code = document.createElement('code');
    code.className = 'trace-args';
    code.textContent = detail;
    row.appendChild(code);
  }
  return row;
}

/**
 * renderTrace() —— 把后端返回的 trace 渲染成「决策过程」区块。
 *
 * 这是「让用户看见 AI 到底调没调用工具」的关键：
 * - 调用了工具 → 显示 🔧 调用 + 📚 命中条数/来源
 * - 没调用     → 明确写「判断无需查资料，直接回答」
 * - 查不到     → 显示 🕳️ 没检索到，说明模型必须回答"资料里没有提到"
 *
 * @param {Array} trace 后端 run_agent() 返回的 trace
 * @param {object} data 完整响应，用于取 used_tools / sources 做标题
 * @returns {HTMLElement} 决策过程区块
 */
function renderTrace(trace, data) {
  const box = document.createElement('div');
  box.className = 'trace';

  const title = document.createElement('div');
  title.className = 'trace-title';
  if (data.used_tools) {
    const sources = (data.sources && data.sources.length) ? ` · 来源：${data.sources.join('、')}` : '';
    title.textContent = `🔎 决策过程 · 调用了工具${sources}`;
  } else {
    title.textContent = '🔎 决策过程 · 未调用工具';
  }
  box.appendChild(title);

  (trace || []).forEach(step => {
    if (!step || !step.type) return;

    if (step.type === 'decision') {
      if (!step.calls || !step.calls.length) {
        box.appendChild(traceStep('💭', `第 ${step.round} 轮：判断不需要查资料，直接回答`));
      } else {
        step.calls.forEach(call => {
          const args = JSON.stringify(call.arguments || {});
          box.appendChild(traceStep('🔧', `第 ${step.round} 轮：决定调用 ${call.name}`, args));
        });
      }
      return;
    }

    if (step.type === 'tool_result') {
      if (step.found) {
        const srcs = (step.sources && step.sources.length) ? ` · 来源：${step.sources.join('、')}` : '';
        box.appendChild(traceStep('📚', `检索到 ${step.count} 条资料${srcs}`));
      } else {
        box.appendChild(traceStep('🕳️', `没有检索到相关资料：${step.message || '知识库中没有匹配内容'}`));
      }
      return;
    }

    if (step.type === 'final') {
      box.appendChild(traceStep('✅', `第 ${step.round} 轮：生成回答`, null, 'ok'));
      return;
    }

    if (step.type === 'error') {
      box.appendChild(traceStep('⚠️', step.message || '出现异常'));
    }
  });

  return box;
}

/** 把字节数格式化成可读大小 */
function formatSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 渲染知识库文档列表 */
function renderKnowledgeList() {
  const docs = state.kbDocuments;
  el.kbBadge.textContent = docs.length;
  el.kbList.innerHTML = '';

  if (!docs.length) {
    el.kbEmpty.hidden = false;
    return;
  }
  el.kbEmpty.hidden = true;

  docs.forEach(doc => {
    const item = document.createElement('li');
    item.className = 'kb-item';

    const name = document.createElement('span');
    name.className = 'kb-name';
    name.textContent = doc.name;
    name.title = doc.name;

    const meta = document.createElement('span');
    meta.className = 'kb-meta';
    meta.textContent = `${formatSize(doc.size)} · ${doc.chunks} 段`;

    const del = document.createElement('button');
    del.className = 'kb-del';
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', () => deleteKnowledge(doc.name));

    item.appendChild(name);
    item.appendChild(meta);
    item.appendChild(del);
    el.kbList.appendChild(item);
  });
}

/** loadKnowledgeList() —— 演示模式：直接列出内置资料（不请求后端） */
async function loadKnowledgeList() {
  state.kbDocuments = LOCAL_KB.map(d => ({ name: d.name, size: d.text.length, chunks: chunkDoc(d).length }));
  renderKnowledgeList();
}

/**
 * uploadKnowledge() —— 上传 .md / .txt 到知识库。
 * @param {FileList|Array<File>} fileList 用户选择的文件
 */
async function uploadKnowledge(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  setHint('正在读取资料…');
  try {
    for (const file of files) {
      if (!/\.(md|txt|markdown)$/i.test(file.name)) {
        toast(`${file.name}：只支持 .md / .txt`, 'error', 5000);
        continue;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast(`${file.name}：文件超过 2 MB`, 'error', 5000);
        continue;
      }
      const text = await file.text();
      const exist = LOCAL_KB.findIndex(d => d.name === file.name);
      if (exist > -1) LOCAL_KB.splice(exist, 1, { name: file.name, text: text });
      else LOCAL_KB.push({ name: file.name, text: text });
      rebuildIndex();
      toast(`已加入知识库：${file.name}`, 'ok', 3200);
    }
  } catch (err) {
    toast(`上传失败：${err.message}`, 'error', 5000);
  } finally {
    state.kbDocuments = LOCAL_KB.map(d => ({ name: d.name, size: d.text.length, chunks: chunkDoc(d).length }));
    renderKnowledgeList();
    setHint('点击麦克风开始说话');
    el.kbFile.value = '';
  }
}

/**
 * deleteKnowledge() —— 从知识库删除一个文档。
 * @param {string} name 文件名
 */
async function deleteKnowledge(name) {
  const i = LOCAL_KB.findIndex(d => d.name === name);
  if (i < 0) { toast('没有找到这份资料', 'error'); return; }
  LOCAL_KB.splice(i, 1);
  rebuildIndex();
  state.kbDocuments = LOCAL_KB.map(d => ({ name: d.name, size: d.text.length, chunks: chunkDoc(d).length }));
  renderKnowledgeList();
  toast(`已删除 ${name}`, 'ok', 2000);
}

/** 展收知识库面板 */
function toggleKnowledgePanel() {
  const willShow = el.kbPanel.hidden;
  el.kbPanel.hidden = !willShow;
  el.kbToggle.classList.toggle('active', willShow);
  if (willShow) loadKnowledgeList();
}


/* --------------------------------------------------------------------------
 * 八、主流程编排：把 listen / think / remember / speak 串起来
 * ------------------------------------------------------------------------ */

/**
 * 处理一条用户输入（来自语音识别或文字输入框）。
 * 完整流程：显示问题 → think() → 展示决策过程 → remember() → speak()
 *
 * 注意顺序：think() 要在 remember() 之前调用。
 * 因为后端会把 message 作为最新一条用户消息追加到 history 后面，
 * 如果先把本轮记进记忆再发送，用户这句话就会被重复传两次。
 *
 * @param {string} text 用户输入的文字
 */
async function handleUserInput(text) {
  if (!text || state.busy) return;

  // 1) 把用户的话显示出来
  addMessage(text, 'user');

  // 2) 锁定按钮，显示思考动画
  state.busy = true;
  refreshButtons();
  setHint('正在思考…');
  const bubble = addTypingBubble();

  try {
    // 3) think()：请求后端 Agent（history 里是本轮之前的历史）
    const data = await think(text);

    if (data.ok) {
      bubble.textContent = data.reply;

      // 4) 把决策过程插到回答气泡上方，让人看见工具到底调没调
      if (data.trace && data.trace.length) {
        const body = bubble.parentElement;
        body.insertBefore(renderTrace(data.trace, data), bubble);
      }

      // 5) remember()：这一轮成功后才写入记忆
      remember(text, data.reply);

      const toolInfo = data.used_tools
        ? ` · 用了 ${data.tool_names.join('、')}`
        : ' · 未用工具';
      setStatus(`已连接 · ${data.elapsed}s${toolInfo}`, 'ok');

      // 6) speak()：朗读回答，await 保证读完才解锁
      await speak(data.reply);
    } else {
      markError(bubble, data.error || '抱歉，回答失败了。');
      setStatus('调用失败', 'err');
      toast(data.error || '回答失败', 'error', 5000);
    }
  } catch (err) {
    markError(bubble, `无法连接后端服务：${err.message}`);
    setStatus('服务未连接', 'err');
    toast('连接后端失败，请确认 Flask 服务已启动。', 'error', 5000);
  } finally {
    state.busy = false;
    refreshButtons();
    setHint('点击麦克风开始说话');
    scrollToBottom();
  }
}


/* --------------------------------------------------------------------------
 * 九、初始化：事件绑定 + 启动自检
 * ------------------------------------------------------------------------ */

/** 绑定所有交互事件 */
function bindEvents() {
  // 麦克风按钮
  el.micBtn.addEventListener('click', () => listen());

  // 空格键也能开始/结束录音（输入框聚焦时除外）
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement !== el.textInput) {
      e.preventDefault();
      listen();
    }
  });

  // 文字兜底输入
  el.textForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.textInput.value.trim();
    if (!text) return;
    el.textInput.value = '';
    stopSpeaking();
    handleUserInput(text);
  });

  // 切换朗读引擎
  el.engineSelect.addEventListener('change', () => {
    state.engine = el.engineSelect.value;
    // 手动切回 edge 时清掉之前的失败标记，允许再试一次
    if (state.engine === 'edge') state.edgeAvailable = null;
    refreshVoiceOptions();
    toast(state.engine === 'edge' ? '已切换到 edge-tts 音色' : '已切换到浏览器朗读', 'ok', 1800);
  });

  // 切换音色（两种引擎各自记住自己的选择）
  el.voiceSelect.addEventListener('change', () => {
    const label = el.voiceSelect.selectedOptions[0]
      ? el.voiceSelect.selectedOptions[0].textContent : el.voiceSelect.value;
    if (state.engine === 'edge') {
      state.edgeVoiceName = el.voiceSelect.value;
      state.edgeAvailable = null;   // 换了音色，允许重新尝试 edge-tts
    } else {
      state.browserVoiceName = el.voiceSelect.value;
    }
    toast(`已切换音色：${label}`, 'ok', 1800);
  });

  // 关闭自动朗读时，立刻停掉正在播放的语音
  el.autoSpeak.addEventListener('change', () => {
    if (!el.autoSpeak.checked) stopSpeaking();
  });

  // 显示 / 隐藏决策过程（纯样式开关，不影响逻辑）
  el.showTrace.addEventListener('change', () => {
    document.body.classList.toggle('hide-trace', !el.showTrace.checked);
  });

  // 清空对话 + 清空记忆
  el.clearBtn.addEventListener('click', clearConversation);

  // ---- 知识库 ----
  el.kbToggle.addEventListener('click', toggleKnowledgePanel);

  el.kbFile.addEventListener('change', () => uploadKnowledge(el.kbFile.files));

  // 拖拽上传
  ['dragenter', 'dragover'].forEach(evt => {
    el.kbDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      el.kbDrop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    el.kbDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      el.kbDrop.classList.remove('over');
    });
  });
  el.kbDrop.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) uploadKnowledge(e.dataTransfer.files);
  });

  // 防止把文件拖到面板外时浏览器直接打开它
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // 音色列表在部分浏览器是异步加载的
  if (ttsSupported) {
    loadBrowserVoices();
    window.speechSynthesis.onvoiceschanged = loadBrowserVoices;
  } else {
    el.autoSpeak.disabled = true;
  }

  // 离开页面时停止播放，避免「关不掉」的声音
  window.addEventListener('beforeunload', () => stopSpeaking());
}

/**
 * bootCheck() —— 启动自检：
 *   1. 浏览器能力（语音识别 / 语音合成）
 *   2. 后端连通性、API Key、edge-tts 可用性
 *   3. 拉取 edge-tts 音色清单
 */
async function bootCheck() {
  // --- 浏览器能力检查 ---
  if (!SpeechRecognitionCtor) {
    toast('当前浏览器不支持语音识别，请用 Chrome / Edge 打开，或直接用下方输入框。', 'error', 6000);
  }
  if (!ttsSupported) {
    toast('当前浏览器不支持语音合成，edge-tts 之外的朗读将不可用。', 'error', 6000);
  }

  // --- 演示模式：不连接后端，直接使用浏览器语音 + 页面内检索引擎 ---
  state.edgeAvailable = false;
  state.engine = 'browser';
  el.engineSelect.value = 'browser';
  if (el.engineSelect.options[0]) {
    el.engineSelect.options[0].textContent = 'edge-tts（需后端）';
    el.engineSelect.options[0].disabled = true;
  }
  setStatus('演示模式 · 浏览器朗读 · 本地检索', 'warn');

  refreshVoiceOptions();
  updateMemoryBadge();
  renderKnowledgeList();
  refreshButtons();
}

/* 页面加载完成后启动 */
document.addEventListener('DOMContentLoaded', () => {
  emptyTipHTML = el.chatLog.innerHTML;   // 记下空状态，供"清空对话"还原
  bindEvents();
  loadKnowledgeList();   // 先把知识库文档数显示到顶部角标
  bootCheck();
});
