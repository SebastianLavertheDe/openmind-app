from institution_feed import FilteredRSSFeed, run


class GreylockAIRSSGenerator(FilteredRSSFeed):
    title = "Greylock AI"
    base_url = "https://greylock.com/blog/greymatter/"
    rss_url = "https://greylock.com/blog/feed.xml"
    description = "AI articles and interviews selected from Greylock's blog"
    output_file = "greylock_ai_rss.xml"


if __name__ == "__main__":
    raise SystemExit(run(GreylockAIRSSGenerator))
