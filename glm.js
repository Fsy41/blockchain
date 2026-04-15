// ==UserScript==
// @name         智谱 GLM Coding 抢购助手 (数据拦截版)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  拦截并篡改服务器返回的数据流，让前端认为有货，激活按钮和支付逻辑
// @author       YourName
// @match        *://bigmodel.cn/*
// @match        *://www.bigmodel.cn/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    console.log('[抢购助手3.0] 网络拦截器启动...');

    // ==========================================
    // 工具函数：深度篡改售罄相关属性
    // ==========================================
    function deepModify(obj) {
        if (!obj || typeof obj !== 'object') return;

        // 篡改核心售罄标识
        if (obj.soldOut === true) obj.soldOut = false;
        if (obj.isSoldOut === true) obj.isSoldOut = false;
        if (obj.forbidden === true) obj.forbidden = false;
        if (obj.disabled === true) obj.disabled = false;

        // canPurchase: null 表示不可购买，改为 true
        if (obj.canPurchase === null || obj.canPurchase === false) {
            obj.canPurchase = true;
        }

        // canRepurchase: null 表示不可复购，改为 true
        if (obj.canRepurchase === null || obj.canRepurchase === false) {
            obj.canRepurchase = true;
        }

        // inCurrentPeriod / lastValid 也可能是判断条件
        if (obj.inCurrentPeriod === false && obj.soldOut !== undefined) {
            obj.inCurrentPeriod = true;
        }
        if (obj.lastValid === false && obj.soldOut !== undefined) {
            obj.lastValid = true;
        }

        // 递归处理所有子属性
        for (let key in obj) {
            if (obj[key] && typeof obj[key] === 'object') {
                deepModify(obj[key]);
            }
        }
    }

    // ==========================================
    // 战术一：拦截 JSON.parse
    // 覆盖浏览器原生解析，任何经过 JSON.parse 的数据都会被篡改
    // ==========================================
    const originalJSONParse = JSON.parse;
    JSON.parse = function(text, reviver) {
        let result = originalJSONParse(text, reviver);
        try { deepModify(result); } catch (e) {}
        return result;
    };

    // ==========================================
    // 战术二：拦截 Fetch 请求
    // ==========================================
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);

        // 优先检查 URL 是否为目标接口
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const isTargetApi = url.includes('batch-preview') || url.includes('pay') || url.includes('product');

        const contentType = response.headers.get('content-type') || '';

        // 放宽判断：目标接口 OR JSON 响应 都处理
        if (isTargetApi || contentType.includes('json') || contentType.includes('text/plain')) {
            const clone = response.clone();
            try {
                let text = await clone.text();

                // 检查是否含有售罄标记
                const hasSoldOut = text.includes('"soldOut":true') ||
                                   text.includes('"isSoldOut":true') ||
                                   text.includes('"canPurchase":null') ||
                                   text.includes('"forbidden":true') ||
                                   text.includes('"canRepurchase":null');

                if (hasSoldOut) {
                    console.log('[抢购助手] 拦截到 Fetch 售罄数据，正在篡改:', url);

                    // 字符串级别替换（最可靠）
                    text = text
                        .replace(/"soldOut":true/g, '"soldOut":false')
                        .replace(/"isSoldOut":true/g, '"isSoldOut":false')
                        .replace(/"canPurchase":null/g, '"canPurchase":true')
                        .replace(/"canPurchase":false/g, '"canPurchase":true')
                        .replace(/"canRepurchase":null/g, '"canRepurchase":true')
                        .replace(/"canRepurchase":false/g, '"canRepurchase":true')
                        .replace(/"forbidden":true/g, '"forbidden":false')
                        .replace(/"inCurrentPeriod":false/g, '"inCurrentPeriod":true')
                        .replace(/"lastValid":false/g, '"lastValid":true');

                    return new Response(text, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }
            } catch (e) {
                console.log('[抢购助手] Fetch 拦截处理异常:', e);
            }
        }
        return response;
    };

    // ==========================================
    // 战术三：拦截 XMLHttpRequest
    // 使用重写 getter 的方式，确保框架读取到篡改后的数据
    // ==========================================
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._reqUrl = url;
        this._intercepted = false;
        return originalXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        const xhr = this;

        // 在 readyState 变化前就绑定，确保最先执行
        xhr.addEventListener('readystatechange', function() {
            if (xhr.readyState === 4 && xhr.status === 200 && !xhr._intercepted) {
                const contentType = xhr.getResponseHeader('content-type') || '';
                const url = xhr._reqUrl || '';
                const isTargetApi = url.includes('batch-preview') || url.includes('pay') || url.includes('product');

                if (isTargetApi || contentType.includes('json')) {
                    try {
                        let text = xhr.responseText;
                        const hasSoldOut = text.includes('"soldOut":true') ||
                                           text.includes('"canPurchase":null') ||
                                           text.includes('"forbidden":true');

                        if (hasSoldOut) {
                            console.log('[抢购助手] 拦截到 XHR 售罄数据，正在篡改:', url);
                            xhr._intercepted = true;

                            text = text
                                .replace(/"soldOut":true/g, '"soldOut":false')
                                .replace(/"isSoldOut":true/g, '"isSoldOut":false')
                                .replace(/"canPurchase":null/g, '"canPurchase":true')
                                .replace(/"canPurchase":false/g, '"canPurchase":true')
                                .replace(/"canRepurchase":null/g, '"canRepurchase":true')
                                .replace(/"canRepurchase":false/g, '"canRepurchase":true')
                                .replace(/"forbidden":true/g, '"forbidden":false')
                                .replace(/"inCurrentPeriod":false/g, '"inCurrentPeriod":true')
                                .replace(/"lastValid":false/g, '"lastValid":true');

                            // 重写 getter，让后续所有读取都拿到篡改后的数据
                            Object.defineProperty(xhr, 'responseText', {
                                get: function() { return text; },
                                configurable: true
                            });
                            Object.defineProperty(xhr, 'response', {
                                get: function() { return originalJSONParse(text); },
                                configurable: true
                            });
                        }
                    } catch (e) {
                        console.log('[抢购助手] XHR 拦截处理异常:', e);
                    }
                }
            }
        });

        return originalXHRSend.apply(xhr, args);
    };

    // ==========================================
    // 战术四：DOM 就绪后，强制修改页面上的售罄按钮
    // 兜底方案：如果前端框架渲染时已经忽略了我们的数据拦截，
    // 直接操作 DOM 强制显示按钮
    // ==========================================
    function forceShowButtons() {
        console.log('[抢购助手] 执行 DOM 强制修改...');

        // 移除所有 disabled 相关的样式类和属性
        document.querySelectorAll('[disabled]').forEach(el => {
            // 只处理看起来像购买按钮的元素
            const text = el.textContent || '';
            const isBuyButton = text.includes('购买') || text.includes('订阅') ||
                                text.includes('开通') || text.includes('立即') ||
                                el.classList.contains('buy') || el.classList.contains('purchase') ||
                                el.closest('[class*="price"]') || el.closest('[class*="product"]');

            if (isBuyButton) {
                el.removeAttribute('disabled');
                el.classList.remove('disabled', 'sold-out', 'is-disabled');
                el.style.pointerEvents = 'auto';
                el.style.opacity = '1';
                el.style.cursor = 'pointer';
                console.log('[抢购助手] 强制启用按钮:', text.trim().substring(0, 20));
            }
        });

        // 隐藏售罄标签
        document.querySelectorAll('[class*="sold"], [class*="soldout"], [class*="sold-out"]').forEach(el => {
            if (el.textContent.includes('售罄') || el.textContent.includes('已售完')) {
                el.style.display = 'none';
                console.log('[抢购助手] 隐藏售罄标签:', el.textContent.trim().substring(0, 20));
            }
        });
    }

    // DOM 加载完成后执行兜底修改
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(forceShowButtons, 1000);
            // 持续监听 DOM 变化，因为 SPA 可能动态渲染
            const observer = new MutationObserver(() => {
                clearTimeout(observer._timer);
                observer._timer = setTimeout(forceShowButtons, 500);
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
    } else {
        setTimeout(forceShowButtons, 1000);
        const observer = new MutationObserver(() => {
            clearTimeout(observer._timer);
            observer._timer = setTimeout(forceShowButtons, 500);
        });
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

})();
