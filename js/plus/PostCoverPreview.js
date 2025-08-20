// ==UserScript==
// @name         PostCoverPreview
// @namespace    http://tampermonkey.net/
// @version      2024-03-14
// @description  预览帖子内其他帖子的封面
// @author       ZacharyZzz
// @match        *://*/read.php?tid*
// @match        *://*/u.php?*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

/**
 * PostCoverPreview 改进版
 * 变更：
 *  1. 新增“普通链接预览”独立开关
 *  2. UI 改为控制面板（可拖拽）便于扩展更多选项
 *  3. 模块化函数，提高可维护性
 *  4. 链接处理去重标记，避免重复请求
 *  5. 统一日志、常量与配置访问
 */
(async function() {
    'use strict';

    /******************** 常量区 ********************/
    const MAX_CONCURRENT_REQUESTS = 5;             // 最大并发请求数
    const PLACEHOLDER_IMAGE = 'https://img.chkaja.com/adcadfc7898c229f.png';
    const CONFIG_KEYS = {
        ENABLED: 'PostCoverPreviewEnabled',
        INCLUDE_NORMAL: 'PostCoverPreviewIncludeNormalLinks'
    };

    // 记录已进入队列 / 已成功处理的帖子 tid，避免同一 tid 的不同链接形式(如含 -uid- 版本)重复加载
    const tidQueued = new Set();
    const tidDone = new Set();

    /******************** 配置访问 ********************/
    const Config = {
        get enabled() { return GM_getValue(CONFIG_KEYS.ENABLED, true); },
        set enabled(v) { GM_setValue(CONFIG_KEYS.ENABLED, !!v); },
        get includeNormal() { return GM_getValue(CONFIG_KEYS.INCLUDE_NORMAL, false); },
        set includeNormal(v) { GM_setValue(CONFIG_KEYS.INCLUDE_NORMAL, !!v); }
    };

    /******************** 日志工具 ********************/
    function log(message, data) {
        if (data !== undefined) {
            console.log(`[PostCoverPreview] ${message}`, data);
        } else {
            console.log(`[PostCoverPreview] ${message}`);
        }
    }

    /******************** 页面上下文判定 ********************/
    function getTidFromUrl(url) {
        // 支持格式: read.php?tid=12345, read.php?tid-12345.html, read.php?tid-12345-fpage-2.html
        const m = url.match(/read\.php.*?[?&]tid=(\d+)/) || url.match(/read\.php.*?tid-(\d+)/);
        return m ? m[1] : null;
    }

    // 生成帖子的规范化链接(尽量使用不带 -uid- 的版本，去除多余 segment) 仅用于去重与抓取
    function canonicalizePostUrl(href) {
        let url = href;
        // path 形式 tid-2632369-uid-475242.html -> tid-2632369.html
        url = url.replace(/(tid-\d+)-uid-\d+/i, '$1');
        // 可能存在 &uid=xxx 形式 (防御性)
        if (/tid=\d+/i.test(url)) {
            url = url.replace(/([?&])uid=\d+(&|$)/i, (match, p1, p2) => p2 ? p1 : '');
            // 清理可能出现的多余 ?&
            url = url.replace(/\?&/, '?').replace(/&&+/, '&').replace(/[?&]$/,'');
        }
        return url;
    }

    function getPageContext() {
        const url = window.location.href;
        return {
            isUserTopicPage: url.includes('u.php?'),
            url,
            currentTid: getTidFromUrl(url)
        };
    }

    /******************** UI 控制面板 ********************/
    function createControlPanel() {
        if (document.getElementById('pcp-control-panel')) return; // 已存在
        const panel = document.createElement('div');
        panel.id = 'pcp-control-panel';
        panel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 99999;
            background: #ffffffdd;
            backdrop-filter: blur(4px);
            border: 1px solid #ccc;
            border-radius: 6px;
            padding: 8px 10px 10px 10px;
            font: 12px/1.4 system-ui, sans-serif;
            color: #333;
            box-shadow: 0 2px 8px rgba(0,0,0,.15);
            width: 150px;
            cursor: move;
        `;
        panel.innerHTML = `
            <div style="font-weight:600;margin-bottom:6px;cursor:move;">封面预览</div>
            <label style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
              <input type="checkbox" id="pcp-enabled"> 启用
            </label>
            <label style="display:flex;align-items:center;gap:4px;margin-bottom:6px;">
              <input type="checkbox" id="pcp-include-normal"> 普通链接
            </label>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              <button id="pcp-refresh" style="flex:1;">刷新</button>
              <button id="pcp-clear" style="flex:1;">清除</button>
            </div>
        `;

        document.body.appendChild(panel);

        // 初始化状态
        panel.querySelector('#pcp-enabled').checked = Config.enabled;
        panel.querySelector('#pcp-include-normal').checked = Config.includeNormal;

        // 事件绑定
        panel.querySelector('#pcp-enabled').addEventListener('change', e => {
            Config.enabled = e.target.checked;
            if (Config.enabled) {
                refreshPreviews();
            } else {
                removeAllPreviews();
            }
        });
        panel.querySelector('#pcp-include-normal').addEventListener('change', e => {
            Config.includeNormal = e.target.checked;
            if (Config.enabled) refreshPreviews();
        });
        panel.querySelector('#pcp-refresh').addEventListener('click', () => {
            if (Config.enabled) refreshPreviews(true);
        });
        panel.querySelector('#pcp-clear').addEventListener('click', () => removeAllPreviews());

        makePanelDraggable(panel);
    }

    function makePanelDraggable(panel) {
        let isDown = false, startX, startY, startLeft, startTop;
        const header = panel.firstElementChild; // 标题做拖拽
        const md = e => {
            isDown = true;
            startX = e.clientX; startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            document.addEventListener('mousemove', mm);
            document.addEventListener('mouseup', mu);
        };
        const mm = e => {
            if (!isDown) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            panel.style.left = (startLeft + dx) + 'px';
            panel.style.top = (startTop + dy) + 'px';
            panel.style.right = 'auto';
        };
        const mu = () => {
            isDown = false;
            document.removeEventListener('mousemove', mm);
            document.removeEventListener('mouseup', mu);
        };
        header.addEventListener('mousedown', md);
    }

    /******************** DOM 操作及辅助 ********************/
    function clickExpandButtons() {
        document.querySelectorAll('a.rinsp-thread-populate-button').forEach(button => {
            if (button.textContent === '展开') {
                log('点击展开按钮');
                button.click();
            }
        });
    }

    async function fetchPostAsDom(href) {
        try {
            log('获取帖子: ' + href);
            const resp = await fetch(href);
            const text = await resp.text();
            return new DOMParser().parseFromString(text, 'text/html');
        } catch (e) {
            log('获取失败: ' + e.message);
            return null;
        }
    }

    function checkImageValid(url) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img.naturalWidth > 0);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    async function asyncPool(limit, items, iteratorFn) {
        const ret = [];
        const executing = new Set();
        for (const item of items) {
            const p = Promise.resolve().then(() => iteratorFn(item));
            ret.push(p);
            executing.add(p);
            const clean = () => executing.delete(p);
            p.then(clean, clean);
            if (executing.size >= limit) await Promise.race(executing);
        }
        return Promise.all(ret);
    }

    /******************** 预览核心 ********************/
    function createPreviewContainer() {
        const previewDiv = document.createElement('div');
        previewDiv.className = 'post-cover-preview';
        previewDiv.style.cssText = `
            margin: 5px 0 15px 20px;
            padding: 5px;
            border: 1px solid #ccc;
            background: #fff;
            display: block !important;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,.06);
        `;
        const img = document.createElement('img');
        img.style.cssText = `
            max-width: 200px;
            max-height: 300px;
            border: 1px solid #ccc;
            display: block !important;
            object-fit: contain;
            background:#fafafa;
        `;
        img.src = PLACEHOLDER_IMAGE;
        const loadingText = document.createElement('div');
        loadingText.textContent = '加载中...';
        loadingText.style.cssText = 'margin:5px 0;color:#666;font-size:12px;';
        previewDiv.appendChild(img);
        previewDiv.appendChild(loadingText);
        return { previewDiv, img, loadingText };
    }

    function insertPreview(link, previewDiv) {
        let inserted = false;
        // 策略1：链接后的 <br> 后插入
        let nextBr = link.nextSibling;
        while (nextBr && !(nextBr.tagName === 'BR')) nextBr = nextBr.nextSibling;
        if (nextBr && nextBr.nextSibling) {
            nextBr.parentNode.insertBefore(previewDiv, nextBr.nextSibling);
            inserted = true;
        }
        // 策略2：父级 td
        if (!inserted) {
            const container = link.closest('td') || link.parentElement;
            if (container) { container.appendChild(previewDiv); inserted = true; }
        }
        // 策略3：直接在后面
        if (!inserted && link.parentNode) link.parentNode.insertBefore(previewDiv, link.nextSibling);
    }

    async function processLink(linkData) {
        const { link, previewDiv, img, loadingText, canonicalTid, canonicalUrl } = linkData;
        try {
            const targetUrl = canonicalUrl || link.href;
            if (!targetUrl) {
                log('跳过：无有效 URL');
                return cleanupOnFailure(link, previewDiv, loadingText, '无URL');
            }
            const postDoc = await fetchPostAsDom(targetUrl);
            if (!postDoc) { return cleanupOnFailure(link, previewDiv, loadingText, '获取失败'); }

            // 备用图床
            const backupImages = postDoc.evaluate(
                "//div[contains(text(), '备用图床')]/ancestor::tr/following-sibling::tr//img",
                postDoc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
            );
            let imgSrc = null;
            if (backupImages.snapshotLength > 0) {
                imgSrc = backupImages.snapshotItem(0).src;
                log('找到备用图床图片: ' + imgSrc);
            } else {
                const firstImg = postDoc.querySelector('div#read_tpc img:not([src*="face"]):not([src*="logo"])');
                if (firstImg) { imgSrc = firstImg.src; log('使用普通图片: ' + imgSrc); }
            }
            if (!imgSrc) { return cleanupOnFailure(link, previewDiv, loadingText, '无图片'); }

            const valid = await checkImageValid(imgSrc);
            if (!valid) { return cleanupOnFailure(link, previewDiv, loadingText, '图片失效'); }

            img.src = imgSrc;
            loadingText.textContent = '加载完成';
            loadingText.style.color = 'green';
            link.dataset.pcpProcessed = '1';
            if (canonicalTid) {
                tidDone.add(canonicalTid);
            }
        } catch (e) {
            log('处理失败: ' + e.message);
            cleanupOnFailure(link, previewDiv, loadingText, '异常');
        } finally {
            delete link.dataset.pcpProcessing;
        }
    }

    function cleanupOnFailure(link, previewDiv, loadingText, reason) {
        if (loadingText) {
            loadingText.textContent = reason;
            loadingText.style.color = reason === '无图片' ? '#b36b00' : 'red';
        }
        // 延迟移除以便用户瞬间看到状态
        setTimeout(() => { if (previewDiv.isConnected) previewDiv.remove(); }, 800);
        delete link.dataset.pcpProcessing;
        log('链接预览失败: ' + reason + ' -> ' + link.href);
    }

    function collectTargetTables(context) {
        const { isUserTopicPage } = context;
        let targetTables = [];
        if (isUserTopicPage) {
            targetTables = Array.from(document.querySelectorAll('table')).filter(t => t.querySelector('a[href*="read.php?tid"]'));
            log('用户发帖页面 - 表格数量: ' + targetTables.length);
        } else {
            document.querySelectorAll('table').forEach(table => {
                if (table.textContent.includes('最近7日资源列表') && targetTables.length === 0) {
                    targetTables.push(table);
                }
            });
            log('资源列表页面 - 目标表格: ' + targetTables.length);
        }
        return targetTables;
    }

    // 当未找到表格或用户开启普通链接扫描时，进行全局收集（避免导航/脚注等区域）
    function collectGlobalLinks(context) {
        const contentRoots = [
            '#main', '#body', '#pw_content', '.t', '.content', '#wp', '#wrapper'
        ];
        let scopeNodes = [];
        contentRoots.forEach(sel => document.querySelector(sel) && scopeNodes.push(document.querySelector(sel)));
        if (!scopeNodes.length) scopeNodes = [document.body];
        const links = new Set();
        scopeNodes.forEach(root => {
            root.querySelectorAll('a[href*="read.php?tid"]').forEach(a => links.add(a));
        });
        // 过滤掉明显的导航/引用等区域(简单启发)
        return Array.from(links).filter(a => {
            const cls = (a.className||'').toLowerCase();
            if (/nav|menu|footer|pager|quote/.test(cls)) return false;
            if (a.closest('nav,footer')) return false;
            return !shouldSkipLink(a, context);
        });
    }

    function shouldSkipLink(link, context) {
        // 跳过当前页面自身帖子链接
        if (context.currentTid) {
            const linkTid = getTidFromUrl(link.href);
            if (linkTid && linkTid === context.currentTid) {
                return true;
            }
        }
        if (!context.isUserTopicPage) return false;
        const parentText = link.parentElement?.textContent || '';
        if (parentText.includes('xxx xxx') || parentText.includes('----') || /xxx\s+xxx/i.test(parentText)) {
            log('跳过特殊标记链接: ' + parentText.trim().slice(0, 50));
            return true;
        }
        return false;
    }

    function collectLinksFromTable(table, context) {
        const anchorsAll = Array.from(table.querySelectorAll('a[href*="read.php?tid"]'));
        let selected = [];
        if (context.isUserTopicPage) {
            selected = anchorsAll;
        } else {
            const redOnes = new Set(
                Array.from(table.querySelectorAll('a[href*="read.php?tid="] > span[style*="color:#ff0000"]'))
                    .map(span => span.parentElement)
            );
            selected = Array.from(redOnes);
            if (Config.includeNormal) {
                anchorsAll.forEach(a => { if (!redOnes.has(a)) selected.push(a); });
            }
        }
        return selected.filter(a => !shouldSkipLink(a, context));
    }

    function buildLinksData(links) {
        return links.map(link => {
            if (link.dataset.pcpProcessed === '1') return null; // 已成功处理
            if (link.dataset.pcpProcessing === '1') return null; // 处理中
            if (link.dataset.pcpQueued === '1') return null; // 已进入队列（避免与全局扫描重复）
            const attempts = parseInt(link.dataset.pcpAttempts || '0', 10);
            if (attempts >= 2) return null; // 达到最大尝试次数

            const canonicalTid = getTidFromUrl(link.href);
            const canonicalUrl = canonicalizePostUrl(link.href);
            // 如果 tid 已完成或已在队列中，跳过（多个重复链接只生成一个预览）
            if (canonicalTid && (tidQueued.has(canonicalTid) || tidDone.has(canonicalTid))) {
                link.dataset.pcpTidSkipped = '1';
                return null;
            }
            link.dataset.pcpAttempts = String(attempts + 1);
            link.dataset.pcpProcessing = '1';
            link.dataset.pcpQueued = '1';
            const { previewDiv, img, loadingText } = createPreviewContainer();
            previewDiv.dataset.forLink = link.href;
            insertPreview(link, previewDiv);
            if (canonicalTid) tidQueued.add(canonicalTid);
            return { link, previewDiv, img, loadingText, canonicalTid, canonicalUrl };
        }).filter(Boolean);
    }

    async function addCoverPreviews() {
        if (!Config.enabled) return log('预览功能已关闭');
        clickExpandButtons();
        const context = getPageContext();
        const tables = collectTargetTables(context);
        let totalLinksProcessed = 0;
        if (tables.length) {
            for (const table of tables) {
                const links = collectLinksFromTable(table, context);
                log(`表格链接数量: ${links.length}`);
                const linksData = buildLinksData(links);
                totalLinksProcessed += linksData.length;
                if (!linksData.length) continue;
                await asyncPool(MAX_CONCURRENT_REQUESTS, linksData, processLink);
            }
        } else {
            log('未找到目标表格');
        }

        // 全局普通链接补充扫描：1) 没有表格 或 2) 用户勾选普通链接
        if (Config.includeNormal) {
            const globalLinks = collectGlobalLinks(context);
            // 去除已经在表格里处理的
            const pending = globalLinks.filter(a => a.dataset.pcpProcessed !== '1' && a.dataset.pcpQueued !== '1');
            log(`全局普通链接补充数量: ${pending.length}`);
            const linksData = buildLinksData(pending);
            totalLinksProcessed += linksData.length;
            if (linksData.length) await asyncPool(MAX_CONCURRENT_REQUESTS, linksData, processLink);
        }
        log('本轮预览处理链接数: ' + totalLinksProcessed);
    }

    function removeAllPreviews() {
        document.querySelectorAll('.post-cover-preview').forEach(el => el.remove());
        document.querySelectorAll('a[href*="read.php?tid"]').forEach(a => { delete a.dataset.pcpProcessed; });
    }

    function refreshPreviews(forceClear = false) {
        if (forceClear) removeAllPreviews();
        addCoverPreviews();
    }

    /******************** 初始化 ********************/
    function init() {
        createControlPanel();
        addCoverPreviews();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else { init(); }

    /******************** 动态监听 ********************/
    const observer = new MutationObserver(mutations => {
        if (!Config.enabled) return;
        let needUpdate = false;
        for (const m of mutations) {
            if (m.addedNodes.length) {
                const hasExpand = Array.from(m.addedNodes).some(n => n.nodeType === 1 && n.querySelector?.('a.rinsp-thread-populate-button'));
                if (hasExpand) { needUpdate = true; break; }
                // 新增含有 tid 链接节点
                const hasTidLink = Array.from(m.addedNodes).some(n => n.nodeType === 1 && n.querySelector?.('a[href*="read.php?tid="]'));
                if (hasTidLink) { needUpdate = true; break; }
            }
        }
        if (needUpdate) {
            log('检测到动态内容，准备更新预览');
            setTimeout(() => addCoverPreviews(), 400);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    log('脚本已加载（改进版）');
})();
