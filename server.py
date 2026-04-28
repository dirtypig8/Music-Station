#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
YouTube 點歌系統 - 主伺服器
使用 Tornado + mpv + yt-dlp
"""

import os
import sys
import json
import time
import uuid
import logging
import subprocess
import ctypes
import ctypes.wintypes
import threading
from concurrent.futures import ThreadPoolExecutor

import tornado.ioloop
import tornado.web
import tornado.websocket
import tornado.escape
import tornado.gen

# ============================================================
# 設定
# ============================================================
PORT = 8888
MPV_PIPE = r'\\.\pipe\mpv-music-server'
MPV_PATH = 'mpv'       # 假設 mpv 在 PATH 中
YTDLP_PATH = 'yt-dlp'  # 假設 yt-dlp 在 PATH 中
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.json')
ADMIN_PASSWORD = 'admin'  # 管理員密碼，請自行修改
MAX_DURATION_MINUTES = 10  # 歌曲最長限制（分鐘），設 0 表示不限制

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('MusicServer')

executor = ThreadPoolExecutor(max_workers=4)
YTDLP_TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.yt_tmp')
LOCAL_YTDLP_EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'yt-dlp.exe')

if os.path.exists(LOCAL_YTDLP_EXE):
    YTDLP_PATH = LOCAL_YTDLP_EXE


def run_ytdlp(args, timeout=30):
    """Run yt-dlp with a project-local temp directory to avoid extraction permission issues."""
    if not os.path.exists(YTDLP_TEMP_DIR):
        os.makedirs(YTDLP_TEMP_DIR, exist_ok=True)

    env = os.environ.copy()
    env['TMP'] = YTDLP_TEMP_DIR
    env['TEMP'] = YTDLP_TEMP_DIR
    return subprocess.run(
        [YTDLP_PATH] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        env=env
    )


# ============================================================
# mpv 播放器控制（透過 Windows Named Pipe IPC）
# ============================================================
class MpvController(object):
    """透過 Windows Named Pipe 控制 mpv 播放器"""

    GENERIC_READ = 0x80000000
    GENERIC_WRITE = 0x40000000
    OPEN_EXISTING = 3

    def __init__(self, mpv_path=MPV_PATH, pipe_name=MPV_PIPE):
        self.mpv_path = mpv_path
        self.pipe_name = pipe_name
        self.process = None
        self._lock = threading.Lock()
        self._k32 = ctypes.windll.kernel32
        self._k32.CreateFileW.restype = ctypes.c_void_p

    def start(self):
        """啟動 mpv（idle 模式）"""
        if self.process and self.process.poll() is None:
            return True

        cmd = [
            self.mpv_path,
            '--idle=yes',
            '--no-video',
            '--no-terminal',
            '--really-quiet',
            '--input-ipc-server={}'.format(self.pipe_name),
            '--volume=80',
        ]

        try:
            # DETACHED_PROCESS = 0x00000008
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=0x00000008
            )
            time.sleep(2)
            logger.info("mpv 已啟動 (PID: %d)", self.process.pid)
            return True
        except FileNotFoundError:
            logger.error("找不到 mpv，請確認已安裝並加入 PATH")
            return False
        except Exception as e:
            logger.error("啟動 mpv 失敗: %s", e)
            return False

    def stop_process(self):
        """關閉 mpv 程序"""
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None

    def _ipc(self, command):
        """透過 Named Pipe 發送指令並取得回應"""
        with self._lock:
            handle = None
            try:
                handle = self._k32.CreateFileW(
                    self.pipe_name,
                    self.GENERIC_READ | self.GENERIC_WRITE,
                    0, None, self.OPEN_EXISTING, 0, None
                )
                # INVALID_HANDLE_VALUE
                if handle is None or handle == 0xFFFFFFFF or handle == 0xFFFFFFFFFFFFFFFF:
                    return None

                msg = json.dumps({"command": command, "request_id": 1}) + "\n"
                msg_bytes = msg.encode('utf-8')
                written = ctypes.wintypes.DWORD()
                self._k32.WriteFile(
                    ctypes.c_void_p(handle), msg_bytes, len(msg_bytes),
                    ctypes.byref(written), None
                )

                buf = ctypes.create_string_buffer(65536)
                read_bytes = ctypes.wintypes.DWORD()
                self._k32.ReadFile(
                    ctypes.c_void_p(handle), buf, 65536,
                    ctypes.byref(read_bytes), None
                )

                if read_bytes.value > 0:
                    text = buf.raw[:read_bytes.value].decode('utf-8', errors='replace')
                    for line in text.strip().split('\n'):
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            if data.get('request_id') == 1:
                                return data
                        except (ValueError, KeyError):
                            continue
                return None
            except Exception as e:
                logger.debug("IPC 錯誤: %s", e)
                return None
            finally:
                if handle and handle not in (0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF):
                    self._k32.CloseHandle(ctypes.c_void_p(handle))

    def _fire(self, command):
        """發送指令（不等待回應）"""
        with self._lock:
            try:
                msg = json.dumps({"command": command}) + "\n"
                with open(self.pipe_name, 'wb', buffering=0) as f:
                    f.write(msg.encode('utf-8'))
                return True
            except Exception:
                return False

    def loadfile(self, url, mode='replace'):
        return self._fire(["loadfile", url, mode])

    def pause(self):
        return self._fire(["set_property", "pause", True])

    def resume(self):
        return self._fire(["set_property", "pause", False])

    def stop_playback(self):
        return self._fire(["stop"])

    def set_volume(self, vol):
        vol = max(0, min(150, int(vol)))
        return self._fire(["set_property", "volume", vol])

    def get_property(self, name):
        result = self._ipc(["get_property", name])
        if result and result.get('error') == 'success':
            return result.get('data')
        return None

    def is_idle(self):
        val = self.get_property("idle-active")
        return val is True

    def is_paused(self):
        val = self.get_property("pause")
        return val is True

    def get_time_pos(self):
        return self.get_property("time-pos")

    def get_duration(self):
        return self.get_property("duration")

    def get_volume(self):
        val = self.get_property("volume")
        return val if val is not None else 80


# ============================================================
# yt-dlp 影片資訊擷取
# ============================================================
def fetch_video_info(url):
    """使用 yt-dlp 執行檔取得影片資訊（在背景執行緒中呼叫）"""
    try:
        result = run_ytdlp(['-j', '--no-playlist', url], timeout=30)
        if result.returncode != 0:
            logger.error("yt-dlp 失敗: %s", result.stderr.decode('utf-8', errors='replace'))
            return None

        info = json.loads(result.stdout.decode('utf-8', errors='replace'))
        return {
            'id': str(uuid.uuid4())[:8],
            'url': url,
            'title': info.get('title', '未知標題'),
            'duration': info.get('duration', 0),
            'thumbnail': info.get('thumbnail', ''),
            'uploader': info.get('uploader', ''),
        }
    except subprocess.TimeoutExpired:
        logger.error("yt-dlp 逾時")
        return None
    except Exception as e:
        logger.error("取得影片資訊失敗: %s", e)
        return None


def search_youtube_candidates(keyword, limit=8):
    """使用 yt-dlp 搜尋 YouTube，回傳可直接加入佇列的候選清單。"""
    keyword = (keyword or '').strip()
    if not keyword:
        return []

    limit = max(1, min(15, int(limit)))
    query = 'ytsearch{}:{}'.format(limit, keyword)
    try:
        result = run_ytdlp(['-J', '--flat-playlist', '--no-warnings', query], timeout=30)
        if result.returncode != 0:
            logger.error("yt-dlp 搜尋失敗: %s", result.stderr.decode('utf-8', errors='replace'))
            return None

        payload = json.loads(result.stdout.decode('utf-8', errors='replace'))
        entries = payload.get('entries', []) or []
        candidates = []
        for item in entries:
            vid = item.get('id')
            if not vid:
                continue
            candidates.append({
                'id': vid,
                'title': item.get('title') or '未知標題',
                'uploader': item.get('uploader') or '',
                'duration': item.get('duration') or 0,
                'url': 'https://www.youtube.com/watch?v={}'.format(vid),
                'thumbnail': 'https://i.ytimg.com/vi/{}/hqdefault.jpg'.format(vid),
            })
        return candidates
    except subprocess.TimeoutExpired:
        logger.error("yt-dlp 搜尋逾時")
        return None
    except Exception as e:
        logger.error("搜尋 YouTube 失敗: %s", e)
        return None


# ============================================================
# 歌曲佇列管理
# ============================================================
class SongQueue(object):
    """管理歌曲佇列與播放狀態"""

    MAX_HISTORY = 50  # 最多保留幾筆歷史紀錄

    def __init__(self, mpv):
        self.mpv = mpv
        self.queue = []           # 等待播放的歌曲列表
        self.now_playing = None   # 目前播放中的歌曲
        self.history = []         # 已播放過的歌曲紀錄
        self.is_paused = False
        self._lock = threading.Lock()
        self._load()  # 啟動時載入已儲存的資料

    def _save(self):
        """將佇列和紀錄儲存到 JSON 檔案"""
        try:
            data = {
                'queue': list(self.queue),
                'history': list(self.history),
            }
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.debug("儲存資料失敗: %s", e)

    def _load(self):
        """從 JSON 檔案載入佇列和紀錄"""
        try:
            if os.path.exists(DATA_FILE):
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.queue = data.get('queue', [])
                self.history = data.get('history', [])
                logger.info("已載入資料: %d 首待播, %d 筆紀錄",
                            len(self.queue), len(self.history))
        except Exception as e:
            logger.error("載入資料失敗: %s", e)

    def add(self, song_info):
        with self._lock:
            self.queue.append(song_info)
            logger.info("歌曲已加入佇列: %s", song_info['title'])
            self._save()

    def remove(self, song_id):
        with self._lock:
            self.queue = [s for s in self.queue if s['id'] != song_id]
            self._save()

    def _add_to_history(self, song):
        """將歌曲加入播放紀錄"""
        if song:
            import copy
            record = copy.copy(song)
            record['played_at'] = time.strftime('%H:%M:%S')
            self.history.insert(0, record)
            # 限制紀錄數量
            if len(self.history) > self.MAX_HISTORY:
                self.history = self.history[:self.MAX_HISTORY]
            self._save()

    def skip(self):
        """跳過目前歌曲"""
        self._add_to_history(self.now_playing)
        self.mpv.stop_playback()
        self.now_playing = None
        self.is_paused = False

    def pause(self):
        self.mpv.pause()
        self.is_paused = True

    def resume(self):
        self.mpv.resume()
        self.is_paused = False

    def set_volume(self, vol):
        self.mpv.set_volume(vol)

    def play_next(self):
        """播放佇列中的下一首歌"""
        with self._lock:
            if not self.queue:
                self.now_playing = None
                return False
            self.now_playing = self.queue.pop(0)
            self.is_paused = False

        url = self.now_playing['url']
        logger.info("開始播放: %s", self.now_playing['title'])
        self.mpv.loadfile(url)
        self._save()
        return True

    def check_and_play_next(self):
        """檢查目前是否播完，若是則播下一首"""
        if self.now_playing is None:
            if self.queue:
                self.play_next()
                return True
            return False

        if self.mpv.is_idle():
            logger.info("歌曲播放完畢")
            self._add_to_history(self.now_playing)
            self.now_playing = None
            self.is_paused = False
            if self.queue:
                self.play_next()
                return True
            return True  # 狀態有變化（從播放變為閒置）
        return False

    def get_state(self):
        """取得完整狀態"""
        time_pos = None
        duration = None
        if self.now_playing:
            time_pos = self.mpv.get_time_pos()
            duration = self.mpv.get_duration()

        return {
            'now_playing': self.now_playing,
            'queue': list(self.queue),
            'history': list(self.history),
            'is_paused': self.is_paused,
            'time_pos': time_pos,
            'duration': duration,
            'volume': self.mpv.get_volume(),
            'online_count': len(WebSocketClients.clients),
        }


# ============================================================
# 全域實例
# ============================================================
mpv_ctrl = MpvController()
song_queue = SongQueue(mpv_ctrl)


# ============================================================
# WebSocket 管理
# ============================================================
class WebSocketClients(object):
    """管理所有 WebSocket 連線"""
    clients = set()

    @classmethod
    def add(cls, client):
        cls.clients.add(client)

    @classmethod
    def remove(cls, client):
        cls.clients.discard(client)

    @classmethod
    def broadcast(cls, message):
        """廣播訊息給所有連線的客戶端"""
        msg_str = json.dumps(message, ensure_ascii=False)
        for client in list(cls.clients):
            try:
                client.write_message(msg_str)
            except Exception:
                cls.clients.discard(client)


def broadcast_state():
    """廣播目前的完整狀態"""
    state = song_queue.get_state()
    WebSocketClients.broadcast({
        'type': 'state_update',
        'data': state
    })


# ============================================================
# Tornado Handlers
# ============================================================
class MainHandler(tornado.web.RequestHandler):
    def get(self):
        self.render("static/index.html")


class MusicWebSocket(tornado.websocket.WebSocketHandler):
    def check_origin(self, origin):
        return True  # 允許所有來源（區域網路使用）

    def open(self):
        self.is_admin = False  # 預設非管理員
        WebSocketClients.add(self)
        logger.info("WebSocket 連線建立 (目前 %d 人)", len(WebSocketClients.clients))
        # 傳送目前狀態給新連線
        state = song_queue.get_state()
        state['is_admin'] = self.is_admin
        self.write_message(json.dumps({
            'type': 'state_update',
            'data': state
        }, ensure_ascii=False))
        # 廣播人數更新給其他人
        broadcast_state()

    def on_close(self):
        WebSocketClients.remove(self)
        logger.info("WebSocket 連線關閉 (目前 %d 人)", len(WebSocketClients.clients))
        # 廣播人數更新
        broadcast_state()

    @tornado.gen.coroutine
    def on_message(self, message):
        try:
            msg = json.loads(message)
        except (ValueError, TypeError):
            self.write_message(json.dumps({
                'type': 'error', 'message': '無效的訊息格式'
            }))
            return

        msg_type = msg.get('type', '')

        if msg_type == 'add_song':
            yield self._handle_add_song(msg)
        elif msg_type == 'search_youtube':
            yield self._handle_search_youtube(msg)
        elif msg_type == 'admin_login':
            self._handle_admin_login(msg)
        elif msg_type == 'admin_logout':
            self.is_admin = False
            self.write_message(json.dumps({
                'type': 'admin_status', 'is_admin': False,
                'message': '已登出管理員'
            }))
        elif msg_type in ('remove_song', 'skip', 'pause', 'resume', 'set_volume'):
            # 這些操作需要管理員權限
            if not self.is_admin:
                self.write_message(json.dumps({
                    'type': 'error', 'message': '需要管理員權限'
                }))
                return
            if msg_type == 'remove_song':
                self._handle_remove_song(msg)
            elif msg_type == 'skip':
                song_queue.skip()
                song_queue.check_and_play_next()
                broadcast_state()
            elif msg_type == 'pause':
                song_queue.pause()
                broadcast_state()
            elif msg_type == 'resume':
                song_queue.resume()
                broadcast_state()
            elif msg_type == 'set_volume':
                vol = msg.get('volume', 80)
                song_queue.set_volume(vol)
                broadcast_state()
        else:
            self.write_message(json.dumps({
                'type': 'error', 'message': '未知的指令類型'
            }))

    def _handle_admin_login(self, msg):
        """管理員登入驗證"""
        password = msg.get('password', '')
        if password == ADMIN_PASSWORD:
            self.is_admin = True
            logger.info("管理員登入成功")
            self.write_message(json.dumps({
                'type': 'admin_status', 'is_admin': True,
                'message': '管理員登入成功'
            }))
        else:
            self.write_message(json.dumps({
                'type': 'admin_status', 'is_admin': False,
                'message': '密碼錯誤'
            }))

    @tornado.gen.coroutine
    def _handle_add_song(self, msg):
        url = msg.get('url', '').strip()
        requester = msg.get('requester', '匿名').strip() or '匿名'

        if not url:
            self.write_message(json.dumps({
                'type': 'error', 'message': '請輸入 YouTube 網址'
            }))
            return

        # 在背景執行緒中取得影片資訊
        self.write_message(json.dumps({
            'type': 'info', 'message': '正在取得影片資訊...'
        }))

        io_loop = tornado.ioloop.IOLoop.current()
        info = yield io_loop.run_in_executor(executor, fetch_video_info, url)

        if info is None:
            self.write_message(json.dumps({
                'type': 'error', 'message': '無法取得影片資訊，請確認網址是否正確'
            }))
            return

        info['requester'] = requester

        # 檢查歌曲時長限制
        if MAX_DURATION_MINUTES > 0:
            duration = info.get('duration', 0) or 0
            max_seconds = MAX_DURATION_MINUTES * 60
            if duration > max_seconds:
                self.write_message(json.dumps({
                    'type': 'error',
                    'message': '歌曲太長！限制 {} 分鐘以內，這首歌 {} 分 {} 秒'.format(
                        MAX_DURATION_MINUTES,
                        int(duration // 60),
                        int(duration % 60)
                    )
                }))
                return

        song_queue.add(info)

        # 如果目前沒有在播放，立即開始
        if song_queue.now_playing is None:
            song_queue.play_next()

        WebSocketClients.broadcast({
            'type': 'song_added',
            'data': info
        })
        broadcast_state()

    @tornado.gen.coroutine
    def _handle_search_youtube(self, msg):
        keyword = msg.get('keyword', '').strip()
        if not keyword:
            self.write_message(json.dumps({
                'type': 'error', 'message': '請輸入搜尋關鍵字'
            }))
            return

        io_loop = tornado.ioloop.IOLoop.current()
        candidates = yield io_loop.run_in_executor(executor, search_youtube_candidates, keyword, 8)

        if candidates is None:
            self.write_message(json.dumps({
                'type': 'error', 'message': '搜尋失敗，請稍後再試'
            }))
            return

        self.write_message(json.dumps({
            'type': 'search_results',
            'keyword': keyword,
            'data': candidates
        }, ensure_ascii=False))


# ============================================================
# 定時任務：輪詢播放狀態
# ============================================================
def poll_playback_status():
    """每 2 秒檢查播放狀態"""
    try:
        changed = song_queue.check_and_play_next()
        if changed:
            broadcast_state()
    except Exception as e:
        logger.error("輪詢錯誤: %s", e)


# ============================================================
# 應用程式入口
# ============================================================
def make_app():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return tornado.web.Application(
        [
            (r"/", MainHandler),
            (r"/ws", MusicWebSocket),
        ],
        template_path=base_dir,
        static_path=os.path.join(base_dir, "static"),
        debug=False,
    )


def main():
    logger.info("=" * 50)
    logger.info("  🎵 YouTube 點歌系統")
    logger.info("=" * 50)

    # 啟動 mpv
    if not mpv_ctrl.start():
        logger.warning("=" * 50)
        logger.warning("  mpv 未安裝或無法啟動！")
        logger.warning("  伺服器仍會啟動，但無法播放音樂")
        logger.warning("  請安裝 mpv 並加入系統 PATH")
        logger.warning("=" * 50)

    # 啟動 Tornado
    app = make_app()
    app.listen(PORT)
    logger.info("伺服器已啟動: http://localhost:%d", PORT)
    logger.info("區域網路存取: http://<你的IP>:%d", PORT)
    logger.info("按 Ctrl+C 停止伺服器")

    # 設定定時輪詢（每 2 秒）
    callback = tornado.ioloop.PeriodicCallback(poll_playback_status, 2000)
    callback.start()

    try:
        tornado.ioloop.IOLoop.current().start()
    except KeyboardInterrupt:
        logger.info("伺服器關閉中...")
    finally:
        mpv_ctrl.stop_process()
        logger.info("已關閉")


if __name__ == "__main__":
    main()
