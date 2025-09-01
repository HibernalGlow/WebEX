// ==UserScript==
// @name         Gemini 自动“继续”发送（强力版）
// @namespace    https://hibernalglow.example
// @version      0.6
// @description  当 Gemini 可以发送下一条消息时，自动填入指定指令（默认“继续”）并发送；深度查询、回退热键、更稳健。
// @author       you
// @match        https://gemini.google.com/*
// @match        https://bard.google.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_TEXT = '继续';
  let auto = GM_getValue('auto', true);
  let text = GM_getValue('text', DEFAULT_TEXT);
  let intervalMs = GM_getValue('interval', 600); // 发送前小延迟
  let maxRuns = GM_getValue('maxRuns', 0); // 0=无限
  let runs = 0;
  let busy = false;
  let lastAction = 0;

  const log = (...a) => console.debug('[GeminiAuto]', ...a);

  const escapeHtml = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  // 统一的深度查询（穿透开放的 Shadow DOM）
  function qsaDeep(selector, root = document) {
    const out = [];
    const stack = [root];
    const pushAll = (nodeList) => nodeList && nodeList.forEach ? nodeList.forEach(n => out.push(n)) : out.push(...nodeList);
    while (stack.length) {
      const node = stack.pop();
      try {
        const found = node.querySelectorAll ? node.querySelectorAll(selector) : [];
        pushAll(found);
      } catch (_) { /* ignore invalid selector for this root */ }
      // 遍历子节点
      const children = (node.children || []);
      for (const c of children) {
        // 若有 shadowRoot，入栈
        if (c.shadowRoot) stack.push(c.shadowRoot);
        stack.push(c);
      }
      // 若是 ShadowRoot，自身也可能含有子 shadow（嵌套组件）在 children 中处理
    }
    return out;
  }

  function qsFirstDeep(selectors) {
    for (const sel of selectors) {
      const found = qsaDeep(sel);
      const el = found.find(isVisible);
      if (el) return el;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.();
    const style = window.getComputedStyle?.(el);
    const visible = !!rect && rect.width > 0 && rect.height > 0 && style && style.visibility !== 'hidden' && style.display !== 'none';
    return visible;
  }

  const SELECTORS = {
    sendButtons: [
      'button.submit:not([aria-disabled="true"])',
      'button[aria-label*="发送"]:not([aria-disabled="true"])',
      'button[aria-label*="Send"]:not([aria-disabled="true"])',
      'button.mdc-icon-button:not([aria-disabled="true"])',
      'button[mat-icon-button]:not([aria-disabled="true"])',
      'button[role="button"]:not([aria-disabled="true"])'
    ],
    sendIcons: [
      'mat-icon[data-mat-icon-name="send"]',
      'mat-icon[fonticon="send"]',
      '.mat-icon[fonticon="send"]',
      '.google-symbols.send-button-icon',
    ],
    editors: [
      'rich-textarea .ql-editor.textarea.new-input-ui[contenteditable="true"]',
      '.ql-editor.textarea[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="输入"]',
      'div[contenteditable="true"][aria-label*="Ask"]',
      'textarea[placeholder], textarea[aria-label]'
    ],
  };

  // ============== 浮动控制面板（Shadow DOM） ==============
  let panelRoot = null;
  let ui = { toggleBtn: null, tryBtn: null, status: null };

  function buildPanelStyle() {
    return `
      :host { all: initial; }
      .wrap { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; position: fixed; z-index: 9999999; right: 16px; bottom: 16px; }
      .box { background: rgba(28,28,30,0.92); color: #fff; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; box-shadow: 0 6px 18px rgba(0,0,0,0.3); padding: 10px 12px; min-width: 240px; backdrop-filter: saturate(150%) blur(4px); }
      .row { display: flex; align-items: center; gap: 8px; }
      .row + .row { margin-top: 8px; }
      button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.06); color: #fff; font-size: 12px; }
      button:hover { background: rgba(255,255,255,0.12); }
      .pill { padding: 2px 8px; border-radius: 999px; font-size: 12px; border: 1px solid rgba(255,255,255,0.2); }
      .ok { color: #0f0; border-color: rgba(0,255,0,0.35); }
      .warn { color: #ffcc00; border-color: rgba(255,204,0,0.35); }
      .bad { color: #ff6b6b; border-color: rgba(255,107,107,0.35); }
      .muted { color: #cfcfcf; opacity: 0.9; }
      .status { font-size: 12px; line-height: 1.4; white-space: pre-line; }
      .drag { cursor: move; user-select: none; font-weight: 600; letter-spacing: .2px; }
    `;
  }

  function ensurePanel() {
    if (panelRoot) return panelRoot;
    const host = document.createElement('div');
    host.id = 'gemini-auto-panel-host';
    // 放在最外层，尽量不被容器裁剪
    (document.documentElement || document.body).appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = buildPanelStyle();
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="box">
        <div class="row drag">Gemini Auto</div>
        <div class="row">
          <button id="toggle"></button>
          <button id="try">立即尝试</button>
          <span id="detected" class="pill muted">BTN: -</span>
          <span id="enabled" class="pill muted">READY: -</span>
        </div>
        <div id="status" class="row status muted"></div>
      </div>`;
    shadow.appendChild(style);
    shadow.appendChild(wrap);

    // 简易拖动
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx; const dy = e.clientY - sy;
      wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
      wrap.style.left = `${ox + dx}px`; wrap.style.top = `${oy + dy}px`;
    };
    shadow.addEventListener('mousedown', (e) => {
      const target = e.composedPath()[0];
      if (!(target && target.classList && target.classList.contains('drag'))) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const rect = wrap.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', () => { dragging = false; window.removeEventListener('mousemove', onMove); }, { once: true });
    });

    ui.toggleBtn = shadow.getElementById('toggle');
    ui.tryBtn = shadow.getElementById('try');
    ui.status = shadow.getElementById('status');
    ui.detected = shadow.getElementById('detected');
    ui.enabled = shadow.getElementById('enabled');

    ui.toggleBtn.addEventListener('click', () => { auto = !auto; GM_setValue('auto', auto); updatePanel(); });
    ui.tryBtn.addEventListener('click', () => { trySend(); });

    panelRoot = shadow;
    updatePanel();
    return panelRoot;
  }

  function setPill(el, ok, label) {
    if (!el) return;
    el.textContent = label;
    el.classList.remove('ok', 'bad', 'warn', 'muted');
    el.classList.add(ok === null ? 'muted' : ok ? 'ok' : 'bad');
  }

  function updatePanel() {
    if (!panelRoot) return;
    const detected = isSendButtonDetected();
    const enabled = !!getSendButtonEnabled();
    ui.toggleBtn.textContent = `自动：${auto ? '开' : '关'}`;
    setPill(ui.detected, detected, `BTN: ${detected ? 'Y' : 'N'}`);
    setPill(ui.enabled, enabled, `READY: ${enabled ? 'Y' : 'N'}`);
    const lines = [
      `Busy: ${busy ? 'Y' : 'N'} | Runs: ${runs}`,
      `Text: ${text || '(空)'}`,
    ];
    ui.status.textContent = lines.join('\n');
  }

  function isSendButtonDetected() {
    // 放宽条件，只要找到可见的“形似发送”的按钮或图标即算检测到
    for (const sel of SELECTORS.sendButtons) {
      const candidates = qsaDeep(sel).filter(isVisible);
      if (candidates.length) return true;
    }
    for (const sel of SELECTORS.sendIcons) {
      const icons = qsaDeep(sel).filter(isVisible);
      if (icons.length) return true;
    }
    return false;
  }

  function getSendButtonEnabled() {
    // 1) 直接找可点按钮
    for (const sel of SELECTORS.sendButtons) {
      const candidates = qsaDeep(sel).filter(isVisible);
      const btn = candidates.find(b => (b.getAttribute('aria-disabled') !== 'true') && !b.disabled);
      if (btn) return btn;
    }
    // 2) 通过 send 图标向上找按钮
    for (const sel of SELECTORS.sendIcons) {
      const icons = qsaDeep(sel).filter(isVisible);
      for (const ic of icons) {
        const b = ic.closest('button');
        if (b && isVisible(b) && b.getAttribute('aria-disabled') !== 'true' && !b.disabled) return b;
      }
    }
    return null;
  }

  function getEditor() {
    // 兼容多版本编辑器，优先可见的 contenteditable，再回退 textarea
    const el = qsFirstDeep(SELECTORS.editors);
    return el || null;
  }

  function editorIsEmpty(ed) {
    if (!ed) return true;
    if ('value' in ed) return String(ed.value || '').trim().length === 0; // textarea/input
    const text = ed.innerText ?? ed.textContent ?? '';
    return String(text).trim().length === 0;
  }

  function setEditorText(t) {
    const ed = getEditor();
    if (!ed) return false;
    if (!editorIsEmpty(ed)) return false; // 避免覆盖用户手动输入
    ed.focus();
    // contenteditable
    if (ed.isContentEditable) {
      ed.innerHTML = `<p>${escapeHtml(t)}</p>`;
    } else if ('value' in ed) {
      ed.value = t;
    }
    try {
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: t, inputType: 'insertText' }));
    } catch {
      ed.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    return true;
  }

  function canSend() {
    return !!getSendButtonEnabled();
  }

  function pressEnterFallback() {
    const ed = getEditor();
    if (!ed) return false;
    ed.focus();
    const events = ['keydown', 'keypress', 'keyup'];
    for (const type of events) {
      const e = new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true
      });
      ed.dispatchEvent(e);
    }
    return true;
  }

  function clickSend() {
    const btn = getSendButtonEnabled();
    if (btn) { btn.click(); return true; }
    // 回退：尝试回车提交
    return pressEnterFallback();
  }

  function waitForSendCycle() {
    // 等待按钮经历“禁用->再启用”，视为一轮发送结束
    return new Promise(resolve => {
      let stage = 0; // 0: 等待禁用; 1: 等待再次启用
      const obs = new MutationObserver(() => {
        const enabled = !!getSendButtonEnabled();
        if (stage === 0 && !enabled) {
          stage = 1;
        } else if (stage === 1 && enabled) {
          obs.disconnect();
          resolve();
        }
      });
      obs.observe(document.body, { subtree: true, attributes: true, childList: true });
      // 兜底超时
      setTimeout(() => { try { obs.disconnect(); } catch {} resolve(); }, 180000);
    });
  }

  function trySend() {
    if (!auto) return;
    if (maxRuns > 0 && runs >= maxRuns) return;
    if (busy) return;
    if (!canSend()) return;
  // 节流，避免短时间重复触发
  const now = Date.now();
  if (now - lastAction < Math.max(300, intervalMs)) return;

    busy = true;
  lastAction = now;
    if (!setEditorText(text)) { busy = false; return; }

    setTimeout(() => {
      if (clickSend()) {
        runs++;
    waitForSendCycle().finally(() => { busy = false; updatePanel(); });
      } else {
    busy = false; updatePanel();
      }
    }, intervalMs);
  updatePanel();
  }

  // DOM 变化监听：按钮状态变化即尝试发送
  const domObs = new MutationObserver(() => { trySend(); updatePanel(); });
  domObs.observe(document.documentElement, { subtree: true, childList: true, attributes: true });

  // 轮询兜底（UI 不触发属性变化时依旧可尝试）
  const poller = setInterval(() => { trySend(); updatePanel(); }, 1000);

  // 可见性/焦点变化时也尝试一次
  window.addEventListener('focus', trySend);
  document.addEventListener('visibilitychange', trySend);
  window.addEventListener('focus', updatePanel);
  document.addEventListener('visibilitychange', updatePanel);

  // 快捷键：Alt+Shift+A 开关自动；Alt+Shift+S 立即尝试一次
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyA') {
      auto = !auto; GM_setValue('auto', auto);
      alert('自动发送已' + (auto ? '开启' : '关闭'));
    } else if (e.altKey && e.shiftKey && e.code === 'KeyS') {
      trySend();
    }
  });

  // 菜单配置
  GM_registerMenuCommand(`自动发送：${auto ? '开' : '关'}`, () => {
    auto = !auto; GM_setValue('auto', auto);
  try { alert('自动发送已' + (auto ? '开启' : '关闭')); } catch {}
  updatePanel();
  });

  GM_registerMenuCommand('设置指令文本', () => {
    const v = prompt('请输入要自动发送的指令文本', text);
    if (v !== null) { text = v; GM_setValue('text', text); runs = 0; }
  updatePanel();
  });

  GM_registerMenuCommand('设置发送前等待毫秒', () => {
    const v = prompt('请输入发送前等待的毫秒数', String(intervalMs));
    const n = Number(v);
    if (!Number.isNaN(n) && n >= 0) { intervalMs = n; GM_setValue('interval', n); }
  updatePanel();
  });

  GM_registerMenuCommand('设置最大自动发送次数（0=无限）', () => {
    const v = prompt('请输入最大自动发送次数（0为无限）', String(maxRuns));
    const n = Number(v);
    if (!Number.isNaN(n) && n >= 0) { maxRuns = n; GM_setValue('maxRuns', n); runs = 0; }
  updatePanel();
  });

  // 首次延时尝试与面板初始化
  const ready = () => { try { ensurePanel(); } catch {} trySend(); updatePanel(); };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();