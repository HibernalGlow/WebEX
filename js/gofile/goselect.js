// ==UserScript==
// @name         Gofile 批量智能选择
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  一键按包含/排除正则选择文件(如选中 *.7z.001~ 等而排除 .par2)。
// @author       you
// @match        https://gofile.io/*
// @match        https://*.gofile.io/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
  'use strict';

  const KEY_INCLUDE = 'gofile_select_include';
  const KEY_EXCLUDE = 'gofile_select_exclude';
  const KEY_CLEAR_FIRST = 'gofile_select_clearfirst';
  const KEY_AUTO_SELECT = 'gofile_select_autoselect';
  const KEY_AUTO_PANEL = 'gofile_select_autopanel';

  // 默认：匹配 .7z.001 / .7z.002 ... 且 3 位数字；排除 .par2
  const defaultInclude = '^.+\\.7z\\.\\d{3}$';
  const defaultExclude = '\\.par2$';

  function getCfg() {
    return {
      include: GM_getValue(KEY_INCLUDE, defaultInclude),
      exclude: GM_getValue(KEY_EXCLUDE, defaultExclude),
      clearFirst: GM_getValue(KEY_CLEAR_FIRST, true),
      autoSelect: GM_getValue(KEY_AUTO_SELECT, false),
      autoPanel: GM_getValue(KEY_AUTO_PANEL, false)
    };
  }
  function setCfg(include, exclude, clearFirst, autoSelect, autoPanel) {
    GM_setValue(KEY_INCLUDE, include);
    GM_setValue(KEY_EXCLUDE, exclude);
    GM_setValue(KEY_CLEAR_FIRST, !!clearFirst);
    GM_setValue(KEY_AUTO_SELECT, !!autoSelect);
    GM_SetValue && GM_SetValue(); // 占位避免静态分析误删（无实际作用）
    GM_setValue(KEY_AUTO_PANEL, !!autoPanel);
  }

  // 可能的文件行选择器（按需增删）
  // 精确匹配文件列表每一行：#filemanager_itemslist > div[data-item-id]
  function collectRows() {
    return Array.from(document.querySelectorAll('#filemanager_itemslist > div[data-item-id]'));
  }

  // 提取文件名：每行里 a.item_open 即文件名链接
  function nameExtractor(row) {
    const a = row.querySelector('a.item_open');
    if (!a) return '';
    return (a.textContent || '').trim();
  }

  function findCheckbox(row) {
    return row.querySelector('input.item_checkbox[type=checkbox]');
  }

  function selectByRegex() {
    const { include, exclude, clearFirst } = getCfg();
    let includeRe, excludeRe;
    try {
      includeRe = new RegExp(include);
    } catch(e) {
      alert('包含正则无效: ' + e.message);
      return;
    }
    try {
      excludeRe = exclude ? new RegExp(exclude) : null;
    } catch(e) {
      alert('排除正则无效: ' + e.message);
      return;
    }

    const rows = collectRows();
    // 执行前清空：避免残留之前选中项
    if (clearFirst) {
      rows.forEach(r => {
        const cb = findCheckbox(r);
        if (cb && cb.checked) cb.click();
      });
    }
    let hit = 0, skipped = 0, excluded = 0;
    rows.forEach(row => {
      const name = nameExtractor(row);
      if (!name) return;
      if (!includeRe.test(name)) { skipped++; return; }
      if (excludeRe && excludeRe.test(name)) { excluded++; return; }
      const cb = findCheckbox(row);
      if (cb) {
        if (!cb.checked) cb.click();
        hit++;
      }
    });
    toast(`选中: ${hit} | 未匹配: ${skipped} | 排除: ${excluded}`);
  }

  // 反选当前所有行（忽略正则）
  function invertSelection() {
    const rows = collectRows();
    let toggled = 0;
    rows.forEach(r => {
      const cb = findCheckbox(r);
      if (cb) { cb.click(); toggled++; }
    });
    toast(`反转 ${toggled} 项`);
  }

  // 清空选中
  function clearSelection() {
    const rows = collectRows();
    let cleared = 0;
    rows.forEach(r => {
      const cb = findCheckbox(r);
      if (cb && cb.checked) { cb.click(); cleared++; }
    });
    toast(`已清空 ${cleared} 项`);
  }

  // 简易浮动面板
  function buildPanel() {
    if (document.getElementById('gofile-select-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'gofile-select-panel';
    panel.style.cssText = `
      position:fixed; top:80px; right:16px; z-index:999999;
      background:#1e1e2f; color:#fff; font:12px/1.4 sans-serif;
      border:1px solid #444; padding:10px 12px; border-radius:8px;
      width:240px; box-shadow:0 4px 12px rgba(0,0,0,.4);
    `;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="font-size:13px;">批量智能选择</strong>
        <button id="gofile-select-close" style="background:#333;color:#ccc;border:0;border-radius:4px;cursor:pointer;padding:0 6px;">×</button>
      </div>
      <label style="display:block;margin:4px 0 2px;">包含正则</label>
      <input id="gofile-include" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid #555;background:#222;color:#eee;font-size:12px;">
      <label style="display:block;margin:6px 0 2px;">排除正则(可空)</label>
      <input id="gofile-exclude" style="width:100%;box-sizing:border-box;padding:4px;border:1px solid #555;background:#222;color:#eee;font-size:12px;">
      <label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;">
        <input id="gofile-clearfirst" type="checkbox" style="margin:0;"> 执行前清空已有选择
      </label>
      <label style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;">
        <input id="gofile-autoselect" type="checkbox" style="margin:0;"> 加载后自动执行选择
      </label>
      <label style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;">
        <input id="gofile-autopanel" type="checkbox" style="margin:0;"> 加载后自动展开面板
      </label>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
        <button id="gofile-run" style="flex:1;background:#2d7cff;border:0;color:#fff;padding:6px 0;border-radius:4px;cursor:pointer;font-size:12px;">执行</button>
        <button id="gofile-save" style="flex:1;background:#3a3a3a;border:0;color:#fff;padding:6px 0;border-radius:4px;cursor:pointer;font-size:12px;">保存</button>
      </div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
        <button id="gofile-preset-7z" style="flex:1;background:#444;border:0;color:#ddd;padding:4px 0;border-radius:4px;cursor:pointer;font-size:11px;">7z分卷</button>
        <button id="gofile-preset-rar" style="flex:1;background:#444;border:0;color:#ddd;padding:4px 0;border-radius:4px;cursor:pointer;font-size:11px;">rar分卷</button>
        <button id="gofile-invert" style="flex:1;background:#555;border:0;color:#ddd;padding:4px 0;border-radius:4px;cursor:pointer;font-size:11px;">反选</button>
        <button id="gofile-clear" style="flex:1;background:#555;border:0;color:#ddd;padding:4px 0;border-radius:4px;cursor:pointer;font-size:11px;">清空</button>
      </div>
      <div style="margin-top:4px;font-size:11px;color:#aaa;">支持标准 JS 正则(无需 / / )</div>
    `;
    document.body.appendChild(panel);

    const cfg = getCfg();
    panel.querySelector('#gofile-include').value = cfg.include;
    panel.querySelector('#gofile-exclude').value = cfg.exclude;
    panel.querySelector('#gofile-clearfirst').checked = cfg.clearFirst;
  panel.querySelector('#gofile-autoselect').checked = cfg.autoSelect;
  panel.querySelector('#gofile-autopanel').checked = cfg.autoPanel;

    panel.querySelector('#gofile-select-close').onclick = () => panel.remove();
    panel.querySelector('#gofile-run').onclick = () => {
      // 临时使用当前输入（保存到内存以便函数读取）
      GM_setValue(KEY_INCLUDE, panel.querySelector('#gofile-include').value);
      GM_setValue(KEY_EXCLUDE, panel.querySelector('#gofile-exclude').value);
      GM_setValue(KEY_CLEAR_FIRST, panel.querySelector('#gofile-clearfirst').checked);
      GM_setValue(KEY_AUTO_SELECT, panel.querySelector('#gofile-autoselect').checked);
      GM_setValue(KEY_AUTO_PANEL, panel.querySelector('#gofile-autopanel').checked);
      selectByRegex();
    };
    panel.querySelector('#gofile-save').onclick = () => {
      setCfg(
        panel.querySelector('#gofile-include').value.trim(),
        panel.querySelector('#gofile-exclude').value.trim(),
        panel.querySelector('#gofile-clearfirst').checked,
        panel.querySelector('#gofile-autoselect').checked,
        panel.querySelector('#gofile-autopanel').checked
      );
      toast('已保存');
    };
    panel.querySelector('#gofile-preset-7z').onclick = () => {
      panel.querySelector('#gofile-include').value = '^.+\\.7z\\.\\d{3}$';
      panel.querySelector('#gofile-exclude').value = '\\.par2$';
    };
    panel.querySelector('#gofile-preset-rar').onclick = () => {
      panel.querySelector('#gofile-include').value = '^.+\\.part\\d+\\.rar$';
      panel.querySelector('#gofile-exclude').value = '\\.par2$';
    };
    panel.querySelector('#gofile-invert').onclick = invertSelection;
    panel.querySelector('#gofile-clear').onclick = clearSelection;
  }

  function toast(msg, ms=2500) {
    let box = document.createElement('div');
    box.textContent = msg;
    box.style.cssText = `
      position:fixed; top:20px; right:20px; z-index:1000000;
      background:rgba(0,0,0,.85); color:#fff; padding:8px 14px;
      border-radius:6px; font-size:13px; box-shadow:0 4px 10px rgba(0,0,0,.3);
      opacity:0; transition:opacity .25s;
    `;
    document.body.appendChild(box);
    requestAnimationFrame(()=> box.style.opacity = '1');
    setTimeout(()=> {
      box.style.opacity = '0';
      setTimeout(()=> box.remove(), 300);
    }, ms);
  }

  // 快捷按钮
  function injectQuickButton() {
    if (document.getElementById('gofile-quick-select-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'gofile-quick-select-btn';
    btn.textContent = '过滤选择';
    btn.style.cssText = `
      position:fixed; top:40px; right:16px; z-index:999998;
      background:#2d7cff; color:#fff; border:0; padding:8px 14px;
      border-radius:20px; cursor:pointer; font-size:13px;
      box-shadow:0 4px 10px rgba(0,0,0,.3);
    `;
    btn.onclick = buildPanel;
    document.body.appendChild(btn);
  }

  // 菜单
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('打开批量智能选择面板', buildPanel);
    GM_registerMenuCommand('按规则选择 (当前)', selectByRegex);
    GM_registerMenuCommand('反选当前列表', invertSelection);
    GM_registerMenuCommand('清空当前选择', clearSelection);
    GM_registerMenuCommand('重置为默认规则', () => {
  setCfg(defaultInclude, defaultExclude, true, false, false);
      toast('已重置');
    });
  }

  // 监听页面可能异步渲染
  let autoSelectDone = false;
  const obs = new MutationObserver(() => {
    injectQuickButton();
    const cfg = getCfg();
    if (cfg.autoPanel && !document.getElementById('gofile-select-panel')) {
      buildPanel();
    }
    // 当文件行出现才执行自动选择（仅一次）
    if (cfg.autoSelect && !autoSelectDone) {
      if (document.querySelector('#filemanager_itemslist > div[data-item-id]')) {
        autoSelectDone = true;
        // 微任务后执行，确保面板渲染完毕
        setTimeout(selectByRegex, 50);
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  injectQuickButton();
  // 初始立即尝试自动展开面板（防止 MutationObserver 不触发的极端情况）
  const initCfg = getCfg();
  if (initCfg.autoPanel) {
    setTimeout(buildPanel, 10);
  }
})();