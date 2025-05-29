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

(async function() {
    'use strict';

    // 添加开关状态管理
    let isEnabled = GM_getValue('PostCoverPreviewEnabled', true);
    const MAX_CONCURRENT_REQUESTS = 5; // 最大并发请求数

    function log(message, data) {
        console.log(`[PostCoverPreview] ${message}`, data || '');
    }

    // 创建开关按钮
    function createToggleButton() {
        const button = document.createElement('button');
        button.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            padding: 5px 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            background: ${isEnabled ? '#4CAF50' : '#f44336'};
            color: white;
            cursor: pointer;
            font-size: 12px;
        `;
        button.textContent = isEnabled ? '预览：开启' : '预览：关闭';
        
        button.onclick = () => {
            isEnabled = !isEnabled;
            GM_setValue('PostCoverPreviewEnabled', isEnabled);
            button.textContent = isEnabled ? '预览：开启' : '预览：关闭';
            button.style.background = isEnabled ? '#4CAF50' : '#f44336';
            
            if (isEnabled) {
                addCoverPreviews();
            } else {
                // 移除所有预览
                document.querySelectorAll('.post-cover-preview').forEach(el => el.remove());
            }
        };
        
        document.body.appendChild(button);
    }

    // 自动点击展开按钮
    function clickExpandButtons() {
        const expandButtons = document.querySelectorAll('a.rinsp-thread-populate-button');
        expandButtons.forEach(button => {
            if (button.textContent === '展开') {
                log('点击展开按钮');
                button.click();
            }
        });
    }

    async function fetchPostAsDom(href) {
        try {
            log('获取帖子:', href);
            let post = await fetch(href);
            let text = await post.text();
            let parser = new DOMParser();
            let doc = parser.parseFromString(text, 'text/html');
            return doc;
        } catch (error) {
            log('获取失败:', error);
            return null;
        }
    }

    async function checkImageValid(url) {
        return new Promise((resolve) => {
            const tempImg = new Image();
            tempImg.onload = () => {
                // 检查图片是否有实际尺寸
                if (tempImg.naturalWidth > 0) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            };
            tempImg.onerror = () => resolve(false);
            tempImg.src = url;
        });
    }

    // 添加并发控制函数
    async function asyncPool(poolLimit, array, iteratorFn) {
        const ret = [];
        const executing = new Set();
        for (const item of array) {
            const p = Promise.resolve().then(() => iteratorFn(item));
            ret.push(p);
            executing.add(p);
            const clean = () => executing.delete(p);
            p.then(clean).catch(clean);
            if (executing.size >= poolLimit) {
                await Promise.race(executing);
            }
        }
        return Promise.all(ret);
    }

    // 处理单个链接的函数
    async function processLink(linkData) {
        const { link, previewDiv, img, loadingText } = linkData;
        
        try {
            let postDoc = await fetchPostAsDom(link.href);
            if (!postDoc) return;

            // 先尝试找备用图床的图片
            let backupImages = postDoc.evaluate(
                "//div[contains(text(), '备用图床')]/ancestor::tr/following-sibling::tr//img",
                postDoc,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );

            let imgSrc = null;
            if (backupImages.snapshotLength > 0) {
                imgSrc = backupImages.snapshotItem(0).src;
                log('找到备用图床图片:', imgSrc);
            } else {
                // 如果没有备用图床,则使用第一张普通图片
                let firstImg = postDoc.querySelector('div#read_tpc img:not([src*="face"]):not([src*="logo"])');
                if (firstImg) {
                    imgSrc = firstImg.src;
                    log('使用普通图片:', imgSrc);
                }
            }

            if (imgSrc) {
                const isValid = await checkImageValid(imgSrc);
                if (isValid) {
                    img.src = imgSrc;
                    loadingText.textContent = '加载完成';
                    loadingText.style.color = 'green';
                } else {
                    previewDiv.remove();
                }
            } else {
                previewDiv.remove();
            }
        } catch (error) {
            previewDiv.remove();
            log('处理失败:', error);
        }
    }

    async function addCoverPreviews() {
        if (!isEnabled) {
            log('预览功能已关闭');
            return;
        }

        // 先尝试点击展开按钮
        clickExpandButtons();

        // 根据当前页面URL选择不同的处理策略
        const isUserTopicPage = window.location.href.includes('u.php?');
        
        let targetTables = [];
        if (isUserTopicPage) {
            targetTables = Array.from(document.querySelectorAll('table')).filter(table => {
                return table.querySelector('a[href*="read.php?tid"]') !== null;
            });
            log('用户发帖页面 - 找到表格数量:', targetTables.length);
        } else {
            let tables = document.querySelectorAll('table');
            for (let table of tables) {
                if (table.textContent.includes('最近7日资源列表')) {
                    targetTables.push(table);
                    log('找到目标表格');
                    break;
                }
            }
        }

        if (targetTables.length === 0) {
            log('未找到目标表格');
            return;
        }

        for (let targetTable of targetTables) {
            let links = isUserTopicPage
                ? targetTable.querySelectorAll('a[href*="read.php?tid"]')
                : Array.from(targetTable.querySelectorAll('a[href*="read.php?tid="] > span[style*="color:#ff0000"]')).map(span => span.parentElement);

            log('找到资源链接数量:', links.length);

            // 准备并行处理的数据
            const linksData = Array.from(links).map(link => {
                // 在用户发帖页面检查链接所在行的文本
                if (isUserTopicPage) {
                    // 获取链接所在行的所有文本
                    const parentText = link.parentElement?.textContent || '';
                    if (parentText.includes('xxx xxx') || parentText.includes('----') || /xxx\s+xxx/i.test(parentText)) {
                        log('跳过特殊标记的链接:', parentText);
                        return null;
                    }
                }

                // 检查是否已经添加过预览
                let existingPreview = link.parentElement.querySelector('.post-cover-preview');
                if (existingPreview) {
                    return null;
                }

                // 创建预览容器
                let previewDiv = document.createElement('div');
                previewDiv.className = 'post-cover-preview';
                previewDiv.style.cssText = `
                    margin: 5px 0 15px 20px;
                    padding: 5px;
                    border: 1px solid #ccc;
                    background: #fff;
                    display: block !important;
                `;

                // 创建预览图片
                let img = document.createElement('img');
                img.style.cssText = `
                    max-width: 200px;
                    max-height: 300px;
                    border: 1px solid #ccc;
                    display: block !important;
                `;
                img.src = 'https://img.chkaja.com/adcadfc7898c229f.png';

                // 添加加载提示
                let loadingText = document.createElement('div');
                loadingText.textContent = '加载中...';
                loadingText.style.cssText = `
                    margin: 5px 0;
                    color: #666;
                `;

                previewDiv.appendChild(img);
                previewDiv.appendChild(loadingText);

                // 插入预览容器
                let inserted = false;
                
                // 策略1：在链接后的<br>之后插入
                let nextBr = link.nextSibling;
                while (nextBr && nextBr.tagName !== 'BR') {
                    nextBr = nextBr.nextSibling;
                }
                if (nextBr && nextBr.nextSibling) {
                    nextBr.parentNode.insertBefore(previewDiv, nextBr.nextSibling);
                    inserted = true;
                }

                // 策略2：在链接所在的TD或最近的父容器中插入
                if (!inserted) {
                    let container = link.closest('td') || link.parentElement;
                    if (container) {
                        container.appendChild(previewDiv);
                        inserted = true;
                    }
                }

                // 策略3：直接在链接后插入
                if (!inserted) {
                    link.parentNode.insertBefore(previewDiv, link.nextSibling);
                }

                return {
                    link,
                    previewDiv,
                    img,
                    loadingText
                };
            }).filter(data => data !== null);

            // 并行处理所有链接，限制并发数
            await asyncPool(MAX_CONCURRENT_REQUESTS, linksData, processLink);
        }
    }

    // 执行主函数
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            createToggleButton();
            addCoverPreviews();
        });
    } else {
        createToggleButton();
        addCoverPreviews();
    }

    // 监听动态加载的内容
    const observer = new MutationObserver((mutations) => {
        for (let mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                // 检查是否有新的展开按钮出现
                const hasNewExpandButton = Array.from(mutation.addedNodes).some(node => {
                    if (node.nodeType === 1) { // 元素节点
                        return node.querySelector?.('a.rinsp-thread-populate-button') !== null;
                    }
                    return false;
                });

                if (hasNewExpandButton && isEnabled) {
                    log('检测到新的展开按钮');
                    setTimeout(() => {
                        clickExpandButtons();
                        addCoverPreviews();
                    }, 500); // 延迟执行以确保内容加载完成
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    log('脚本已加载');
})();
