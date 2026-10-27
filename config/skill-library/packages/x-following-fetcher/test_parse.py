import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import load_config
from src.fetcher.client import fetch_timeline
from src.parser.timeline import parse_timeline_payload


if __name__ == "__main__":
    config = load_config()
    response = fetch_timeline(config)
    tweets = parse_timeline_payload(response.payload)

    print(f"Parsed {len(tweets)} timeline entries")
    for tweet in tweets[:10]:
        print(f"- @{tweet.author.screen_name}: {tweet.tweet_id}")
