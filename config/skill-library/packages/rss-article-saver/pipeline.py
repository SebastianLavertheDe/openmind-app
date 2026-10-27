"""Machine-readable entrypoint. Human diagnostics never share stdout with JSON."""
import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from src.rss_pipeline import FeedError, Pipeline, detect, json_write


def emit_result(result):
    # Broker logs are bounded and may truncate a large JSON line. Keep the
    # machine-readable result in this run's private work directory as well.
    run = os.environ.get('OPENMIND_RUN_DIR')
    if run:
        json_write(Path(run) / 'result.json', result)
    print(json.dumps(result, ensure_ascii=False))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['sync', 'collect', 'pipeline', 'detect'], default='pipeline')
    parser.add_argument('--date', default=datetime.now().strftime('%Y%m%d'))
    parser.add_argument('--source-id', default='')
    args = parser.parse_args()
    try:
        catalog_path = Path(os.environ.get('OPENMIND_RSS_CATALOG') or Path(__file__).with_name('rss-catalog.json'))
        catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
        if args.mode == 'detect':
            request = json.load(sys.stdin)
            result = detect(request['url'], catalog, request.get('selectedFeedUrl'))
        else:
            root = os.environ.get('OPENMIND_ROOT', '')
            data = os.environ.get('OPENMIND_SKILL_DATA_DIR', '')
            if not root or not data: raise FeedError('invalid-root', 'Explicit content root and Skill data directory are required.')
            result = Pipeline(root, data, catalog).run(args.mode, args.date, args.source_id or None)
        emit_result(result)
        return 1 if result.get('status') in ('failed', 'partial') else 0
    except Exception as exc:
        emit_result({'error': {'stage': 'detect' if args.mode == 'detect' else args.mode, 'code': getattr(exc, 'code', 'invalid-config'), 'message': str(exc) if isinstance(exc, FeedError) else 'The RSS configuration or runtime could not be loaded.', 'retryable': getattr(exc, 'retryable', False)}})
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
