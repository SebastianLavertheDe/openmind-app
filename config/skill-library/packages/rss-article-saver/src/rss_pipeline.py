"""Root-bound RSS pipeline, shared by Desktop, Process Skills and headless CLI.

The registry lock protocol is also implemented by electron/rss/file-lock.ts.
Network work runs outside the registry lock; every commit checks the frozen
source revision. An edited, disabled or deleted subscription cannot write back.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import html
import importlib
import inspect
import io
import json
import os
import re
import socket
import sys
import time
import uuid
from datetime import datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree as ET

MAX_BYTES = 8 * 1024 * 1024
CONTENT = "http://purl.org/rss/1.0/modules/content/"
ET.register_namespace("content", CONTENT)


class FeedError(RuntimeError):
    def __init__(self, code, message, retryable=False):
        super().__init__(message)
        self.code, self.retryable = code, retryable


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def http_url(value):
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise FeedError("invalid-url", "Enter an HTTP or HTTPS address.")
    return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", parts.query, ""))


class Redirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        http_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url):
    try:
        with build_opener(Redirects()).open(Request(http_url(url), headers={"User-Agent": "OpenMind RSS/1.0", "Accept": "application/rss+xml, application/atom+xml, text/html;q=0.9, */*;q=0.5"}), timeout=25) as response:
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise FeedError("response-too-large", "The response exceeds the feed size limit.")
            return data, http_url(response.url)
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise FeedError("access-denied", "The site requires login or refused access.") from exc
        raise FeedError("http-error", f"The site returned HTTP {exc.code}.", exc.code == 429 or exc.code >= 500) from exc
    except (TimeoutError, socket.timeout) as exc:
        raise FeedError("timeout", "The site did not respond in time.", True) from exc
    except URLError as exc:
        raise FeedError("network-error", "Unable to connect to the site.", True) from exc


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def child_text(element, *names):
    for child in element:
        if local_name(child.tag) in names:
            return "".join(child.itertext()).strip()
    return ""


def date_value(value):
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (ValueError, TypeError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def parse_feed(data, url):
    if re.search(br"<!DOCTYPE|<!ENTITY", data, re.I):
        raise FeedError("invalid-feed", "Feed XML must not contain external entities.")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise FeedError("invalid-feed", "The response is not valid RSS or Atom XML.") from exc
    if local_name(root.tag) not in ("rss", "feed", "RDF"):
        raise FeedError("not-feed", "The address is a webpage, not an RSS or Atom feed.")
    parent = root.find("channel") if local_name(root.tag) == "rss" else root
    if parent is None:
        raise FeedError("invalid-feed", "RSS channel is missing.")
    entries = []
    for item in root.iter():
        if local_name(item.tag) not in ("item", "entry"):
            continue
        title = child_text(item, "title")
        link = child_text(item, "link")
        if not link:
            link = next((n.get("href", "") for n in item if local_name(n.tag) == "link" and n.get("rel", "alternate") == "alternate"), "")
        if not title or not link:
            continue
        try:
            link = http_url(urljoin(url, link))
        except FeedError:
            continue
        entries.append({"title": title, "url": link, "guid": child_text(item, "guid", "id") or link,
                        "description": child_text(item, "description", "summary"), "content": child_text(item, "encoded", "content"),
                        "date": date_value(child_text(item, "pubDate", "published", "updated", "date"))})
    return child_text(parent, "title") or "RSS", entries


class FeedLinks(HTMLParser):
    def __init__(self, base):
        super().__init__(); self.base, self.links = base, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "base" and a.get("href"):
            self.base = urljoin(self.base, a["href"])
        if tag == "link" and "alternate" in a.get("rel", "").lower().split() and a.get("type", "").split(";")[0].lower() in ("application/rss+xml", "application/atom+xml", "application/rdf+xml"):
            try:
                url = http_url(urljoin(self.base, a.get("href", "")))
                if not any(link["url"] == url for link in self.links): self.links.append({"title": a.get("title") or url, "url": url})
            except FeedError:
                pass


def detect(url, catalog, selected=None):
    original = http_url(url)
    data, resolved = fetch(original)
    try:
        _, entries = parse_feed(data, resolved)
    except FeedError as exc:
        if exc.code == "invalid-feed" and re.search(br"<(?:rss|feed)(?:\s|>)", data[:1024]): raise
    else:
        if not entries: raise FeedError("empty-feed", "No articles with a title and valid link were found in this feed.", True)
        return {"kind": "feed", "inputUrl": original, "resolvedFeedUrl": resolved, "adapterId": "feed", "candidates": []}
    parser = FeedLinks(resolved)
    parser.feed(data.decode("utf-8", errors="replace"))
    if parser.links:
        if selected and selected not in [row["url"] for row in parser.links]:
            raise FeedError("invalid-selection", "The selected feed is not advertised by this page.")
        chosen = selected or (parser.links[0]["url"] if len(parser.links) == 1 else None)
        if chosen:
            raw, target = fetch(chosen)
            _, entries = parse_feed(raw, target)
            if not entries: raise FeedError("empty-feed", "No articles with a title and valid link were found in this feed.", True)
        else:
            target = None
        return {"kind": "website", "inputUrl": original, "resolvedFeedUrl": target, "adapterId": "feed", "candidates": parser.links}
    for adapter in catalog["adapters"]:
        expected, actual = urlsplit(adapter["url"]), urlsplit(resolved)
        if expected.netloc.lower().removeprefix("www.") == actual.netloc.lower().removeprefix("www.") and (actual.path.rstrip("/") in {expected.path.rstrip("/"), ""} or any(row.get("adapterId") == adapter["id"] and urlsplit(row["inputUrl"]).path.rstrip("/") == actual.path.rstrip("/") for row in catalog.get("sources", []))):
            result = {"kind": "website", "inputUrl": original, "resolvedFeedUrl": None, "adapterId": adapter["id"], "candidates": []}
            # Exercise the same converter as Update RSS, without writing a feed
            # or collecting articles. An adapter match alone is not success.
            normalized, _ = convert({**result, "name": adapter["id"]}, catalog)
            _, entries = parse_feed(normalized, original)
            if not entries: raise FeedError("empty-page", "No articles with a title and valid link were found on this page.", True)
            return result
    raise FeedError("unsupported-page", "No RSS feed or supported article-list adapter was found on this page.")


def normalize_feed(name, url, entries):
    root = ET.Element("rss", {"version": "2.0"}); channel = ET.SubElement(root, "channel")
    for key, value in (("title", name), ("link", url), ("description", name)):
        ET.SubElement(channel, key).text = value
    unique = {}
    for row in entries:
        unique.setdefault(row.get("guid") or row["url"], row)
    ordered = sorted(unique.values(), key=lambda row: row.get("date") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    for row in ordered:
        item = ET.SubElement(channel, "item")
        for key, value in (("title", row["title"]), ("link", row["url"]), ("guid", row.get("guid") or row["url"]), ("description", row.get("description", ""))):
            ET.SubElement(item, key).text = value
        if row.get("date"): ET.SubElement(item, "pubDate").text = format_datetime(row["date"])
        if row.get("content"): ET.SubElement(item, f"{{{CONTENT}}}encoded").text = row["content"]
    return ET.tostring(root, encoding="utf-8", xml_declaration=True), ordered


def convert(source, catalog):
    if source["adapterId"] == "feed":
        url = source.get("resolvedFeedUrl") or source["inputUrl"]
        data, resolved = fetch(url)
        _, entries = parse_feed(data, resolved)
    else:
        adapter = next((a for a in catalog["adapters"] if a["id"] == source["adapterId"]), None)
        if adapter is None: raise FeedError("unsupported-page", "This source adapter is unavailable.")
        sys.path.insert(0, str(Path(__file__).parent / "feed_generation"))
        try:
            generator = getattr(importlib.import_module(adapter["module"]), adapter["className"])()
            with contextlib.redirect_stdout(io.StringIO()):
                entries = generator.fetch_posts()
                if inspect.isawaitable(entries): entries = asyncio.run(entries)
            if not entries: raise FeedError("empty-page", "The adapter did not find any articles; the previous feed was preserved.", True)
        except ImportError as exc:
            raise FeedError("runtime-missing", "This source requires additional Python or browser dependencies.") from exc
        except FeedError: raise
        except Exception as exc:
            if "Executable doesn't exist" in str(exc) or "playwright install" in str(exc):
                raise FeedError("browser-runtime-missing", "Prepare the browser with: openmind runtime prepare --browser --root ... --user-data ...") from exc
            raise FeedError("adapter-failed", "The site's article list could not be converted. It may have changed or require browser access.", True) from exc
        finally:
            sys.path.pop(0)
    return normalize_feed(source["name"], source["inputUrl"], entries)


@contextlib.contextmanager
def lock(directory, name, wait=0):
    directory.mkdir(parents=True, exist_ok=True)
    file = directory / f"{name}.lock"
    token = str(uuid.uuid4()); deadline = time.monotonic() + wait
    while True:
        try:
            with file.open("x", encoding="utf-8") as output: json.dump({"pid": os.getpid(), "token": token}, output)
            break
        except FileExistsError:
            stale = False
            try:
                owner = json.loads(file.read_text())
                try: os.kill(owner["pid"], 0)
                except ProcessLookupError: stale = True
                except PermissionError: pass
            except (ValueError, KeyError): stale = time.time() - file.stat().st_mtime > 60
            except FileNotFoundError: continue
            if stale:
                file.unlink(missing_ok=True); continue
            if time.monotonic() >= deadline: raise FeedError("busy", "A task for this source is already running.", True)
            time.sleep(0.03)
    try: yield
    finally:
        if file.exists() and json.loads(file.read_text())["token"] == token: file.unlink()


def write_atomic(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_name(file.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temp.open("xb") as output:
            output.write(data); output.flush(); os.fsync(output.fileno())
        os.replace(temp, file)
    finally: temp.unlink(missing_ok=True)


def json_write(file, value):
    write_atomic(file, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


class Pipeline:
    def __init__(self, root, data, catalog):
        self.root, self.data, self.catalog = Path(root).resolve(), Path(data).resolve(), catalog
        self.file = self.data / "sources.json"
        self.saved_paths = []
        if not self.root.is_dir() or not self.data.is_relative_to(self.root): raise FeedError("invalid-root", "RSS data must be inside the selected content root.")

    def safe(self, file):
        if not file.resolve().is_relative_to(self.root):
            raise FeedError("unsafe-path", "A data path escapes the selected content root.")
        return file

    def registry(self):
        self.safe(self.file)
        try: doc = json.loads(self.file.read_text(encoding="utf-8"))
        except FileNotFoundError as exc: raise FeedError("not-initialized", "Open RSS Sources or run the OpenMind CLI to initialize source settings.") from exc
        if doc.get("schemaVersion") != 1 or not doc.get("initialized") or not isinstance(doc.get("sources"), list): raise FeedError("invalid-config", "RSS source configuration is invalid.")
        ids = set()
        for row in doc["sources"]:
            if not isinstance(row, dict) or not re.fullmatch(r"[a-zA-Z0-9-]{1,64}", str(row.get("id", ""))) or row["id"] in ids or not isinstance(row.get("revision"), int) or row["revision"] < 1 or not isinstance(row.get("enabled"), bool):
                raise FeedError("invalid-config", "RSS source configuration is invalid.")
            ids.add(row["id"])
        return doc

    def commit(self, source, work):
        with lock(self.data, "registry", wait=5):
            doc = self.registry()
            current = next((row for row in doc["sources"] if row["id"] == source["id"]), None)
            if not current or not current["enabled"] or current["revision"] != source["revision"]:
                raise FeedError("source-changed", "The source was edited, disabled or deleted; this result was discarded.")
            work(current)
            doc["revision"] += 1
            json_write(self.file, doc)

    def sync(self, source):
        raw, entries = convert(source, self.catalog)
        try: ET.fromstring(raw)
        except ET.ParseError as exc: raise FeedError("invalid-feed", "The converted RSS contains invalid XML; the previous feed was preserved.") from exc
        def save(current):
            write_atomic(self.safe(self.data / "feeds" / (source["id"] + ".xml")), raw)
            current.update(lastAttemptAt=utc_now(), lastSuccessAt=utc_now(), lastError=None, itemCount=len(entries), feedRevision=source["revision"])
        self.commit(source, save)
        source["feedRevision"] = source["revision"]
        return len(entries)

    def collect(self, source, date):
        if source.get("feedRevision") != source["revision"]: raise FeedError("feed-not-ready", "Update this source before collecting articles.")
        feed = self.safe(self.data / "feeds" / (source["id"] + ".xml"))
        if not feed.exists(): raise FeedError("feed-not-ready", "The local RSS file is missing; update the source first.")
        _, entries = parse_feed(feed.read_bytes(), source["inputUrl"])
        saved = 0
        for entry in entries:
            self.commit(source, lambda row: None)
            # A stable URL index shared across sources prevents duplicate files.
            key = hashlib.sha256(http_url(entry["url"]).encode()).hexdigest()
            with lock(self.safe(self.data / "locks"), "article-" + key, wait=2):
                index = self.safe(self.data / "articles" / (key + ".json"))
                fingerprint = hashlib.sha256(json.dumps({k: str(v) for k, v in entry.items()}, sort_keys=True).encode()).hexdigest()
                previous = json.loads(index.read_text()) if index.exists() else None
                if previous and (previous.get("legacy") or previous.get("fingerprint") == fingerprint): continue
                text = article_text(entry)
                body = f'# {entry["title"]}\n\n- 来源: {source["name"]}\n- 原文: {entry["url"]}\n\n{text}\n'
                target = self.safe(self.root / "article" / date / ("rss-" + key[:24] + ".md"))
                if previous:
                    target = self.safe(self.root / "article" / ".updates" / date / ("rss-" + key[:24] + "-" + fingerprint[:12] + ".md"))
                def save(_current):
                    target.parent.mkdir(parents=True, exist_ok=True)
                    # Recover a successful write after a crash before indexing.
                    if not target.exists():
                        with target.open("x", encoding="utf-8") as output: output.write(body); output.flush(); os.fsync(output.fileno())
                    json_write(index, {"url": entry["url"], "guid": entry["guid"], "path": str(target.relative_to(self.root)), "savedAt": utc_now(), "fingerprint": fingerprint, "previousPath": previous.get("path") if previous else None})
                self.commit(source, save); saved += 1
                self.saved_paths.append(str(target.relative_to(self.root)))
        return saved

    def migrate_articles(self):
        marker = self.safe(self.data / "article-migration.json")
        if marker.exists(): return
        with lock(self.data, "article-migration", wait=5):
            if marker.exists(): return
            folder = self.safe(self.root / "article")
            if folder.exists():
                for file in folder.rglob("*.md"):
                    self.safe(file)
                    text = file.read_text(encoding="utf-8", errors="replace")
                    matches = re.findall(r'(?:\*\*链接\*\*[:：]\s*\[[^\]]*\]\(<?|(?:原文|Link|链接)[:：]\s*)(https?://[^\s)<>]+)', text)
                    for url in matches:
                        key = hashlib.sha256(http_url(url).encode()).hexdigest()
                        index = self.safe(self.data / "articles" / (key + ".json"))
                        if not index.exists(): json_write(index, {"url": url, "path": str(file.relative_to(self.root)), "legacy": True})
            json_write(marker, {"schemaVersion": 1, "completedAt": utc_now()})

    def run(self, mode, date, source_id=None):
        datetime.strptime(date, "%Y%m%d")
        if mode in ("collect", "pipeline"): self.migrate_articles()
        results = []
        for source in self.registry()["sources"]:
            if source_id and source["id"] != source_id: continue
            if not source["enabled"]:
                results.append({"sourceId": source["id"], "status": "skipped", "reason": "disabled"}); continue
            stage = "sync" if mode != "collect" else "collect"
            result = {"sourceId": source["id"], "status": "succeeded", "updated": 0, "collected": 0}
            try:
                with lock(self.safe(self.data / "locks"), source["id"]):
                    self.commit(source, lambda row: None)
                    if mode in ("sync", "pipeline"): result["updated"] = self.sync(source)
                    if mode in ("collect", "pipeline"):
                        stage = "collect"; result["collected"] = self.collect(source, date)
            except Exception as exc:
                error = {"stage": stage, "code": getattr(exc, "code", "write-failed"), "message": str(exc) if isinstance(exc, FeedError) else "The task failed while reading or saving source data.", "retryable": getattr(exc, "retryable", True)}
                result.update(status="skipped" if error["code"] in ("busy", "source-changed") else "failed", error=error)
                if result["status"] == "failed":
                    try: self.commit(source, lambda row: row.update(lastAttemptAt=utc_now(), lastError=error))
                    except (FeedError, OSError): pass
            results.append(result)
        if source_id and not results: results.append({"sourceId": source_id, "status": "skipped", "reason": "deleted"})
        report = os.environ.get("OPENMIND_ARTIFACT_REPORT_PATH")
        if report: json_write(Path(report), {"schemaVersion": 1, "artifacts": [{"declarationId": "articles", "logicalPath": file} for file in self.saved_paths if "/.updates/" not in file]})
        failures = sum(row["status"] == "failed" for row in results)
        return {"status": "partial" if failures and any(row["status"] == "succeeded" for row in results) else "failed" if failures else "succeeded", "results": results}


def article_text(entry):
    # Use full content embedded by a publisher; otherwise extract the original.
    raw = entry.get("content")
    if not raw:
        data, _ = fetch(entry["url"])
        raw = data.decode("utf-8", errors="replace")
    try:
        import trafilatura
        text = trafilatura.extract(raw, include_links=True, include_comments=False, output_format="markdown")
    except ImportError:
        text = None
    if not text:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(raw, "html.parser")
        for node in soup(["script", "style", "nav", "footer", "header"]): node.decompose()
        main = soup.find("article") or soup.find("main") or soup
        text = main.get_text("\n", strip=True)
    if not text or len(text.strip()) < 20: raise FeedError("article-empty", "The original article has no readable body or requires login.", True)
    return text
