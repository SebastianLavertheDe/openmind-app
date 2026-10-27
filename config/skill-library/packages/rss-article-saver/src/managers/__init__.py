from .config_manager import RSSConfig
from .opml_parser import OPMLParser, RSSFeed
__all__ = ['RSSConfig', 'OPMLParser', 'RSSFeed', 'RSSManager', 'ArticleCacheManager', 'ContentExtractor']


def __getattr__(name):
    # Keep config/path inspection usable without importing optional network
    # extraction dependencies. The RSS entrypoint imports these modules when
    # it starts a real run.
    if name == "RSSManager":
        from .rss_manager import RSSManager
        return RSSManager
    if name == "ArticleCacheManager":
        from .cache_manager import ArticleCacheManager
        return ArticleCacheManager
    if name == "ContentExtractor":
        from .content_manager import ContentExtractor
        return ContentExtractor
    raise AttributeError(name)
