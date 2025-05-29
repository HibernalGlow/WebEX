// ==UserScript==
// @name         BT1207磁力链批量获取
// @namespace    http://tampermonkey.net/
// @version      0.7.3
// @description  为BT1207搜索结果添加磁力链接快速显示和批量获取功能
// @author       Your name
// @match        *://*/*bt1207*/*
// @match        *://*bt1207*.*/*
// @include      *bt1207*
// @include      https://*.bt1207*.*/*
// @include      https://bt1207xc.top/*
// @match        https://bt1207xc.top/*
// @match        https://*.bt1207xc.top/*
// @require      https://code.jquery.com/jquery-3.7.1.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-end
// ==/UserScript==



(function() {
    'use strict';

    // 调试模式开关
    const DEBUG = true;

    // 调试日志增强版
    function debugLog(msg) {
        if (DEBUG) {
            console.log('%c [BT1207脚本]', 'color: blue; font-weight: bold;', msg);
        }
    }
    
    // 记录当前URL信息
    debugLog('当前URL: ' + window.location.href);
    debugLog('当前域名: ' + window.location.hostname);
    debugLog('文档状态: ' + document.readyState);

    // 配置管理
    const Config = {
        notificationEnabled: GM_getValue('notificationEnabled', true),
        delayBetweenBatches: GM_getValue('delayBetweenBatches', 1500),
        batchSize: GM_getValue('batchSize', 2),
        maxRetries: GM_getValue('maxRetries', 3),

        save() {
            GM_setValue('notificationEnabled', this.notificationEnabled);
            GM_setValue('delayBetweenBatches', this.delayBetweenBatches);
            GM_setValue('batchSize', this.batchSize);
            GM_setValue('maxRetries', this.maxRetries);
        }
    };

    // 性能监控
    const Performance = {
        measures: new Map(),

        start(label) {
            this.measures.set(label, performance.now());
        },

        end(label) {
            const start = this.measures.get(label);
            if (start) {
                const duration = performance.now() - start;
                debugLog(`${label} 耗时: ${duration.toFixed(2)}ms`);
                this.measures.delete(label);
                return duration;
            }
            return 0;
        },

        async measure(label, fn) {
            this.start(label);
            const result = await fn();
            this.end(label);
            return result;
        }
    };

    // DOM 操作工具
    const DOM = {
        createElement(tag, attributes = {}, children = []) {
            const element = document.createElement(tag);
            Object.entries(attributes).forEach(([key, value]) => {
                if (key === 'className') {
                    element.className = value;
                } else if (key === 'dataset') {
                    Object.entries(value).forEach(([dataKey, dataValue]) => {
                        element.dataset[dataKey] = dataValue;
                    });
                } else if (key === 'style' && typeof value === 'object') {
                    Object.assign(element.style, value);
                } else if (key.startsWith('on') && typeof value === 'function') {
                    element.addEventListener(key.slice(2).toLowerCase(), value);
                } else {
                    element[key] = value;
                }
            });
            children.forEach(child => element.appendChild(child));
            return element;
        },

        createFragment() {
            return document.createDocumentFragment();
        }
    };

    // 处理跳转页面
    if (document.body.textContent.includes('即将跳转到目标网址')) {
        const redirectLink = document.querySelector('a[href*="bt1207"]');
        if (redirectLink) {
            debugLog('检测到跳转页面，即将跳转到：' + redirectLink.href);
            window.location.href = redirectLink.href;
        }
        return;
    }

    // 等待页面加载完成
    function waitForElements(selector, callback, maxTries = 10) {
        debugLog('开始等待元素: ' + selector);
        let tries = 0;
        const interval = setInterval(() => {
            // 尝试多个可能的选择器
            const selectors = [
                'ul.list-unstyled',  // 新的主选择器
                '.search-item',
                '.item',
                '.result-item',
                'div[class*="item"]'
            ];
            
            let elements = null;
            for (const sel of selectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) {
                    debugLog('找到匹配元素，使用选择器: ' + sel);
                    elements = found;
                    break;
                }
            }

            if (elements && elements.length > 0) {
                debugLog('成功找到 ' + elements.length + ' 个结果项');
                clearInterval(interval);
                callback(elements);
            } else if (++tries >= maxTries) {
                debugLog('未能找到任何结果项，已尝试次数: ' + tries);
                clearInterval(interval);
                debugLog('当前页面结构：');
                debugLog(document.body.innerHTML.substring(0, 500) + '...');
            }
        }, 1000);
    }

    // 关键词列表
    const INCLUDED_KEYWORDS = [
        '汉化','官方','中文', '漢化', '掃','修正', '制', '譯', 
        '个人', '翻', '製', '嵌','訳','淫书馆'
    ];

    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
        .magnet-checkbox {
            margin: 0 10px;
            width: 16px;
            height: 16px;
            vertical-align: middle;
            position: relative;
            z-index: 1000;
        }
        .magnet-container {
            display: inline-block;
            margin-left: 10px;
        }
        .magnet-container.selected {
            background-color: rgba(76, 175, 80, 0.1);
            border-radius: 4px;
        }
        #getMagnetsBtn, #selectAllBtn, #invertSelectBtn, #selectKeywordsBtn {
            position: fixed;
            padding: 10px 20px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            z-index: 9999;
            font-size: 14px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: background-color 0.3s;
        }
        #getMagnetsBtn {
            bottom: 20px;
            right: 20px;
        }
        #selectAllBtn {
            bottom: 20px;
            right: 200px;
        }
        #invertSelectBtn {
            bottom: 20px;
            right: 320px;
        }
        #selectKeywordsBtn {
            bottom: 20px;
            right: 440px;
            font-size: 16px;
        }
        #getMagnetsBtn:hover, #selectAllBtn:hover, #invertSelectBtn:hover, #selectKeywordsBtn:hover {
            background: #45a049;
        }
        .magnet-icon {
            display: inline-block;
            cursor: pointer;
            margin: 0 5px 2px;
            border-radius: 50%;
            vertical-align: middle;
            height: 20px !important;
            width: 20px !important;
            transition: all 0.2s;
            position: relative;
            z-index: 1000;
        }
        .magnet-icon:hover {
            transform: scale(1.1);
            filter: brightness(1.1);
        }
        .magnet-icon.selected {
            box-shadow: 0 0 5px #4CAF50;
        }
        ul.list-unstyled {
            position: relative;
        }
        .progress-bar {
            position: fixed;
            bottom: 70px;
            right: 20px;
            width: 200px;
            height: 4px;
            background: #ddd;
            border-radius: 2px;
            overflow: hidden;
            display: none;
        }
        .progress-bar .progress {
            width: 0;
            height: 100%;
            background: #4CAF50;
            transition: width 0.3s;
        }
        .keyword-match {
            background-color: rgba(255, 235, 59, 0.2);
            border-radius: 2px;
            padding: 0 2px;
        }
        .copy-btn {
            display: inline-block;
            cursor: pointer;
            margin: 0 5px;
            padding: 2px 6px;
            border: none;
            border-radius: 3px;
            background: #4CAF50;
            color: white;
            font-size: 12px;
            vertical-align: middle;
            transition: all 0.2s;
        }
        .copy-btn:hover {
            background: #45a049;
            transform: scale(1.05);
        }
        .retry-btn {
            display: inline-block;
            cursor: pointer;
            margin: 0 5px;
            padding: 2px 6px;
            border: none;
            border-radius: 3px;
            background: #FF9800;
            color: white;
            font-size: 12px;
            vertical-align: middle;
            transition: all 0.2s;
        }
        .retry-btn:hover {
            background: #F57C00;
            transform: scale(1.05);
        }
    `;
    document.head.appendChild(style);

    // 注册菜单命令
    function updateMenuCommand() {
        const isEnabled = GM_getValue('notificationEnabled');
        GM_registerMenuCommand(
            isEnabled ? '关闭复制通知' : '开启复制通知',
            () => {
                GM_setValue('notificationEnabled', !isEnabled);
                location.reload();
            }
        );
    }
    updateMenuCommand();

    // 添加延迟函数
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    // 为搜索结果添加复选框
    function addCheckboxes(searchResults) {
        return Performance.measure('添加复选框', () => {
            const fragment = DOM.createFragment();
            
            Array.from(searchResults).forEach(item => {
                if (item.querySelector('.magnet-container')) return;
                
                const container = DOM.createElement('div', {
                    className: 'magnet-container',
                    onclick: (e) => {
                        const checkbox = container.querySelector('.magnet-checkbox');
                        if (checkbox && e.target !== checkbox && !e.target.classList.contains('copy-btn')) {
                            checkbox.checked = !checkbox.checked;
                            updateContainerStyle(container);
                        }
                    }
                }, [
                    DOM.createElement('input', {
                        type: 'checkbox',
                        className: 'magnet-checkbox',
                        onchange: () => updateContainerStyle(container)
                    }),
                    DOM.createElement('button', {
                        className: 'copy-btn',
                        textContent: '复制',
                        onclick: (e) => {
                            e.stopPropagation();
                            const magnetIcon = container.querySelector('.magnet-icon');
                            if (magnetIcon && magnetIcon.dataset.magnet) {
                                GM_setClipboard(magnetIcon.dataset.magnet);
                                if (GM_getValue('notificationEnabled')) {
                                    GM_notification({
                                        title: '磁力链接已复制',
                                        text: '磁力链接已成功复制到剪贴板！',
                                        timeout: 2000
                                    });
                                }
                            } else {
                                GM_notification({
                                    title: '复制失败',
                                    text: '暂未获取到磁力链接，请稍后再试！',
                                    timeout: 2000
                                });
                            }
                        }
                    })
                ]);

                const firstLi = item.querySelector('li');
                if (firstLi) {
                    firstLi.insertBefore(container, firstLi.firstChild);
                }
            });
        });
    }

    // 更新容器样式
    function updateContainerStyle(container) {
        const checkbox = container.querySelector('.magnet-checkbox');
        const icon = container.querySelector('.magnet-icon');
        if (checkbox.checked) {
            container.classList.add('selected');
            if (icon) icon.classList.add('selected');
        } else {
            container.classList.remove('selected');
            if (icon) icon.classList.remove('selected');
        }
    }

    // 添加磁力图标的辅助函数
    function addMagnetIcon(container, magnetLink) {
        const magnetIcon = document.createElement('img');
        magnetIcon.src = 'https://cdn.jsdelivr.net/gh/zxf10608/JavaScript/icon/magnet00.png';
        magnetIcon.className = 'magnet-icon';
        magnetIcon.title = `识别到磁力链接，左键打开，右键复制\n${magnetLink}`;
        magnetIcon.dataset.magnet = magnetLink;
        
        magnetIcon.addEventListener('click', () => window.open(magnetLink));
        magnetIcon.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            GM_setClipboard(magnetLink);
            if (GM_getValue('notificationEnabled')) {
                GM_notification({
                    title: '磁力链接已复制',
                    text: '磁力链接已成功复制到剪贴板！',
                    timeout: 2000
                });
            }
        });

        container.appendChild(magnetIcon);
        return magnetIcon;
    }

    // 添加重试按钮的辅助函数
    function addRetryButton(container, detailLink, magnetSelectors) {
        if (container.querySelector('.retry-btn')) return;

        const retryBtn = DOM.createElement('button', {
            className: 'retry-btn',
            textContent: '重试',
            onclick: async (e) => {
                e.stopPropagation();
                const btn = e.target;
                btn.disabled = true;
                btn.textContent = '重试中...';
                
                try {
                    const magnetLink = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: detailLink,
                            onload: function(response) {
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(response.responseText, 'text/html');
                                
                                for (const sel of magnetSelectors) {
                                    const element = doc.querySelector(sel);
                                    if (element) {
                                        resolve(element.href || element.textContent);
                                        return;
                                    }
                                }
                                reject(new Error('未找到磁力链接'));
                            },
                            onerror: reject
                        });
                    });

                    if (magnetLink) {
                        btn.remove();
                        addMagnetIcon(container, magnetLink);
                        if (GM_getValue('notificationEnabled')) {
                            GM_notification({
                                title: '重试成功',
                                text: '成功获取磁力链接！',
                                timeout: 2000
                            });
                        }
                    }
                } catch (error) {
                    debugLog('重试获取磁力链接失败: ' + error.message);
                    btn.disabled = false;
                    btn.textContent = '重试';
                    if (GM_getValue('notificationEnabled')) {
                        GM_notification({
                            title: '重试失败',
                            text: '获取磁力链接失败，请稍后再试！',
                            timeout: 2000
                        });
                    }
                }
            }
        });
        
        container.appendChild(retryBtn);
    }

    // 修改processSearchResults函数
    async function processSearchResults(searchResults) {
        debugLog('开始处理搜索结果，数量：' + searchResults.length);
        
        const items = Array.from(searchResults).filter(item => {
            const container = item.querySelector('.magnet-container');
            if (!container) return false;
            
            const magnetIcons = container.querySelectorAll('.magnet-icon');
            return magnetIcons.length === 0 || !Array.from(magnetIcons).some(icon => icon.dataset.magnet);
        });
        
        const magnetSelectors = [
            '.magnet-link',
            '[href^="magnet:"]',
            'a[href*="magnet:?xt=urn:btih:"]',
            '#magnetLink',
            '.magnet'
        ];

        for (let i = 0; i < items.length; i += Config.batchSize) {
            const currentBatch = items.slice(i, i + Config.batchSize);
            
            const batchPromises = currentBatch.map(async (item) => {
                const linkElement = item.querySelector('a.rrt');
                if (!linkElement) return;

                const container = item.querySelector('.magnet-container');
                if (!container) return;

                const detailLink = linkElement.href;
                
                try {
                    const response = await fetch(detailLink);
                    const text = await response.text();
                    const doc = new DOMParser().parseFromString(text, 'text/html');
                    
                    let magnetLink = null;
                    for (const sel of magnetSelectors) {
                        const element = doc.querySelector(sel);
                        if (element) {
                            magnetLink = element.href || element.textContent;
                            break;
                        }
                    }

                    if (magnetLink && !container.querySelector(`[data-magnet="${magnetLink}"]`)) {
                        addMagnetIcon(container, magnetLink);
                    } else {
                        addRetryButton(container, detailLink, magnetSelectors);
                    }
                } catch (error) {
                    debugLog('获取磁力链接失败: ' + error.message);
                    addRetryButton(container, detailLink, magnetSelectors);
                }
            });

            await Promise.all(batchPromises);
            
            if (i + Config.batchSize < items.length) {
                await delay(Config.delayBetweenBatches);
            }
        }
    }

    // 添加批量获取按钮和全选/反选按钮
    const getMagnetsBtn = document.createElement('button');
    getMagnetsBtn.id = 'getMagnetsBtn';
    getMagnetsBtn.textContent = '获取选中磁力链接';
    document.body.appendChild(getMagnetsBtn);

    const selectAllBtn = document.createElement('button');
    selectAllBtn.id = 'selectAllBtn';
    selectAllBtn.textContent = '全选';
    document.body.appendChild(selectAllBtn);

    const invertSelectBtn = document.createElement('button');
    invertSelectBtn.id = 'invertSelectBtn';
    invertSelectBtn.textContent = '反选';
    document.body.appendChild(invertSelectBtn);

    // 全选功能
    selectAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.magnet-checkbox');
        const isAllChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(checkbox => {
            checkbox.checked = !isAllChecked;
        });
    });

    // 反选功能
    invertSelectBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.magnet-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = !checkbox.checked;
        });
    });

    // 修改批量获取磁力链接的逻辑
    getMagnetsBtn.addEventListener('click', async () => {
        const selectedItems = document.querySelectorAll('.magnet-checkbox:checked');
        debugLog('选中了 ' + selectedItems.length + ' 个项目');
        
        if (selectedItems.length === 0) {
            alert('请先选择要获取的磁力链接！');
            return;
        }

        const magnets = [];
        let successCount = 0;

        for (const item of selectedItems) {
            const magnetIcon = item.parentElement.querySelector('.magnet-icon');
            if (magnetIcon && magnetIcon.dataset.magnet) {
                magnets.push(magnetIcon.dataset.magnet);
                successCount++;
            }
        }

        if (magnets.length > 0) {
            const magnetText = magnets.join('\n');
            GM_setClipboard(magnetText);
            debugLog('成功复制 ' + magnets.length + ' 个磁力链接');
            
            if (GM_getValue('notificationEnabled')) {
                GM_notification({
                    title: '批量复制成功',
                    text: `已复制 ${magnets.length} 个磁力链接到剪贴板！`,
                    timeout: 2000
                });
            }
        } else {
            alert('未能获取到任何磁力链接，请稍后重试！');
        }
    });

    // 添加按钮
    const selectKeywordsBtn = document.createElement('button');
    selectKeywordsBtn.id = 'selectKeywordsBtn';
    selectKeywordsBtn.textContent = '🔑';
    selectKeywordsBtn.title = '选中包含关键词的条目';
    document.body.appendChild(selectKeywordsBtn);

    // 关键词选择功能
    selectKeywordsBtn.addEventListener('click', () => {
        const items = document.querySelectorAll('ul.list-unstyled li');
        let matchCount = 0;

        items.forEach(item => {
            const titleElement = item.querySelector('a.rrt');
            if (!titleElement) return;

            const title = titleElement.textContent;
            const hasKeyword = INCLUDED_KEYWORDS.some(keyword => title.includes(keyword));
            
            if (hasKeyword) {
                const container = item.querySelector('.magnet-container');
                if (container) {
                    const checkbox = container.querySelector('.magnet-checkbox');
                    if (checkbox && !checkbox.checked) {
                        checkbox.checked = true;
                        updateContainerStyle(container);
                        matchCount++;
                    }
                }
            }
        });

        if (matchCount > 0) {
            GM_notification({
                title: '关键词选择完成',
                text: `已选中 ${matchCount} 个包含关键词的条目`,
                timeout: 2000
            });
        } else {
            GM_notification({
                title: '未找到匹配项',
                text: '没有找到包含关键词的条目',
                timeout: 2000
            });
        }
    });

    // 监听页面变化，处理动态加载的内容
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) {
                debugLog('检测到页面变化');
                const searchResults = document.querySelectorAll('ul.list-unstyled');
                if (searchResults.length > 0) {
                    debugLog('发现新的搜索结果');
                    addCheckboxes(searchResults);  // 先添加复选框
                    processSearchResults(searchResults);  // 然后获取磁力链接
                }
            }
        });
    });

    // 等待搜索结果加载完成后开始处理
    waitForElements('ul.list-unstyled', (elements) => {
        debugLog('页面加载完成，开始处理搜索结果');
        addCheckboxes(elements);  // 先添加复选框
        processSearchResults(elements);  // 然后获取磁力链接
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
})();