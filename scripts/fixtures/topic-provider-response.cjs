const labels = require('../../tests/rss/fixtures/topic-labels.json');

/** Synthetic provider responses for package/IPC smoke tests; never production data. */
module.exports = function topicProviderResponse(prompt, language = 'en', select) {
  if (prompt.includes('Configured platform IDs and names: ')) {
    const platforms = JSON.parse(prompt.split('Configured platform IDs and names: ')[1].split('\n')[0]);
    const candidates = JSON.parse(prompt.split('CANDIDATES:\n')[1]);
    const indexes = select ? select(candidates) : candidates.length ? [1] : [];
    return { platforms: platforms.map(platform => ({ id: platform.id, items: indexes.map(index => ({ index, reason: 'Supported source evidence' })) })), document: labels[language] };
  }
  if (prompt.includes('TOPIC_SOURCE:\n')) {
    const source = JSON.parse(prompt.split('TOPIC_SOURCE:\n')[1]);
    const title = source.extracted_title || source.title;
    return { titles: [title, `${title} 2`, `${title} 3`], core_view: source.extracted_summary, why: 'Supported evidence', audience: 'Readers', outline: 'Evidence and implications', hook: 'Original observations', visuals: 'Source screenshots', interaction: 'Discuss the evidence', risk: 'Verify source claims', recommendation: '8/10: Supported evidence' };
  }
  if (prompt.includes('EDITORIAL_TREATMENTS:\n')) {
    const groups = JSON.parse(prompt.split('EDITORIAL_TREATMENTS:\n')[1]);
    const first = groups.find(group => group.items.length);
    return { pick: { platformId: first.platformId, index: first.items[0].index }, judgment: 'Supported evidence', alternatives: 'Lower relevance', angle: 'Original observations', risk: 'Verify source claims', follow_up: ['Track source updates'], evergreen: ['Reusable research'] };
  }
};
