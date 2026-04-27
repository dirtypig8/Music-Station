// ============================================================
// YouTube 點歌系統 - 前端 JavaScript
// ============================================================

(function () {
    'use strict';

    // ---------- 狀態 ----------
    var ws = null;
    var state = {
        now_playing: null,
        queue: [],
        history: [],
        is_paused: false,
        volume: 80,
        time_pos: null,
        duration: null,
        online_count: 0
    };
    var reconnectTimer = null;
    var reconnectDelay = 1000;
    var isAdmin = false;

    // ---------- DOM 元素 ----------
    var $urlInput = document.getElementById('urlInput');
    var $requesterInput = document.getElementById('requesterInput');
    var $submitBtn = document.getElementById('submitBtn');
    var $nowPlaying = document.getElementById('nowPlaying');
    var $queueList = document.getElementById('queueList');
    var $queueCount = document.getElementById('queueCount');
    var $queueEmpty = document.getElementById('queueEmpty');
    var $connectionStatus = document.getElementById('connectionStatus');
    var $pauseBtn = document.getElementById('pauseBtn');
    var $volumeSlider = document.getElementById('volumeSlider');
    var $volumeValue = document.getElementById('volumeValue');
    var $toastContainer = document.getElementById('toastContainer');
    var $onlineCount = document.getElementById('onlineCount');
    var $historyList = document.getElementById('historyList');
    var $historyCount = document.getElementById('historyCount');
    var $controlsBar = document.getElementById('controlsBar');
    var $adminLoginRow = document.getElementById('adminLoginRow');
    var $adminLoggedIn = document.getElementById('adminLoggedIn');
    var $adminPassword = document.getElementById('adminPassword');

    // ---------- 背景粒子 ----------
    function initParticles() {
        var container = document.getElementById('bgParticles');
        var colors = ['#7c3aed', '#a855f7', '#c084fc', '#40aaff', '#ff40aa'];
        for (var i = 0; i < 20; i++) {
            var p = document.createElement('div');
            p.className = 'particle';
            var size = Math.random() * 6 + 2;
            p.style.width = size + 'px';
            p.style.height = size + 'px';
            p.style.left = Math.random() * 100 + '%';
            p.style.background = colors[Math.floor(Math.random() * colors.length)];
            p.style.animationDuration = (Math.random() * 15 + 10) + 's';
            p.style.animationDelay = (Math.random() * 10) + 's';
            container.appendChild(p);
        }
    }

    // ---------- WebSocket ----------
    function connectWS() {
        var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        var url = protocol + '//' + location.host + '/ws';

        ws = new WebSocket(url);

        ws.onopen = function () {
            reconnectDelay = 1000;
            setConnectionStatus(true);
        };

        ws.onclose = function () {
            setConnectionStatus(false);
            scheduleReconnect();
        };

        ws.onerror = function () {
            setConnectionStatus(false);
        };

        ws.onmessage = function (event) {
            try {
                var msg = JSON.parse(event.data);
                handleMessage(msg);
            } catch (e) {
                console.error('解析訊息失敗:', e);
            }
        };
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connectWS();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
    }

    function setConnectionStatus(connected) {
        if (connected) {
            $connectionStatus.className = 'connection-status connected';
            $connectionStatus.querySelector('.status-text').textContent = '已連線';
        } else {
            $connectionStatus.className = 'connection-status';
            $connectionStatus.querySelector('.status-text').textContent = '連線中...';
        }
    }

    function sendMsg(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    // ---------- 訊息處理 ----------
    function handleMessage(msg) {
        switch (msg.type) {
            case 'state_update':
                state = msg.data;
                renderAll();
                break;
            case 'song_added':
                showToast('🎵 已加入: ' + msg.data.title, 'success');
                break;
            case 'error':
                showToast('❌ ' + msg.message, 'error');
                enableSubmit();
                break;
            case 'info':
                showToast('ℹ️ ' + msg.message, 'info');
                break;
            case 'admin_status':
                isAdmin = msg.is_admin;
                updateAdminUI();
                if (msg.message) {
                    showToast(msg.is_admin ? '✅ ' + msg.message : '❌ ' + msg.message,
                              msg.is_admin ? 'success' : 'error');
                }
                break;
        }
    }

    // ---------- 渲染 ----------
    function renderAll() {
        renderNowPlaying();
        renderQueue();
        renderHistory();
        renderControls();
    }

    function formatTime(seconds) {
        if (seconds == null || isNaN(seconds)) return '--:--';
        var s = Math.floor(seconds);
        var m = Math.floor(s / 60);
        s = s % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function renderNowPlaying() {
        var song = state.now_playing;
        if (!song) {
            $nowPlaying.innerHTML =
                '<div class="np-empty">' +
                '  <span class="np-empty-icon">🎶</span>' +
                '  <p>目前沒有播放中的歌曲</p>' +
                '  <p class="np-empty-hint">點一首歌開始吧！</p>' +
                '</div>';
            return;
        }

        var progress = 0;
        if (state.duration && state.time_pos != null) {
            progress = (state.time_pos / state.duration) * 100;
        }
        var pausedClass = state.is_paused ? ' paused' : '';

        var thumb = song.thumbnail || '';
        var thumbTag = thumb
            ? '<img class="np-thumbnail" src="' + escapeHtml(thumb) + '" alt="thumbnail">'
            : '<div class="np-thumbnail"></div>';

        $nowPlaying.innerHTML =
            '<div class="np-card">' +
            '  ' + thumbTag +
            '  <div class="np-info">' +
            '    <div class="np-title">' + escapeHtml(song.title) + '</div>' +
            '    <div class="np-meta">' +
            '      <span class="np-requester">🙋 ' + escapeHtml(song.requester || '匿名') + '</span>' +
            '      <span>' + formatTime(song.duration) + '</span>' +
            '    </div>' +
            '  </div>' +
            '  <div class="np-playing-indicator' + pausedClass + '">' +
            '    <div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>' +
            '  </div>' +
            '</div>' +
            '<div class="np-progress">' +
            '  <div class="np-progress-bar"><div class="np-progress-fill" style="width:' + progress + '%"></div></div>' +
            '  <div class="np-progress-time">' +
            '    <span>' + formatTime(state.time_pos) + '</span>' +
            '    <span>' + formatTime(state.duration) + '</span>' +
            '  </div>' +
            '</div>';
    }

    function renderQueue() {
        var queue = state.queue || [];
        $queueCount.textContent = queue.length;

        if (queue.length === 0) {
            $queueList.innerHTML =
                '<div class="queue-empty" id="queueEmpty">' +
                '  <span class="queue-empty-icon">📭</span>' +
                '  <p>佇列是空的</p>' +
                '</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < queue.length; i++) {
            var song = queue[i];
            var thumb = song.thumbnail || '';
            var thumbTag = thumb
                ? '<img class="qi-thumbnail" src="' + escapeHtml(thumb) + '" alt="">'
                : '<div class="qi-thumbnail"></div>';

            html +=
                '<div class="queue-item" data-id="' + song.id + '">' +
                '  <span class="qi-number">' + (i + 1) + '</span>' +
                '  ' + thumbTag +
                '  <div class="qi-info">' +
                '    <div class="qi-title">' + escapeHtml(song.title) + '</div>' +
                '    <div class="qi-meta">' +
                '      <span class="qi-requester">🙋 ' + escapeHtml(song.requester || '匿名') + '</span>' +
                '      <span>' + formatTime(song.duration) + '</span>' +
                '    </div>' +
                '  </div>' +
                (isAdmin ? '  <button class="qi-remove" onclick="removeSong(\'' + song.id + '\')" title="移除">✕</button>' : '') +
                '</div>';
        }
        $queueList.innerHTML = html;
    }

    function renderHistory() {
        var history = state.history || [];
        $historyCount.textContent = history.length;

        if (history.length === 0) {
            $historyList.innerHTML =
                '<div class="queue-empty">' +
                '  <span class="queue-empty-icon">🕐</span>' +
                '  <p>還沒有播放紀錄</p>' +
                '</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < history.length; i++) {
            var song = history[i];
            html +=
                '<div class="history-item">' +
                '  <span class="hi-played-at">' + escapeHtml(song.played_at || '') + '</span>' +
                '  <div class="hi-info">' +
                '    <div class="hi-title">' + escapeHtml(song.title) + '</div>' +
                '    <div class="hi-meta">' +
                '      <span>🙋 ' + escapeHtml(song.requester || '匿名') + '</span>' +
                '      <span>' + formatTime(song.duration) + '</span>' +
                '    </div>' +
                '  </div>' +
                '</div>';
        }
        $historyList.innerHTML = html;
    }

    function renderControls() {
        // 控制列只在管理員模式顯示
        if ($controlsBar) {
            if (isAdmin) {
                $controlsBar.classList.remove('hidden');
            } else {
                $controlsBar.classList.add('hidden');
            }
        }
        if ($pauseBtn) {
            $pauseBtn.textContent = state.is_paused ? '▶️' : '⏸️';
            $pauseBtn.title = state.is_paused ? '繼續' : '暫停';
        }
        if (state.volume != null) {
            $volumeSlider.value = state.volume;
            $volumeValue.textContent = Math.round(state.volume);
        }
        // 更新線上人數
        $onlineCount.textContent = state.online_count || 0;
    }

    // ---------- 操作 ----------
    function submitSong() {
        var url = $urlInput.value.trim();
        if (!url) {
            showToast('❌ 請輸入 YouTube 網址', 'error');
            $urlInput.focus();
            return;
        }
        if (!isValidYouTubeUrl(url)) {
            showToast('❌ 請輸入有效的 YouTube 網址', 'error');
            $urlInput.focus();
            return;
        }

        var requester = $requesterInput.value.trim() || '匿名';

        sendMsg({ type: 'add_song', url: url, requester: requester });
        $urlInput.value = '';
        disableSubmit();

        // 3 秒後自動恢復按鈕
        setTimeout(enableSubmit, 3000);
    }

    function skipSong() {
        sendMsg({ type: 'skip' });
    }

    function togglePause() {
        if (state.is_paused) {
            sendMsg({ type: 'resume' });
        } else {
            sendMsg({ type: 'pause' });
        }
    }

    function setVolume(val) {
        $volumeValue.textContent = val;
        sendMsg({ type: 'set_volume', volume: parseInt(val) });
    }

    function removeSong(id) {
        sendMsg({ type: 'remove_song', id: id });
    }

    function disableSubmit() {
        $submitBtn.disabled = true;
        $submitBtn.querySelector('.btn-text').textContent = '處理中...';
    }

    function enableSubmit() {
        $submitBtn.disabled = false;
        $submitBtn.querySelector('.btn-text').textContent = '點歌';
    }

    // ---------- YouTube URL 驗證 ----------
    function isValidYouTubeUrl(url) {
        var patterns = [
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?.*v=[\w-]+/,
            /(?:https?:\/\/)?youtu\.be\/[\w-]+/,
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/[\w-]+/,
            /(?:https?:\/\/)?music\.youtube\.com\/watch\?.*v=[\w-]+/,
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/[\w-]+/
        ];
        for (var i = 0; i < patterns.length; i++) {
            if (patterns[i].test(url)) return true;
        }
        return false;
    }

    // ---------- Toast 通知 ----------
    function showToast(message, type) {
        type = type || 'info';
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        $toastContainer.appendChild(toast);

        setTimeout(function () {
            toast.classList.add('toast-out');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 3500);
    }

    // ---------- 工具函式 ----------
    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ---------- 管理員 ----------
    function adminLogin() {
        var pwd = $adminPassword.value.trim();
        if (!pwd) {
            showToast('❌ 請輸入密碼', 'error');
            $adminPassword.focus();
            return;
        }
        sendMsg({ type: 'admin_login', password: pwd });
        $adminPassword.value = '';
    }

    function adminLogout() {
        sendMsg({ type: 'admin_logout' });
    }

    function updateAdminUI() {
        if (isAdmin) {
            $adminLoginRow.classList.add('hidden');
            $adminLoggedIn.classList.remove('hidden');
        } else {
            $adminLoginRow.classList.remove('hidden');
            $adminLoggedIn.classList.add('hidden');
        }
        renderControls();
        renderQueue();  // 重新渲染以顯示/隱藏移除按鈕
    }

    // ---------- 鍵盤事件 ----------
    $urlInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            submitSong();
        }
    });

    $adminPassword.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            adminLogin();
        }
    });

    // ---------- 全域函式 (供 HTML onclick 使用) ----------
    window.submitSong = submitSong;
    window.skipSong = skipSong;
    window.togglePause = togglePause;
    window.setVolume = setVolume;
    window.removeSong = removeSong;
    window.adminLogin = adminLogin;
    window.adminLogout = adminLogout;

    // ---------- 初始化 ----------
    initParticles();
    connectWS();

})();
