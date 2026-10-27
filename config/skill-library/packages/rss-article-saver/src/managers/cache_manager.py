"""
缓存管理器 - 用于文章去重
"""

import os
import sys
import json
import threading
import time
import hashlib
from typing import Dict, Any

IS_WIN32 = sys.platform == "win32"
if IS_WIN32:
    import msvcrt
else:
    import fcntl


class ArticleCacheManager:
    """文章缓存管理器"""

    def __init__(self, cache_file: str = "article_cache.json"):
        """初始化缓存管理器"""
        self.cache_file = cache_file
        self.cache_data = self._load_cache()
        self._lock = threading.Lock()
        self._dirty = False

    def _load_cache(self) -> Dict[str, Any]:
        """加载缓存文件"""
        try:
            if os.path.exists(self.cache_file):
                with open(self.cache_file, 'r', encoding='utf-8') as file:
                    cache_data = json.load(file)
                    print(f"成功加载缓存文件: {self.cache_file}")
                    return cache_data
            else:
                print(f"缓存文件不存在，将创建新的缓存: {self.cache_file}")
                return {}
        except Exception as e:
            print(f"加载缓存文件失败: {e}，将使用空缓存")
            return {}

    def _save_cache(self) -> None:
        """保存缓存到文件"""
        try:
            with open(self.cache_file, 'w', encoding='utf-8') as file:
                json.dump(self.cache_data, file, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存缓存文件失败: {e}")

    def _generate_article_id(self, link: str) -> str:
        """为文章生成唯一标识符"""
        return hashlib.md5(link.encode('utf-8')).hexdigest()

    def is_article_cached(self, link: str) -> bool:
        """检查文章是否已被缓存"""
        article_id = self._generate_article_id(link)
        return article_id in self.cache_data

    def add_article_to_cache(self, article: 'Article') -> None:
        """将文章添加到缓存"""
        article_id = self._generate_article_id(article.link)
        self.cache_data[article_id] = {
            'title': article.title,
            'link': article.link,
            'author': article.author,
            'published': article.published,
            'cached_time': time.time()
        }

    def try_add_article_to_cache(self, article: 'Article') -> bool:
        """原子认领：进程内 Lock 串行化 + flock 跨进程互斥，避免跨进程重复认领
        同一链接导致重复保存。每条写但不 fsync（性能：flock 保证
        跨进程原子认领，flush 保证可见；fsync 留给 save() 兜底）。
        """
        article_id = self._generate_article_id(article.link)
        cache_dir = os.path.dirname(os.path.abspath(self.cache_file))
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)
        with self._lock:
            with open(self.cache_file, 'a+', encoding='utf-8') as file:
                if IS_WIN32:
                    file.seek(0)
                    msvcrt.locking(file.fileno(), msvcrt.LK_LOCK, 1)
                else:
                    fcntl.flock(file.fileno(), fcntl.LOCK_EX)
                try:
                    file.seek(0)
                    raw = file.read().strip()
                    cache_data = json.loads(raw) if raw else {}
                    if not isinstance(cache_data, dict):
                        cache_data = {}
                    if article_id in cache_data:
                        self.cache_data = cache_data
                        return False
                    cache_data[article_id] = {
                        'title': article.title,
                        'link': article.link,
                        'author': article.author,
                        'published': article.published,
                        'cached_time': time.time()
                    }
                    file.seek(0)
                    file.truncate()
                    json.dump(cache_data, file, ensure_ascii=False, indent=2)
                    file.flush()  # 不 fsync：flock 已保证原子认领
                    self.cache_data = cache_data
                    self._dirty = False  # 已写盘，save() 不必再为这条写
                    return True
                finally:
                    if IS_WIN32:
                        file.seek(0)
                        msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(file.fileno(), fcntl.LOCK_UN)

    def get_cache_stats(self):
        """获取缓存统计信息并清理过期缓存"""
        total_cached = len(self.cache_data)
        # 清理超过30天的旧缓存
        current_time = time.time()
        old_entries = [
            entry_id for entry_id, entry_data in self.cache_data.items()
            if current_time - entry_data.get('cached_time', 0) > 30 * 24 * 3600
        ]
        for entry_id in old_entries:
            del self.cache_data[entry_id]

        if old_entries:
            print(f"已清理 {len(old_entries)} 个超过30天的旧缓存条目")
            self._save_cache()

        return total_cached - len(old_entries), len(old_entries)

    def save(self) -> None:
        """批末尾持久化缓存（自动清理30天前条目）。

        flock 下先读磁盘最新版本再合并本进程内存，避免多进程并发时后写覆盖前写而丢失
        其他进程新增的记录。本批无改动（_dirty=False）且无需 prune 时跳过写盘。
        """
        with self._lock:
            current_time = time.time()
            cache_dir = os.path.dirname(os.path.abspath(self.cache_file))
            if cache_dir:
                os.makedirs(cache_dir, exist_ok=True)
            with open(self.cache_file, 'a+', encoding='utf-8') as file:
                if IS_WIN32:
                    file.seek(0)
                    msvcrt.locking(file.fileno(), msvcrt.LK_LOCK, 1)
                else:
                    fcntl.flock(file.fileno(), fcntl.LOCK_EX)
                try:
                    # 读磁盘最新（跨进程：其他实例可能已写入新记录）
                    file.seek(0)
                    raw = file.read().strip()
                    disk = json.loads(raw) if raw else {}
                    if not isinstance(disk, dict):
                        disk = {}
                    # 合并：磁盘版本 + 本进程内存（本进程优先，保留本批新增；
                    # 磁盘中本进程没有的——其他进程写的——也保留，不丢失）
                    merged: Dict[str, Any] = {**disk, **self.cache_data}
                    old_entries = [
                        eid for eid, data in merged.items()
                        if isinstance(data, dict) and current_time - data.get('cached_time', 0) > 30 * 24 * 3600
                    ]
                    for eid in old_entries:
                        del merged[eid]
                    if old_entries:
                        print(f"已清理 {len(old_entries)} 个超过30天的旧缓存条目")
                    if not self._dirty and not old_entries:
                        return
                    file.seek(0)
                    file.truncate()
                    json.dump(merged, file, ensure_ascii=False, indent=2)
                    file.flush()
                    os.fsync(file.fileno())
                    self.cache_data = merged
                finally:
                    if IS_WIN32:
                        file.seek(0)
                        msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(file.fileno(), fcntl.LOCK_UN)
            self._dirty = False
