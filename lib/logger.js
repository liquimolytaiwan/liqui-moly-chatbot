/**
 * LIQUI MOLY Chatbot - Logger Utility
 *
 * 可切換的日誌工具，透過環境變數控制日誌輸出
 *
 * 環境變數：
 * - LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' | 'none'
 * - 預設：development 環境為 'debug'，production 環境為 'warn'
 *
 * 使用方式（方法一：全域覆蓋）：
 * require('./lib/logger').patchConsole();
 * // 之後所有 console.log 會根據 LOG_LEVEL 決定是否輸出
 *
 * 使用方式（方法二：直接使用 logger）：
 * const logger = require('./lib/logger');
 * logger.debug('[Tag]', 'message');
 */

const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4
};

// 儲存原始 console 方法
const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

// 取得當前日誌等級
function getLogLevel() {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
        return LOG_LEVELS[envLevel];
    }
    // 預設：生產環境只顯示 warn 以上，開發環境顯示全部
    return process.env.NODE_ENV === 'production' ? LOG_LEVELS.warn : LOG_LEVELS.debug;
}

/**
 * 覆蓋 console.log/warn，根據 LOG_LEVEL 控制輸出
 * 在 API 檔案開頭呼叫一次即可
 */
function patchConsole() {
    const level = getLogLevel();

    // console.log → 視為 debug 等級
    console.log = (...args) => {
        if (level <= LOG_LEVELS.debug) {
            originalConsole.log(...args);
        }
    };

    // console.warn → 視為 warn 等級
    console.warn = (...args) => {
        if (level <= LOG_LEVELS.warn) {
            originalConsole.warn(...args);
        }
    };

    // console.error → 始終輸出（除非 LOG_LEVEL=none）
    console.error = (...args) => {
        if (level <= LOG_LEVELS.error) {
            originalConsole.error(...args);
        }
    };
}

/**
 * 還原 console 方法
 */
function restoreConsole() {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
}

// 直接使用的 logger 方法
const currentLevel = getLogLevel();

function debug(...args) {
    if (currentLevel <= LOG_LEVELS.debug) {
        originalConsole.log(...args);
    }
}

function info(...args) {
    if (currentLevel <= LOG_LEVELS.info) {
        originalConsole.log(...args);
    }
}

function warn(...args) {
    if (currentLevel <= LOG_LEVELS.warn) {
        originalConsole.warn(...args);
    }
}

function error(...args) {
    if (currentLevel <= LOG_LEVELS.error) {
        originalConsole.error(...args);
    }
}

module.exports = {
    patchConsole,
    restoreConsole,
    debug,
    info,
    warn,
    error,
    LOG_LEVELS,
    getLogLevel
};
