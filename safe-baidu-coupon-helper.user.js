// ==UserScript==
// @name         百度网盘极速下载卷助手 (安全版)
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  一个安全、可靠的百度网盘极速下载卷自动领取脚本，代码完全开源，无任何外部依赖。
// @author       Gemini
// @match        *://pan.baidu.com/*
// @connect      wan.baidu.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @license      MIT
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    const CONFIG = {
        // 任务频道列表，从最新的脚本配置中获取
        channelArr: [10066, 10065],
        // 任务模块过滤器，只选择免费可用的任务
        taskModules: ["game_return_play", "new_game_play"],
    };

    // --- 工具函数 ---

    // 日志记录
    const log = (message, id = null) => {
        console.log(`[Baidu Helper] ${message}`);
        const logPanel = document.getElementById('gemini-helper-log');
        if (!logPanel) return;

        const time = new Date().toLocaleTimeString();
        const fullMessage = `[${time}] ${message}`;
        
        if (id) {
            let taskLogEntry = document.getElementById(id);
            // If the entry doesn't exist, create it
            if (!taskLogEntry) {
                taskLogEntry = document.createElement('div');
                taskLogEntry.id = id;
                logPanel.appendChild(taskLogEntry);
            }
            taskLogEntry.textContent = fullMessage;
        } else {
            const logEntry = document.createElement('div');
            logEntry.textContent = fullMessage;
            logPanel.appendChild(logEntry);
        }
        
        logPanel.scrollTop = logPanel.scrollHeight;
    };

    // 发起网络请求
    const httpRequest = (details) => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...details,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            resolve(JSON.parse(response.responseText));
                        } catch (e) {
                            log(`请求失败，无法解析响应: ${response.responseText}`);
                            reject(new Error("Response JSON parse error"));
                        }
                    } else {
                        log(`请求失败，状态码: ${response.status}`);
                        reject(new Error(`Request failed with status ${response.status}`));
                    }
                },
                onerror: (error) => {
                    log(`请求发生错误: ${error}`);
                    reject(error);
                }
            });
        });
    };

    // 获取今天的日期字符串，用于存储
    const getTodayKey = () => {
        const date = new Date();
        return `${date.getFullYear()}_${date.getMonth() + 1}_${date.getDate()}`;
    };

    // --- 核心逻辑 ---

    // 1. 获取所有可用的任务列表
    async function getAllTasks() {
        log("开始获取任务列表...");
        const allTasks = [];
        for (const channel of CONFIG.channelArr) {
            try {
                const url = `https://wan.baidu.com/gameapi?action=bonus_pan_task_list&channel=${channel}`;
                const response = await httpRequest({ 
                    method: "GET", 
                    url,
                    headers: {
                        "Content-Type": "application/json"
                    } 
                });
                if (response.errorNo === 0 && response.result && Array.isArray(response.result.data)) {
                    log(`成功获取来自频道 [${channel}] 的任务。`);
                    for (const taskGroup of response.result.data) {
                        if (Array.isArray(taskGroup.data)) {
                            allTasks.push(...taskGroup.data);
                        }
                    }
                } else {
                    log(`从频道 [${channel}] 获取任务失败或无任务: ${response.message || ''}`);
                }
            } catch (error) {
                log(`获取频道 [${channel}] 任务时出错。`);
            }
        }

        if (allTasks.length === 0) {
            log("未能获取到任何有效任务。");
            return [];
        }

        log(`共获取到 ${allTasks.length} 个初始任务。`);
        
        // 根据 taskModule 过滤出有效任务
        const filteredByModule = allTasks.filter(task => CONFIG.taskModules.includes(task.taskModule));
        log(`根据模块过滤后，剩下 ${filteredByModule.length} 个有效任务。`);

        if (filteredByModule.length === 0) {
            log("所有任务都已被模块过滤器排除。请检查 CONFIG.taskModules 配置。");
            return [];
        }
        
        // 过滤出今天尚未完成的任务
        const todayKey = getTodayKey();
        const completedTaskIds = await GM_getValue(todayKey, []);
        const validTasks = filteredByModule.filter(task => !completedTaskIds.includes(task.taskId));

        log(`其中 ${validTasks.length} 个是今天尚未完成的新任务。`);
        return validTasks;
    }

    // 2. 执行单个任务以获取奖励
    function startTask(task) {
        return new Promise(async (resolve) => {
            if (!task.taskGames || task.taskGames.length === 0) {
                log(`任务 [${task.taskId}] 没有可用的游戏，跳过。`);
                return resolve({ taskId: task.taskId, status: 'skipped' });
            }

            // 随机选择一个游戏来 "玩"
            const game = task.taskGames[Math.floor(Math.random() * task.taskGames.length)];
            const gameParams = new URLSearchParams(game.gameUrl.split('?')[1]);
            
            const taskId = task.taskId;
            const gameId = gameParams.get('gameId');
            const activityId = gameParams.get('activityId');
            const logId = `task-log-${taskId}`; // 为每个任务创建一个唯一的日志ID

            log(`开始执行任务 #${taskId} (游戏ID: ${gameId})`, logId);

            const report = async (isFirst) => {
                const reportParams = new URLSearchParams({
                    action: 'bonus_task_game_play_report',
                    gameId,
                    taskId,
                    activityId,
                    isFirstReport: isFirst ? '1' : '0',
                });
                
                try {
                    // 注意：这里的API调用没有加headers，因为httpRequest的实现是全局的，
                    // 而我们之前只在getAllTasks中加了headers。
                    // startTask中的API调用(bonus_task_game_play_report)可能不需要这个header。
                    // 如果执行失败，可以考虑在这里也加上。
                    const url = `https://wan.baidu.com/gameapi?${reportParams.toString()}`;
                    const response = await httpRequest({ method: "GET", url });

                    // 错误处理
                    if (response.errorNo !== 0) {
                        if (response.errorNo === 110008) {
                           log(`❌ 任务 #${taskId} 失败: 请先登录百度网盘网页版。`, logId);
                        } else {
                           log(`❌ 任务 #${taskId} 失败: ${response.message} (错误码: ${response.errorNo})`, logId);
                        }
                        return resolve({ taskId, status: 'error' });
                    }

                    // 任务已完成
                    if (response.result?.data?.remainingTaskTime === 0) {
                        log(`✅ 任务 #${taskId} 成功完成！`, logId);
                        const todayKey = getTodayKey();
                        const completed = await GM_getValue(todayKey, []);
                        if (!completed.includes(taskId)) {
                            completed.push(taskId);
                            await GM_setValue(todayKey, completed);
                        }
                        return resolve({ taskId, status: 'completed' });
                    }

                    // 任务进行中
                    if (response.result?.data?.nextReportInterval) {
                        const remainingTime = response.result.data.remainingTaskTime;
                        const totalTime = task.eachTaskNeedPlayTimeSecs;
                        const progress = Math.round(((totalTime - remainingTime) / totalTime) * 100);
                        log(`⏳ 任务 #${taskId} 进行中... 进度: ${progress}%`, logId);
                        
                        // 10秒后再次报告
                        setTimeout(() => report(false), 10000);
                    }

                } catch (error) {
                    log(`❌ 报告任务 #${taskId} 状态时发生网络错误。`, logId);
                    return resolve({ taskId, status: 'error' });
                }
            };

            // 发送第一次报告
            report(true);
        });
    }

    // --- UI界面 ---
    function setupUI() {
        GM_addStyle(`
            #gemini-helper-panel {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 350px;
                max-height: 400px;
                background-color: #f9f9f9;
                border: 1px solid #ccc;
                border-radius: 8px;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            }
            #gemini-helper-header {
                padding: 10px;
                background-color: #4a90e2;
                color: white;
                font-weight: bold;
                border-top-left-radius: 8px;
                border-top-right-radius: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            #gemini-helper-log {
                flex-grow: 1;
                height: 280px;
                overflow-y: auto;
                padding: 10px;
                font-size: 12px;
                line-height: 1.5;
                background-color: #fff;
                color: #333;
            }
            #gemini-helper-log div {
                padding-bottom: 5px;
                border-bottom: 1px solid #eee;
            }
            #gemini-helper-footer {
                padding: 10px;
                border-top: 1px solid #ccc;
            }
            #gemini-start-btn {
                width: 100%;
                padding: 10px;
                background-color: #5cb85c;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 14px;
                font-weight: bold;
            }
            #gemini-start-btn:disabled {
                background-color: #aaa;
                cursor: not-allowed;
            }
            #gemini-start-btn:hover:not(:disabled) {
                background-color: #4cae4c;
            }
            #gemini-close-btn {
                cursor: pointer;
                font-size: 18px;
                font-weight: bold;
            }
        `);

        const panel = document.createElement('div');
        panel.id = 'gemini-helper-panel';
        panel.innerHTML = `
            <div id="gemini-helper-header">
                <span>下载卷助手 (安全版)</span>
                <span id="gemini-close-btn" title="关闭">&times;</span>
            </div>
            <div id="gemini-helper-log"></div>
            <div id="gemini-helper-footer">
                <button id="gemini-start-btn">开始领取今日下载卷</button>
            </div>
        `;
        document.body.appendChild(panel);

        const startBtn = document.getElementById('gemini-start-btn');
        const closeBtn = document.getElementById('gemini-close-btn');

        startBtn.addEventListener('click', async () => {
            startBtn.disabled = true;
            startBtn.textContent = '正在领取中...';
            log("脚本已启动。");
            const tasks = await getAllTasks();
            if (tasks.length > 0) {
                log(`发现 ${tasks.length} 个可执行任务，开始处理...`);
                await Promise.all(tasks.map(task => startTask(task)));
                log("所有任务处理完毕。");
            } else {
                log("没有发现可执行的新任务。");
            }
            startBtn.textContent = '今日任务已完成';
        });
        
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });

        log("UI加载完成。请点击按钮开始。");
    }

    // --- 启动 ---
    // 模仿原脚本的逻辑，直接在页面加载完成后注入UI
    // 这样可以避免因页面结构变化导致选择器失效的问题
    window.addEventListener('load', () => {
        log("页面加载完成，开始注入UI...");
        setupUI();
    });

})();
