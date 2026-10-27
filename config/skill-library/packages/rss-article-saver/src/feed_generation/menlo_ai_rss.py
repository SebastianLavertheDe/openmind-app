from institution_feed import FilteredRSSFeed, run


class MenloAIRSSGenerator(FilteredRSSFeed):
    title = "Menlo Ventures AI"
    base_url = "https://menlovc.com/focus-areas/ai/"
    rss_url = "https://menlovc.com/?feed=rss2"
    description = "Articles and reports tagged AI by Menlo Ventures"
    output_file = "menlo_ai_rss.xml"
    required_tag = "ai"


if __name__ == "__main__":
    raise SystemExit(run(MenloAIRSSGenerator))
