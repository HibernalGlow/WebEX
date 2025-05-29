// ==UserScript==
// @name         A-list批量下载助手
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  为A-list搜索结果添加批量选择和获取下载链接功能
// @author       Your name
// @match        https://alist-public.imoutoheaven.org/*
// @match        http://localhost:5244/
// @require      https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        window.close
// @grant        window.focus
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 添加 delay 函数的定义（放在脚本开头的配置后面）
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    // 配置管理
    const Config = {
        notificationEnabled: GM_getValue('notificationEnabled', true),
        delayBetweenBatches: GM_getValue('delayBetweenBatches', 1500),
        batchSize: GM_getValue('batchSize', 2),
    };

    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
        .download-checkbox {
            margin: 0 10px;
            width: 16px;
            height: 16px;
            vertical-align: middle;
        }
        .download-container {
            display: inline-block;
            margin-left: 10px;
        }
        .download-container.selected {
            background-color: rgba(76, 175, 80, 0.1);
            border-radius: 4px;
        }
        .download-link {
            margin-left: 10px;
            color: #4CAF50;
            cursor: pointer;
        }
        #batchButtons {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
        }
        .batch-btn {
            margin-left: 10px;
            padding: 8px 16px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .batch-btn:hover {
            background: #45a049;
        }
        .selected-item {
            background-color: rgba(76, 175, 80, 0.1) !important;
        }
        .download-checkbox {
            margin: 0 8px;
            width: 16px;
            height: 16px;
            vertical-align: middle;
            cursor: pointer;
        }
        .download-container {
            display: inline-flex;
            align-items: center;
            padding: 2px 5px;
            border-radius: 4px;
        }
        #batchButtons {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: rgba(255, 255, 255, 0.9);
            padding: 10px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }
        .progress-bar {
            position: fixed;
            bottom: 80px;
            right: 20px;
            width: 200px;
            height: 20px;
            background: #f0f0f0;
            border-radius: 10px;
            overflow: hidden;
            z-index: 9999;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .progress {
            height: 100%;
            background: #4CAF50;
            width: 0;
            transition: width 0.3s ease;
        }
        .progress-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #000;
            font-size: 12px;
            text-shadow: 0 0 2px #fff;
        }
        .progress-container {
            position: fixed;
            bottom: 80px;
            right: 20px;
            width: 300px;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 10px;
            padding: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 9999;
        }
        .progress-log {
            max-height: 150px;
            overflow-y: auto;
            margin-bottom: 10px;
            font-size: 12px;
            color: #666;
            border-bottom: 1px solid #eee;
            padding-bottom: 5px;
        }
        .progress-log-item {
            margin: 2px 0;
            padding: 2px 5px;
        }
        .progress-log-item.error {
            color: #f44336;
        }
        .progress-log-item.success {
            color: #4CAF50;
        }
    `;
    document.head.appendChild(style);

    // 添加URL处理规则配置
    const urlProcessRules = [
        {
            name: '移除搜索参数',
            pattern: /\?from=search$/,
            replacement: ''
        },
        {
            name: '添加下载路径',
            pattern: 'http://localhost:5244/',
            replacement: 'http://localhost:5244/d/'
        },
        // 可以在这里添加更多规则
        // {
        //     name: '规则说明',
        //     pattern: /正则表达式或字符串/,
        //     replacement: '替换内容'
        // }
    ];

    // 修改选择器和等待逻辑
    function waitForSearchResults() {
        const searchResults = document.querySelectorAll('.hope-stack.hope-c-dhzjXW.hope-c-PJLV-idcOWKd-css');
        if (searchResults.length > 0) {
            initializeInterface(searchResults);
        } else {
            setTimeout(waitForSearchResults, 500);
        }
    }

    // 修改界面初始化函数
    function initializeInterface(searchResults) {
        searchResults.forEach(item => {
            if (item.querySelector('.download-container')) return;

            const container = document.createElement('div');
            container.className = 'download-container';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'download-checkbox';
            
            // 阻止事件冒泡
            container.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            container.appendChild(checkbox);
            
            // 获取文件名和路径
            const titleSpan = item.querySelector('.hope-c-PJLV-iwljog-css');
            const pathText = item.querySelector('.hope-c-PJLV-ibveQmV-css');
            
            if (titleSpan) {
                checkbox.title = titleSpan.textContent;
            }
            
            // 将复选框插入到文件图标后面
            const icon = item.querySelector('.hope-icon');
            if (icon) {
                icon.parentNode.insertBefore(container, icon.nextSibling);
            } else {
                item.insertBefore(container, item.firstChild);
            }

            // 添加点击事件
            checkbox.addEventListener('change', () => {
                container.classList.toggle('selected', checkbox.checked);
                item.classList.toggle('selected-item', checkbox.checked);
            });
        });

        // 如果按钮容器不存在才添加
        if (!document.getElementById('batchButtons')) {
            const buttonsContainer = document.createElement('div');
            buttonsContainer.id = 'batchButtons';

            const selectAllBtn = createButton('全选', toggleSelectAll);
            const invertSelectBtn = createButton('反选', invertSelection);
            const getLinksBtn = createButton('获取下载链接', getDownloadLinks);
            const saveLinksBtn = createButton('保存链接文本', saveLinksToFile);

            buttonsContainer.appendChild(selectAllBtn);
            buttonsContainer.appendChild(invertSelectBtn);
            buttonsContainer.appendChild(getLinksBtn);
            buttonsContainer.appendChild(saveLinksBtn);
            document.body.appendChild(buttonsContainer);
        }
    }

    // 创建按钮
    function createButton(text, onClick) {
        const button = document.createElement('button');
        button.className = 'batch-btn';
        button.textContent = text;
        button.addEventListener('click', onClick);
        return button;
    }

    // 全选/取消全选
    function toggleSelectAll() {
        const checkboxes = document.querySelectorAll('.download-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(checkbox => {
            checkbox.checked = !allChecked;
            checkbox.dispatchEvent(new Event('change'));
        });
    }

    // 反选
    function invertSelection() {
        const checkboxes = document.querySelectorAll('.download-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });
    }

    // 修改链接处理函数
    function processUrl(url) {
        let processedUrl = url;
        for (const rule of urlProcessRules) {
            try {
                processedUrl = processedUrl.replace(rule.pattern, rule.replacement);
                debugLog(`应用规则: ${rule.name}`, {
                    before: url,
                    after: processedUrl
                });
            } catch (error) {
                errorLog(`规则 "${rule.name}" 处理失败`, error);
            }
        }
        return processedUrl;
    }

    // 修改获取下载链接的函数
    async function getDownloadLinks() {
        const selectedItems = document.querySelectorAll('.download-checkbox:checked');
        if (selectedItems.length === 0) {
            showNotification('请先选择要下载的项目');
            return;
        }

        const links = [];
        let processedCount = 0;
        let failedCount = 0;
        const progressBar = createProgressBar(selectedItems.length);

        for (const checkbox of selectedItems) {
            const item = checkbox.closest('.hope-stack.hope-c-dhzjXW.hope-c-PJLV-idcOWKd-css');
            if (!item) {
                errorLog('未找到item元素');
                failedCount++;
                continue;
            }

            try {
                const titleSpan = item.querySelector('.hope-c-PJLV-iwljog-css');
                const fileName = titleSpan ? titleSpan.textContent : `文件 ${processedCount + 1}`;
                
                const href = item.getAttribute('href');
                if (href) {
                    const fullUrl = window.location.origin + href;
                    // 处理URL
                    const processedUrl = processUrl(fullUrl);
                    links.push(processedUrl);
                    processedCount++;
                    addLog(progressBar, `成功获取链接: ${fileName}`, 'success');
                    debugLog(`原始链接`, fullUrl);
                    debugLog(`处理后的链接`, processedUrl);
                } else {
                    failedCount++;
                    addLog(progressBar, `获取链接失败: ${fileName}`, 'error');
                    errorLog(`未找到href属性`, fileName);
                }
            } catch (error) {
                failedCount++;
                addLog(progressBar, `处理失败: ${error.message}`, 'error');
                errorLog(`处理失败`, error);
            }

            updateProgressBar(progressBar, processedCount + failedCount, selectedItems.length);
            await delay(100);
        }

        if (links.length > 0) {
            // 在日志中显示链接处理信息
            addLog(progressBar, `链接处理完成，已添加下载路径`, 'success');
            addLog(progressBar, `全部完成！成功: ${links.length}, 失败: ${failedCount}`, 'success');
            await delay(1000);
            GM_setClipboard(links.join('\n'));
            showNotification(`成功复制 ${links.length} 个链接${failedCount > 0 ? `，${failedCount}个失败` : ''}`);
        } else {
            addLog(progressBar, '未能获取到任何链接', 'error');
            showNotification('未能获取到任何链接');
        }

        await delay(2000);
        progressBar.remove();
    }

    // 生成人类可读的时间戳
    function getHumanReadableTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        const second = String(now.getSeconds()).padStart(2, '0');
        return `${year}${month}${day}_${hour}${minute}${second}`;
    }

    // 获取搜索框文本
    function getSearchText() {
        const searchInput = document.querySelector('#search-input');
        return searchInput ? searchInput.value.trim() : '未命名搜索';
    }

    // 保存链接到文本文件
    async function saveLinksToFile() {
        const selectedItems = document.querySelectorAll('.download-checkbox:checked');
        if (selectedItems.length === 0) {
            showNotification('请先选择要下载的项目');
            return;
        }

        const links = [];
        let processedCount = 0;
        let failedCount = 0;
        const progressBar = createProgressBar(selectedItems.length);

        for (const checkbox of selectedItems) {
            const item = checkbox.closest('.hope-stack.hope-c-dhzjXW.hope-c-PJLV-idcOWKd-css');
            if (!item) {
                errorLog('未找到item元素');
                failedCount++;
                continue;
            }

            try {
                const titleSpan = item.querySelector('.hope-c-PJLV-iwljog-css');
                const fileName = titleSpan ? titleSpan.textContent : `文件 ${processedCount + 1}`;
                
                const href = item.getAttribute('href');
                if (href) {
                    const fullUrl = window.location.origin + href;
                    const processedUrl = processUrl(fullUrl);
                    links.push(processedUrl);
                    processedCount++;
                    addLog(progressBar, `成功获取链接: ${fileName}`, 'success');
                } else {
                    failedCount++;
                    addLog(progressBar, `获取链接失败: ${fileName}`, 'error');
                }
            } catch (error) {
                failedCount++;
                addLog(progressBar, `处理失败: ${error.message}`, 'error');
            }

            updateProgressBar(progressBar, processedCount + failedCount, selectedItems.length);
            await delay(100);
        }

        if (links.length > 0) {
            const searchText = getSearchText();
            const timestamp = getHumanReadableTimestamp();
            const fileName = `${searchText}_${timestamp}.txt`;
            
            // 创建Blob对象
            const blob = new Blob([links.join('\n')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            
            // 创建下载链接
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            addLog(progressBar, `已保存文件: ${fileName}`, 'success');
            showNotification(`已保存 ${links.length} 个链接到文件`);
        } else {
            addLog(progressBar, '未能获取到任何链接', 'error');
            showNotification('未能获取到任何链接');
        }

        await delay(2000);
        progressBar.remove();
    }

    // 创建进度条
    function createProgressBar(total) {
        const container = document.createElement('div');
        container.className = 'progress-container';
        container.innerHTML = `
            <div class="progress-log"></div>
            <div class="progress-bar">
                <div class="progress"></div>
                <div class="progress-text">0/${total}</div>
            </div>
        `;
        document.body.appendChild(container);
        return container;
    }

    // 更新进度条
    function updateProgressBar(progressBar, current, total) {
        const progress = progressBar.querySelector('.progress');
        const text = progressBar.querySelector('.progress-text');
        const percentage = (current / total) * 100;
        progress.style.width = percentage + '%';
        text.textContent = `${current}/${total}`;
    }

    // 添加日志函数
    function addLog(container, message, type = 'info') {
        const logArea = container.querySelector('.progress-log');
        const logItem = document.createElement('div');
        logItem.className = `progress-log-item ${type}`;
        logItem.textContent = message;
        logArea.appendChild(logItem);
        logArea.scrollTop = logArea.scrollHeight;
    }

    // 显示通知
    function showNotification(message) {
        if (Config.notificationEnabled) {
            GM_notification({
                title: 'A-list下载助手',
                text: message,
                timeout: 2000
            });
        }
    }

    // 添加调试日志函数
    function debugLog(message, data = null) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        if (data) {
            console.log(`[${timestamp}] 🔍 ${message}:`, data);
        } else {
            console.log(`[${timestamp}] ℹ️ ${message}`);
        }
    }

    // 添加错误日志函数
    function errorLog(message, error = null) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        if (error) {
            console.error(`[${timestamp}] ❌ ${message}:`, error);
            console.error('Stack:', error.stack);
        } else {
            console.error(`[${timestamp}] ❌ ${message}`);
        }
    }

    // 启动脚本
    waitForSearchResults();

    // 监听页面变化
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                const searchResults = document.querySelectorAll('.hope-stack.hope-c-dhzjXW.hope-c-PJLV-idcOWKd-css');
                if (searchResults.length > 0) {
                    searchResults.forEach(item => {
                        // 检查是否已经添加了下载容器
                        if (!item.querySelector('.download-container')) {
                            initializeInterface([item]);
                        }
                    });
                }
            }
        }
    });

    // 设置观察选项
    const config = {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false
    };

    // 开始观察
    observer.observe(document.body, config);

    // 添加路由变化监听
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            debugLog('URL changed, reinitializing interface');
            setTimeout(waitForSearchResults, 500);
        }
    }).observe(document, {subtree: true, childList: true});
})(); 