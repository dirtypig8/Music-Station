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
        online_count: 0,
        web_stream_url: ''
    };
    var reconnectTimer = null;
    var reconnectDelay = 1000;
    var isAdmin = false;
    var searchResults = [];

    // ---------- 瀏覽器收聽 ----------
    var audioPlayer = null;
    var isListening = false;
    var currentStreamSongId = null;
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var listenVolume = 80;

    // ---------- DOM 元素 ----------
    var $urlInput = document.getElementById('urlInput');
    var $requesterInput = document.getElementById('requesterInput');
    var $searchInput = document.getElementById('searchInput');
    var $searchBtn = document.getElementById('searchBtn');
    var $searchResults = document.getElementById('searchResults');
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
    var $shareUrl = document.getElementById('shareUrl');
    var $listenBtn = document.getElementById('listenBtn');
    var $listenIcon = document.getElementById('listenIcon');
    var $listenText = document.getElementById('listenText');
    var $listenVolumeWrap = document.getElementById('listenVolumeWrap');
    var $listenVolumeSlider = document.getElementById('listenVolumeSlider');
    var $listenVolumeValue = document.getElementById('listenVolumeValue');

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
                syncAudio();
                break;
            case 'song_added':
                showToast('🎵 已加入: ' + msg.data.title, 'success');
                break;
            case 'error':
                showToast('❌ ' + msg.message, 'error');
                enableSubmit();
                enableSearch();
                break;
            case 'info':
                showToast('ℹ️ ' + msg.message, 'info');
                break;
            case 'search_results':
                searchResults = msg.data || [];
                renderSearchResults(msg.keyword || '');
                enableSearch();
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
        renderListenUI();
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
                '  <button class="hi-readd" onclick="readdHistorySong(' + i + ')">再加入</button>' +
                '</div>';
        }
        $historyList.innerHTML = html;
    }

    function readdHistorySong(index) {
        var history = state.history || [];
        var song = history[index];
        if (!song || !song.url) {
            showToast('❌ 找不到可加入的歌曲來源', 'error');
            return;
        }

        sendMsg({
            type: 'add_song',
            url: song.url,
            requester: ($requesterInput.value || '').trim() || song.requester || '匿名'
        });
        showToast('✅ 已重新加入待播：' + (song.title || '未知標題'), 'success');
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

    // ---------- 瀏覽器收聽功能 ----------
    function toggleListening() {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    }

    function startListening() {
        isListening = true;
        if (!audioPlayer) {
            audioPlayer = new Audio();
            audioPlayer.volume = listenVolume / 100;
        }
        renderListenUI();
        syncAudio();
        showToast('🎧 已開啟瀏覽器收聽', 'success');
    }

    function stopListening() {
        isListening = false;
        currentStreamSongId = null;
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.removeAttribute('src');
            audioPlayer.load();
        }
        renderListenUI();
        showToast('🔇 已關閉瀏覽器收聽', 'info');
    }

    function syncAudio() {
        if (!isListening || !audioPlayer) return;

        // 沒有正在播放的歌 → 靜音
        if (!state.now_playing || !state.web_stream_url) {
            if (audioPlayer.src) {
                audioPlayer.pause();
                audioPlayer.removeAttribute('src');
                audioPlayer.load();
                currentStreamSongId = null;
            }
            return;
        }

        var songId = state.now_playing.id;

        // 歌曲切換 → 載入新音訊
        if (currentStreamSongId !== songId) {
            currentStreamSongId = songId;
            // 加上時間戳避免快取
            audioPlayer.src = state.web_stream_url + '?sid=' + songId + '&t=' + Date.now();
            audioPlayer.load();
            // 嘗試 seek 到目前位置
            if (state.time_pos != null && state.time_pos > 2) {
                audioPlayer.addEventListener('loadedmetadata', function seekOnce() {
                    audioPlayer.removeEventListener('loadedmetadata', seekOnce);
                    try { audioPlayer.currentTime = state.time_pos; } catch(e) {}
                });
            }
            audioPlayer.play().catch(function (e) {
                console.warn('自動播放被阻擋，請點擊收聽按鈕:', e);
                showToast('⚠️ 瀏覽器阻擋自動播放，請再點一次收聽按鈕', 'error');
            });
            return;
        }

        // 暫停/繼續 同步
        if (state.is_paused) {
            if (!audioPlayer.paused) audioPlayer.pause();
        } else {
            if (audioPlayer.paused && audioPlayer.src) {
                audioPlayer.play().catch(function () {});
            }
        }

        // 進度同步（偏差超過 5 秒才修正，避免頻繁 seek）
        if (state.time_pos != null && !isNaN(audioPlayer.currentTime) && audioPlayer.currentTime > 0) {
            var drift = Math.abs(audioPlayer.currentTime - state.time_pos);
            if (drift > 5) {
                try { audioPlayer.currentTime = state.time_pos; } catch(e) {}
            }
        }
    }

    function setListenVolume(val) {
        listenVolume = parseInt(val);
        if ($listenVolumeValue) $listenVolumeValue.textContent = val;
        if (audioPlayer) {
            audioPlayer.volume = listenVolume / 100;
        }
    }

    function renderListenUI() {
        if (!$listenBtn) return;

        if (isListening) {
            $listenBtn.classList.add('listening');
            $listenIcon.textContent = '🔊';
            $listenText.textContent = '收聽中';
            if (isIOS) {
                // iOS 不支援 JS 控制音量，顯示提示
                $listenVolumeWrap.classList.remove('hidden');
                $listenVolumeWrap.innerHTML = '<span class="listen-ios-hint">📱 請使用手機音量鍵調整音量</span>';
            } else {
                $listenVolumeWrap.classList.remove('hidden');
            }
        } else {
            $listenBtn.classList.remove('listening');
            $listenIcon.textContent = '🎧';
            $listenText.textContent = '點擊收聽';
            $listenVolumeWrap.classList.add('hidden');
        }
    }

    // ---------- 操作 ----------
    function searchYouTube() {
        var keyword = ($searchInput.value || '').trim();
        if (!keyword) {
            showToast('❌ 請輸入搜尋關鍵字', 'error');
            $searchInput.focus();
            return;
        }
        disableSearch();
        sendMsg({ type: 'search_youtube', keyword: keyword });
    }

    function renderSearchResults(keyword) {
        if (!searchResults.length) {
            $searchResults.classList.remove('hidden');
            $searchResults.innerHTML =
                '<div class="search-empty">找不到結果：' + escapeHtml(keyword) + '</div>';
            return;
        }

        var html = '<div class="search-results-title">搜尋結果：' + escapeHtml(keyword) + '</div>';
        for (var i = 0; i < searchResults.length; i++) {
            var item = searchResults[i];
            var thumbTag = item.thumbnail
                ? '<img class="sr-thumb" src="' + escapeHtml(item.thumbnail) + '" alt="">'
                : '<div class="sr-thumb"></div>';
            html +=
                '<button type="button" class="search-item" onclick="addSearchResult(' + i + ')">' +
                '  ' + thumbTag +
                '  <span class="sr-info">' +
                '    <span class="sr-title">' + escapeHtml(item.title || '未知標題') + '</span>' +
                '    <span class="sr-meta">' + escapeHtml(item.uploader || '未知頻道') + ' · ' + formatTime(item.duration || 0) + '</span>' +
                '  </span>' +
                '  <span class="sr-add">加入</span>' +
                '</button>';
        }
        $searchResults.classList.remove('hidden');
        $searchResults.innerHTML = html;
    }

    function addSearchResult(index) {
        var item = searchResults[index];
        if (!item || !item.url) return;
        $urlInput.value = item.url;
        submitSong();
    }

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
        $searchResults.classList.add('hidden');
        searchResults = [];
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

    function disableSearch() {
        $searchBtn.disabled = true;
        $searchBtn.textContent = '搜尋中...';
    }

    function enableSearch() {
        $searchBtn.disabled = false;
        $searchBtn.textContent = '搜尋';
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

    function loadAccessInfo() {
        if (!$shareUrl || !window.fetch) return;
        fetch('/api/access-info')
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (!data || !data.url) return;
                $shareUrl.href = data.url;
                $shareUrl.textContent = data.url;
            })
            .catch(function () {
                $shareUrl.textContent = location.origin;
                $shareUrl.href = location.origin;
            });
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

    $searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            searchYouTube();
        }
    });

    $adminPassword.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            adminLogin();
        }
    });

    // ---------- 全域函式 (供 HTML onclick 使用) ----------
    window.submitSong = submitSong;
    window.searchYouTube = searchYouTube;
    window.addSearchResult = addSearchResult;
    window.readdHistorySong = readdHistorySong;
    window.skipSong = skipSong;
    window.togglePause = togglePause;
    window.setVolume = setVolume;
    window.removeSong = removeSong;
    window.adminLogin = adminLogin;
    window.adminLogout = adminLogout;
    window.toggleListening = toggleListening;
    window.setListenVolume = setListenVolume;

    // ---------- 初始化 ----------
    initParticles();
    loadAccessInfo();
    connectWS();

})();
