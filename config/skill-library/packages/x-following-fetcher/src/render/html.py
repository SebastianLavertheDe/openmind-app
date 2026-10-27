from __future__ import annotations

import html
from pathlib import Path

from ..config import RenderConfig
from ..models import EmbeddedTweet, Media, Tweet
from .content import (
    author_initials,
    build_title,
    format_compact_count,
    format_display_time,
    format_short_time,
    normalize_embedded_content,
    normalize_tweet_content,
    should_render_title,
)


def _escape_and_breaklines(text: str) -> str:
    if not text:
        return ""
    return "<br>".join(html.escape(part) for part in text.splitlines())


def _verified_badge(is_verified: bool) -> str:
    if not is_verified:
        return ""
    return """
    <span class="verified-badge" aria-label="Verified account">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M22.25 12c0-.76-.43-1.45-1.11-1.79l-1.6-.8.29-1.77a1.94 1.94 0 0 0-.54-1.72 1.94 1.94 0 0 0-1.72-.54l-1.77.29-.8-1.6A2 2 0 0 0 12 1.75c-.76 0-1.45.43-1.79 1.11l-.8 1.6-1.77-.29a1.94 1.94 0 0 0-1.72.54 1.94 1.94 0 0 0-.54 1.72l.29 1.77-1.6.8A2 2 0 0 0 1.75 12c0 .76.43 1.45 1.11 1.79l1.6.8-.29 1.77a1.94 1.94 0 0 0 .54 1.72c.46.46 1.1.67 1.72.54l1.77-.29.8 1.6A2 2 0 0 0 12 22.25c.76 0 1.45-.43 1.79-1.11l.8-1.6 1.77.29a1.94 1.94 0 0 0 1.72-.54c.46-.46.67-1.1.54-1.72l-.29-1.77 1.6-.8c.68-.34 1.11-1.03 1.11-1.79Zm-11.41 4.2-3.2-3.2 1.41-1.41 1.79 1.79 4.11-4.11 1.41 1.41-5.52 5.52Z"/>
      </svg>
    </span>
    """


def _avatar_markup(tweet: Tweet) -> str:
    if tweet.author.profile_image_url:
        return f'<img class="avatar" src="{html.escape(tweet.author.profile_image_url)}" alt="{html.escape(tweet.author.name)} avatar">'
    fallback = author_initials(tweet.author.name, tweet.author.screen_name)
    return f'<div class="avatar avatar-fallback" aria-hidden="true">{html.escape(fallback)}</div>'


def _format_duration(duration_millis: int) -> str:
    if duration_millis <= 0:
        return ""
    total_seconds = duration_millis // 1000
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def _image_grid(images: list[Media]) -> str:
    if not images:
        return ""

    classes = ["media-grid", f"media-count-{min(len(images), 4)}"]
    image_items: list[str] = []
    for media in images[:4]:
        full_src = media.url
        label = media.display_url or media.expanded_url or media.url
        image_items.append(
            f"""
            <button
              class="media-tile js-lightbox-trigger"
              type="button"
              data-fullsrc="{html.escape(full_src)}"
              data-alt="{html.escape(label)}"
              aria-label="Open image in lightbox"
            >
              <img src="{html.escape(media.url)}" alt="Tweet media">
            </button>
            """
        )
    return f'<div class="{" ".join(classes)}">{"".join(image_items)}</div>'


def _non_photo_media(media_items: list[Media]) -> str:
    non_photos = [media for media in media_items if media.media_type != "photo"]
    if not non_photos:
        return ""

    tiles: list[str] = []
    for media in non_photos:
        label = media.display_url or media.expanded_url or media.url
        duration = _format_duration(media.duration_millis)
        playable_src = media.local_path
        preview_markup = ""
        if media.url:
            preview_markup = f"""
            <span class="video-preview">
              <img src="{html.escape(media.url)}" alt="Tweet video preview">
              <span class="video-play-badge" aria-hidden="true">▶</span>
              {'<span class="video-duration">' + html.escape(duration) + '</span>' if duration else ''}
            </span>
            """

        meta_markup = f"""
        <span class="video-meta">
          <span class="video-pill">{html.escape(media.media_type.upper())}</span>
          <span class="video-label">{html.escape(label)}</span>
        </span>
        """

        if playable_src:
            tiles.append(
                f"""
                <div class="video-card-shell">
                  <button
                    class="video-card js-video-trigger"
                    type="button"
                    data-stream-src="{html.escape(playable_src)}"
                    data-stream-type="{html.escape(media.stream_content_type)}"
                    data-poster="{html.escape(media.url)}"
                    data-fallback-href="{html.escape(media.expanded_url or media.url)}"
                    aria-label="Play embedded video"
                  >
                    {preview_markup}
                    {meta_markup}
                  </button>
                </div>
                """
            )
        else:
            tiles.append(
                f"""
                <div class="video-card-shell">
                  <a class="video-card" href="{html.escape(media.expanded_url or media.url)}" target="_blank" rel="noreferrer">
                    {preview_markup}
                    {meta_markup}
                  </a>
                </div>
                """
            )
    return f'<div class="video-stack">{"".join(tiles)}</div>'


def _quote_card(embedded: EmbeddedTweet | None, expand_urls: bool) -> str:
    if embedded is None:
        return ""

    content = normalize_embedded_content(embedded, expand_urls)
    return f"""
    <a class="quote-card" href="{html.escape(embedded.link)}" target="_blank" rel="noreferrer">
      <div class="quote-meta">
        <span class="quote-name">{html.escape(embedded.author_name)}</span>
        <span class="quote-handle">@{html.escape(embedded.author_screen_name)}</span>
      </div>
      <div class="quote-content">{_escape_and_breaklines(content)}</div>
    </a>
    """


def _action(label: str, count: int, icon: str) -> str:
    return f"""
    <div class="action" aria-label="{html.escape(label)}">
      <span class="action-icon">{icon}</span>
      <span class="action-count">{html.escape(format_compact_count(count))}</span>
    </div>
    """


def _action_bar(tweet: Tweet) -> str:
    return f"""
    <div class="action-bar">
      {_action("Replies", tweet.metrics.replies, '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M14.046 2.242c4.874 0 8.824 3.714 8.824 8.292 0 4.58-3.95 8.293-8.824 8.293a10.09 10.09 0 0 1-3.645-.676l-4.126 2.29.98-3.838A8.04 8.04 0 0 1 5.22 10.534c0-4.578 3.95-8.292 8.825-8.292Z"/></svg>')}
      {_action("Reposts", tweet.metrics.reposts, '<svg viewBox="0 0 24 24"><path fill="currentColor" d="m4.5 3.75 4.25 4.25-1.06 1.06-2.44-2.44V16.5a.75.75 0 0 0 .75.75H15v1.5H6a2.25 2.25 0 0 1-2.25-2.25V6.62L1.31 9.06.25 8l4.25-4.25Zm15 12.63V7.5a.75.75 0 0 0-.75-.75H9v-1.5h9A2.25 2.25 0 0 1 20.25 7.5v8.88l2.44-2.44 1.06 1.06-4.25 4.25-4.25-4.25 1.06-1.06 2.44 2.44Z"/></svg>')}
      {_action("Likes", tweet.metrics.likes, '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M16.697 3c-1.79 0-3.434.895-4.697 2.342C10.737 3.895 9.093 3 7.303 3 3.86 3 1 5.857 1 9.303c0 3.858 3.113 6.628 7.825 10.822L12 22l3.175-1.875C19.887 15.931 23 13.161 23 9.303 23 5.857 20.14 3 16.697 3Z"/></svg>')}
      {_action("Quotes", tweet.metrics.quotes, '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 5.75A2.75 2.75 0 0 1 5.75 3h5.5A2.75 2.75 0 0 1 14 5.75v5.5A2.75 2.75 0 0 1 11.25 14h-5.5A2.75 2.75 0 0 1 3 11.25v-5.5Zm10 7A2.75 2.75 0 0 1 15.75 10h2.5v1.5h-2.5a1.25 1.25 0 0 0-1.25 1.25v5.5c0 .69.56 1.25 1.25 1.25h5.5c.69 0 1.25-.56 1.25-1.25v-5.5c0-.69-.56-1.25-1.25-1.25h-2.5V10h2.5A2.75 2.75 0 0 1 24 12.75v5.5A2.75 2.75 0 0 1 21.25 21h-5.5A2.75 2.75 0 0 1 13 18.25v-5.5Z"/></svg>')}
    </div>
    """


def _tweet_card(tweet: Tweet, config: RenderConfig, *, detail_href: str | None = None) -> str:
    content = normalize_tweet_content(tweet, config.expand_urls)
    title = build_title(tweet.title, content, config.title_max_length)
    title_markup = f'<h1 class="tweet-title">{html.escape(title)}</h1>' if should_render_title(title, content) else ""
    image_markup = _image_grid([media for media in tweet.media if media.media_type == "photo"] if config.include_images else [])
    other_media_markup = _non_photo_media(tweet.media) if config.include_images else ""
    quote_markup = _quote_card(tweet.quoted_tweet, config.expand_urls) if config.include_quotes else ""
    detail_link = detail_href or tweet.link
    retweet_badge = ""
    if tweet.is_retweet and tweet.retweeted_tweet:
        retweet_badge = f'<div class="context-line">Reposted from @{html.escape(tweet.retweeted_tweet.author_screen_name)}</div>'

    return f"""
    <article class="tweet-card">
      <div class="tweet-shell">
        <div class="tweet-avatar">{_avatar_markup(tweet)}</div>
        <div class="tweet-main">
          {retweet_badge}
          <header class="tweet-header">
            <div class="author-block">
              <span class="author-name">{html.escape(tweet.author.name)}</span>
              {_verified_badge(tweet.author.verified)}
              <span class="author-handle">@{html.escape(tweet.author.screen_name)}</span>
              <span class="meta-separator">·</span>
              <a class="tweet-time" href="{html.escape(detail_link)}">{html.escape(format_short_time(tweet.created_at))}</a>
            </div>
          </header>
          <a class="tweet-body" href="{html.escape(detail_link)}">
            {title_markup}
            <div class="tweet-content">{_escape_and_breaklines(content)}</div>
          </a>
          {image_markup}
          {other_media_markup}
          {quote_markup}
          {_action_bar(tweet)}
        </div>
      </div>
    </article>
    """


def _page_css() -> str:
    return """
    :root{
      --bg:#0f1419;
      --panel:#15202b;
      --panel-2:#1d2936;
      --line:#2f3336;
      --text:#e7e9ea;
      --muted:#8b98a5;
      --accent:#1d9bf0;
      --accent-soft:rgba(29,155,240,.14);
      --success:#00ba7c;
      --shadow:0 22px 48px rgba(0,0,0,.28);
      --radius:24px;
    }
    *{box-sizing:border-box}
    html{font-size:16px}
    body{
      margin:0;
      background:
        radial-gradient(circle at top, rgba(29,155,240,.15), transparent 32%),
        linear-gradient(180deg, #0c1116 0%, var(--bg) 28%, #0b1117 100%);
      color:var(--text);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    a{color:inherit;text-decoration:none}
    .app-shell{
      min-height:100vh;
      display:grid;
      grid-template-columns:minmax(0,1fr) minmax(320px,680px) minmax(0,1fr);
      gap:24px;
      padding:28px 20px 80px;
    }
    .rail{display:flex;align-items:flex-start;justify-content:flex-end}
    .rail-panel{
      position:sticky;
      top:24px;
      width:100%;
      max-width:280px;
      padding:24px;
      background:rgba(21,32,43,.72);
      border:1px solid rgba(255,255,255,.06);
      border-radius:28px;
      box-shadow:var(--shadow);
      backdrop-filter:blur(24px);
    }
    .rail-kicker{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#6ab7ff}
    .rail-title{margin:12px 0 10px;font-size:1.4rem;line-height:1.05;font-weight:800}
    .rail-copy{margin:0;color:var(--muted);line-height:1.6}
    .rail-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:20px}
    .rail-stat{padding:14px 16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:18px}
    .rail-stat strong{display:block;font-size:1.1rem}
    .rail-stat span{font-size:.78rem;color:var(--muted)}
    .timeline{
      background:rgba(21,32,43,.66);
      border:1px solid rgba(255,255,255,.06);
      border-radius:32px;
      box-shadow:var(--shadow);
      overflow:hidden;
      backdrop-filter:blur(22px);
    }
    .timeline-header{
      position:sticky;
      top:0;
      z-index:4;
      display:flex;
      align-items:flex-end;
      justify-content:space-between;
      gap:16px;
      padding:22px 24px 18px;
      background:linear-gradient(180deg, rgba(21,32,43,.94) 0%, rgba(21,32,43,.84) 100%);
      border-bottom:1px solid rgba(255,255,255,.06);
      backdrop-filter:blur(24px);
    }
    .timeline-title{margin:0;font-size:1.4rem;font-weight:800}
    .timeline-subtitle{margin:8px 0 0;color:var(--muted);font-size:.95rem}
    .timeline-list{display:flex;flex-direction:column}
    .tweet-card{padding:0 22px;background:transparent;border-bottom:1px solid rgba(255,255,255,.05)}
    .tweet-card:last-child{border-bottom:none}
    .tweet-shell{display:grid;grid-template-columns:56px minmax(0,1fr);gap:14px;padding:18px 0}
    .tweet-avatar{padding-top:2px}
    .avatar{
      width:48px;height:48px;border-radius:50%;display:block;object-fit:cover;
      background:#243447;border:1px solid rgba(255,255,255,.08)
    }
    .avatar-fallback{
      display:grid;place-items:center;font-weight:800;font-size:.9rem;
      background:linear-gradient(135deg,#1d9bf0,#7b61ff)
    }
    .tweet-main{min-width:0}
    .context-line{margin-bottom:10px;color:var(--muted);font-size:.86rem}
    .tweet-header{display:flex;justify-content:space-between;gap:12px}
    .author-block{
      display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;
      font-size:.95rem;line-height:1.4
    }
    .author-name{font-weight:800}
    .author-handle,.tweet-time,.meta-separator{color:var(--muted)}
    .verified-badge{width:1rem;height:1rem;color:var(--accent);display:inline-flex}
    .verified-badge svg{width:100%;height:100%}
    .tweet-body{display:block;margin-top:4px}
    .tweet-title{
      margin:0 0 8px;font-size:1.05rem;line-height:1.35;font-weight:700;
      letter-spacing:-.01em
    }
    .tweet-content{
      color:var(--text);font-size:1rem;line-height:1.55;word-break:break-word;
    }
    .media-grid{
      margin-top:14px;display:grid;gap:2px;overflow:hidden;border-radius:22px;
      border:1px solid rgba(255,255,255,.08);background:#0c1116
    }
    .media-count-1{grid-template-columns:1fr}
    .media-count-2{grid-template-columns:repeat(2,1fr)}
    .media-count-3,.media-count-4{grid-template-columns:repeat(2,1fr)}
    .media-tile{display:block;min-height:180px;background:#10171f}
    .media-tile{
      padding:0;border:none;width:100%;cursor:zoom-in;
    }
    .media-count-1 .media-tile{min-height:320px}
    .media-tile img{width:100%;height:100%;display:block;object-fit:cover}
    .media-tile:focus-visible{
      outline:2px solid var(--accent);
      outline-offset:-2px;
    }
    .video-stack{display:grid;gap:10px;margin-top:14px}
    .video-card-shell{display:block}
    .video-card{
      display:grid;gap:12px;padding:14px 16px;border-radius:18px;width:100%;
      background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);
      color:inherit;text-align:left
    }
    button.video-card{cursor:pointer}
    .video-preview{
      position:relative;display:block;overflow:hidden;border-radius:16px;
      background:#0c1116;aspect-ratio:16/9
    }
    .video-preview img{
      width:100%;height:100%;display:block;object-fit:cover
    }
    .video-play-badge{
      position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      width:64px;height:64px;display:grid;place-items:center;border-radius:999px;
      background:rgba(15,20,25,.78);color:white;font-size:1.4rem;
      box-shadow:0 12px 28px rgba(0,0,0,.32)
    }
    .video-duration{
      position:absolute;right:12px;bottom:12px;padding:4px 8px;border-radius:999px;
      background:rgba(15,20,25,.82);color:var(--text);font-size:.76rem;font-weight:700
    }
    .video-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .video-pill{
      padding:4px 10px;border-radius:999px;background:var(--accent-soft);
      color:#6ab7ff;font-size:.75rem;font-weight:700;letter-spacing:.08em
    }
    .video-label{color:var(--text);font-size:.92rem}
    .inline-video{
      width:100%;display:block;overflow:hidden;border-radius:18px;background:#000;
      border:1px solid rgba(255,255,255,.08)
    }
    .video-fallback{
      display:flex;align-items:center;justify-content:space-between;gap:12px;
      padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.08)
    }
    .video-fallback-copy{color:var(--muted);font-size:.9rem}
    .video-fallback-link{
      display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;
      border-radius:999px;background:var(--accent-soft);color:#6ab7ff;font-weight:700
    }
    .quote-card{
      display:block;margin-top:14px;padding:14px 16px;border-radius:20px;
      border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03)
    }
    .quote-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
    .quote-name{font-weight:700}
    .quote-handle{color:var(--muted)}
    .quote-content{color:var(--text);line-height:1.5}
    .action-bar{
      display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;
      margin-top:14px;padding-top:8px;color:var(--muted)
    }
    .action{
      display:flex;align-items:center;gap:8px;padding:8px 0;font-size:.88rem
    }
    .action-icon{display:inline-flex;width:18px;height:18px}
    .action-icon svg{width:100%;height:100%}
    .detail-wrap{
      min-height:100vh;display:grid;place-items:start center;padding:36px 20px 72px
    }
    .detail-column{width:min(680px,100%)}
    .detail-top{
      display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px
    }
    .back-link{
      display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border-radius:999px;
      background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:var(--text)
    }
    .detail-meta{color:var(--muted);font-size:.92rem}
    .lightbox{
      position:fixed;inset:0;display:none;place-items:center;z-index:80;
      padding:24px;background:rgba(4,8,12,.84);backdrop-filter:blur(10px);
    }
    .lightbox.is-open{display:grid}
    .lightbox-backdrop{
      position:absolute;inset:0;background:transparent;border:none;padding:0;
    }
    .lightbox-dialog{
      position:relative;z-index:1;width:min(92vw,1180px);max-height:92vh;
      display:grid;gap:12px;justify-items:center;
    }
    .lightbox-image{
      max-width:100%;max-height:80vh;border-radius:24px;display:block;
      box-shadow:0 30px 60px rgba(0,0,0,.38);background:#0c1116;
    }
    .lightbox-caption{
      color:var(--muted);font-size:.92rem;text-align:center;max-width:72ch;
    }
    .lightbox-close{
      position:absolute;top:-8px;right:-8px;z-index:2;width:42px;height:42px;
      border:none;border-radius:999px;background:rgba(21,32,43,.94);color:var(--text);
      cursor:pointer;box-shadow:var(--shadow);font-size:1.3rem;line-height:1;
    }
    @media (max-width: 1080px){
      .app-shell{grid-template-columns:minmax(0,1fr);padding:18px 10px 56px}
      .rail{display:none}
      .timeline{border-radius:24px}
      .timeline-header{padding:18px 18px 16px}
      .tweet-card{padding:0 16px}
    }
    @media (max-width: 640px){
      .tweet-shell{grid-template-columns:44px minmax(0,1fr);gap:12px}
      .avatar{width:40px;height:40px}
      .tweet-title{font-size:1rem}
      .tweet-content{font-size:.96rem}
      .action-bar{gap:6px}
      .lightbox{padding:14px}
      .lightbox-image{max-height:72vh;border-radius:18px}
    }
    """


def _lightbox_markup() -> str:
    return """
    <div class="lightbox" id="tweet-lightbox" aria-hidden="true">
      <button class="lightbox-backdrop" type="button" aria-label="Close image preview"></button>
      <div class="lightbox-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
        <button class="lightbox-close" type="button" aria-label="Close image preview">×</button>
        <img class="lightbox-image" src="" alt="">
        <div class="lightbox-caption"></div>
      </div>
    </div>
    """


def _lightbox_script() -> str:
    return """
    <script>
    (() => {
      const lightbox = document.getElementById('tweet-lightbox');
      if (!lightbox) return;
      const image = lightbox.querySelector('.lightbox-image');
      const caption = lightbox.querySelector('.lightbox-caption');
      const closeButtons = lightbox.querySelectorAll('.lightbox-close, .lightbox-backdrop');
      let lastTrigger = null;

      const closeLightbox = () => {
        lightbox.classList.remove('is-open');
        lightbox.setAttribute('aria-hidden', 'true');
        image.src = '';
        image.alt = '';
        caption.textContent = '';
        document.body.style.overflow = '';
        if (lastTrigger) lastTrigger.focus();
      };

      document.querySelectorAll('.js-lightbox-trigger').forEach((trigger) => {
        trigger.addEventListener('click', () => {
          lastTrigger = trigger;
          image.src = trigger.dataset.fullsrc || '';
          image.alt = trigger.dataset.alt || 'Tweet media';
          caption.textContent = trigger.dataset.alt || '';
          lightbox.classList.add('is-open');
          lightbox.setAttribute('aria-hidden', 'false');
          document.body.style.overflow = 'hidden';
        });
      });

      closeButtons.forEach((button) => button.addEventListener('click', closeLightbox));
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && lightbox.classList.contains('is-open')) {
          closeLightbox();
        }
      });
    })();
    </script>
    """


def _inline_video_script() -> str:
    return """
    <script>
    (() => {
      document.querySelectorAll('.js-video-trigger').forEach((trigger) => {
        trigger.addEventListener('click', () => {
          const shell = trigger.closest('.video-card-shell');
          const streamSrc = trigger.dataset.streamSrc || '';
          if (!shell || !streamSrc) return;

          const video = document.createElement('video');
          video.className = 'inline-video';
          video.controls = true;
          video.playsInline = true;
          video.preload = 'metadata';
          video.autoplay = true;
          video.crossOrigin = 'anonymous';

          const poster = trigger.dataset.poster || '';
          if (poster) {
            video.poster = poster;
          }

          video.src = streamSrc;

          video.addEventListener('error', () => {
            const fallbackHref = trigger.dataset.fallbackHref || streamSrc;
            const fallback = document.createElement('div');
            fallback.className = 'video-fallback';
            fallback.innerHTML = `
              <span class="video-fallback-copy">这个视频在当前页面里加载失败了，可以直接打开原始链接播放。</span>
              <a class="video-fallback-link" href="${fallbackHref}" target="_blank" rel="noreferrer">打开原视频</a>
            `;
            shell.replaceChildren(fallback);
          }, { once: true });

          shell.replaceChildren(video);
          video.load();
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
        }, { once: true });
      });
    })();
    </script>
    """


def render_tweet_html(tweet: Tweet, config: RenderConfig, *, timeline_href: str = "./index.html") -> str:
    title = build_title(tweet.title, normalize_tweet_content(tweet, config.expand_urls), config.title_max_length)
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{html.escape(title)} · X Archive</title>
    <style>{_page_css()}</style>
  </head>
  <body>
    <main class="detail-wrap">
      <div class="detail-column">
        <div class="detail-top">
          <a class="back-link" href="{html.escape(timeline_href)}">← Back to timeline</a>
          <div class="detail-meta">{html.escape(format_display_time(tweet.created_at))}</div>
        </div>
        {_tweet_card(tweet, config)}
      </div>
    </main>
    {_lightbox_markup()}
    {_lightbox_script()}
    {_inline_video_script()}
  </body>
</html>
"""


def render_timeline_html(
    tweets: list[Tweet],
    config: RenderConfig,
    *,
    date_label: str,
    output_dir: Path | None,
) -> str:
    sorted_tweets = sorted(tweets, key=lambda item: item.created_at, reverse=True)
    cards = []
    for tweet in sorted_tweets:
        cards.append(_tweet_card(tweet, config, detail_href=tweet.link))

    card_markup = "".join(cards) if cards else '<div class="tweet-card"><div class="tweet-shell"><div class="tweet-main">No tweets yet.</div></div></div>'
    output_dir_label = html.escape(str(output_dir)) if output_dir is not None else "the archive directory"
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{html.escape(date_label)} · X Timeline Archive</title>
    <style>{_page_css()}</style>
  </head>
  <body>
    <main class="app-shell">
      <aside class="rail">
        <section class="rail-panel">
          <div class="rail-kicker">Archive View</div>
          <h1 class="rail-title">X-like Timeline Frontend</h1>
          <p class="rail-copy">Standalone tweet cards rendered from your saved timeline data. Open this page locally and browse the day like a compact X feed.</p>
          <div class="rail-stats">
            <div class="rail-stat"><strong>{len(sorted_tweets)}</strong><span>Tweets</span></div>
            <div class="rail-stat"><strong>{html.escape(date_label)}</strong><span>Date</span></div>
          </div>
        </section>
      </aside>
      <section class="timeline">
        <header class="timeline-header">
          <div>
            <h1 class="timeline-title">{html.escape(date_label)} Timeline</h1>
            <p class="timeline-subtitle">{len(sorted_tweets)} tweet cards rendered from {output_dir_label}</p>
          </div>
        </header>
        <div class="timeline-list">{card_markup}</div>
      </section>
      <aside class="rail">
        <section class="rail-panel">
          <div class="rail-kicker">Rendering Notes</div>
          <h2 class="rail-title">What You’re Seeing</h2>
          <p class="rail-copy">Rich text normalization, quoted tweet cards, image grids, retweet context, and compact action stats. Media links stay clickable, and each card has its own detail page.</p>
        </section>
      </aside>
    </main>
    {_lightbox_markup()}
    {_lightbox_script()}
    {_inline_video_script()}
  </body>
</html>
"""
