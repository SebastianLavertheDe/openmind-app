import type { TranslationOf } from "../types";
import type { creativeUiMessages as zhCN } from "../zh-CN/creative-ui";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Creative workspace, editor, history, and local review heuristics. */
export const creativeUiMessages = {
  workspace: {
    eyebrow: "Creative Studio", title: "Creative Studio", description: "All topics, drafts, content ready to publish, and published work.",
    analyticsDescription: (topics: number, projects: number, completion: number) => `${count(topics, "topic")} · ${count(projects, "draft")} · ${completion}% average completion`,
    refresh: "Refresh", tabsAria: "Creative views", tabs: { workflow: "Workspace", history: "Version history", release: "Publication history", analytics: "Analytics" }, search: "Search topics or drafts", completion: (value: number) => `${value}% complete`,
    emptyProjects: { title: "No drafts yet", description: "Create a draft from a topic on the left to see it here." }, streamWidth: "Content list width", expandList: "Expand content list", autoSaveFailed: (detail: string) => `Autosave failed: ${detail}`,
    switchFile: { title: "Switch files", body: "This file has unsaved changes. Your draft will be preserved before switching. Continue?", confirm: "Switch files" },
    editorVersionNote: "Before saving in the editor", savedWithVersion: "Draft saved and version created", untitledProject: "Untitled project", draftTitle: "Draft", reusedDraft: "This topic already has a draft. The existing draft is now open.",
    createdDraft: (platform: string) => `Draft created (${platform})`, createdProject: "Draft created", stageEntered: (stage: string) => `Draft moved to ${stage}`, platformRequired: "Select a target platform first", exportedTo: (file: string) => `Exported to ${file}`, exportCancelled: "Export cancelled", copied: "Draft copied",
    archive: { title: "Archive draft", body: "Archiving moves this draft to the archive and keeps its content. Archive it?", confirm: "Archive", success: "Draft archived" }, contextProject: "Creative draft", contextTopic: "Recommended topic"
  },
  topic: {
    score: (score: number) => `Recommendation score ${score}`, askAi: "Ask AI", createDraft: "Create draft", creatingDraft: "Creating…", hasDraft: "This topic already has a draft. Continue it in the Drafting stage.", pickPlatform: "Choose a platform and template", genericDraft: "General draft", loadingProject: (title: string) => `Reading “${title}”…`, noBody: "This topic has no further details.", reasonHeading: "Why this topic and how to approach it",
    outline: { title: "Suggested structure", hook: "Open with a recent fact or point of debate", explain: "Explain the reasons behind the change and its impact", evidence: "Support your assessment with related sources", close: "Close with an actionable suggestion or question" }
  },
  review: {
    checks: { closingDetail: "The ending should offer a clear viewpoint or suggested action" }, notify: { reset: "Review status reset" }, status: { approved: "Approved", changesRequested: "Changes requested", pending: "Pending" },
    heuristics: {
      bodyTooShort: { title: "Body is short", detail: (n: number) => `The body has ${count(n, "character")}. Consider adding evidence or examples.` },
      missingStructure: { title: "Missing section structure", detail: "Add at least one level-two heading to help readers scan the text." },
      missingSource: { title: "Missing verifiable sources", detail: "Add original links or references so readers can verify the information." },
      longParagraph: { title: "Paragraph is too long", detail: "Consider splitting this long paragraph into 2–3 shorter ones to improve readability." },
      missingTitle: { title: "Missing main title", detail: "The body should begin with a level-one heading." },
      titleTooLong: { title: "Title is long", detail: (n: number) => `The title has ${count(n, "character")}. Some platforms may truncate it.` },
      weakEnding: { title: "Ending needs a stronger close", detail: "Close with a conclusion, suggested action, or open question." }
    }
  },
  publish: {
    title: "Prepare to publish", exported: "Exported", pendingExport: "Ready to export", note: "Platform publishing APIs are not connected. Export a Markdown file locally, then upload it to the platform yourself.",
    platformLabel: "Target platform (available local export templates only)", platformPlaceholder: "Select a platform", summary: "Summary / introduction", summaryPlaceholder: "Describe this article in one sentence", tags: "Tags (comma separated)", tagsPlaceholder: "AI, local first", cover: "Cover path (local, optional)", coverPlaceholder: "assets/cover.png",
    checks: { content: "Body complete (≥300 characters)", platform: "Platform configured", title: "Title", summary: "Summary", tags: "Tags", cover: "Cover" }, exporting: "Exporting", reexport: "Export again", exportNow: "Export now", blocked: "Required fields are missing. Complete them to export.", statusPrefix: "Status: "
  },
  stats: { chars: "Characters", headings: "Headings", paragraphs: "Paragraphs", images: "Images", links: "Links", longBlocks: "Long paragraphs", longBlocksTitle: "Very long paragraphs can reduce readability" },
  materials: { empty: "No source materials are recorded for this draft yet." }, files: { title: "Draft files" }, ai: { addContext: "Add to AI context" }, notes: { saved: "Creative notes saved" }, versions: { empty: "Save a file to create version history here." },
  releaseDetail: {
    stageEntered: (stage: string) => `Project moved to ${stage}`, createdFromTopic: "Project created from a recommended topic", fileSaved: (file: string) => `Saved ${file}`, publishStatus: (status: string) => `Publication status changed to ${status}`, versionRestored: "Historical version restored as a new version", copiedFrom: (p: string) => `Copied from ${p}`, archived: "Project archived", restoredFromArchive: "Project restored from archive"
  },
  inlineAi: {
    rewrite: "Rewrite", extend: "Continue", shorten: "Shorten", tone: "Change tone", translate: "Translate",
    rewriteInstruction: "Rewrite the following passage in a different way, preserving its meaning and Markdown structure",
    extendInstruction: "Continue the following passage, preserving its tone and Markdown structure",
    shortenInstruction: "Condense the following passage into key points, preserving essential information and Markdown structure",
    toneInstruction: "Make the following passage more conversational, as if explaining it to a friend, following Kill the AI Tone",
    translateInstruction: "Translate the following passage into English (or into Chinese if it is already in English), preserving its Markdown structure",
    generateFailed: "Generation failed", promptSuffix: ". Return only the resulting text, with no explanation or enclosing code fence. Follow Kill the AI Tone: state ideas directly, use concrete situations and examples, and avoid “not X, but Y” framing.", originalPrefix: "Original:\n\n",
    toolbar: "AI actions for selected text", selectedChars: (n: number) => `${count(n, "character")} selected`, generating: "Generating", result: "AI result", cancel: "Cancel", retry: "Retry", close: "Close", busyEllipsis: "…", replaceSelection: "Replace selection", replaceSelectionTitle: "Replace selected text", discard: "Discard", replaceFootnote: (start: number, end: number) => `Replaces the selected characters ${start}–${end}. The draft is saved automatically.`, noOutput: "(No output)"
  },
  history: {
    restoreTitle: "Restore historical version", restoreBody: (note: string) => `Restore ${note} as the current content. The existing content will be saved as a separate version.`, restoreConfirm: "Restore", restored: "Historical version restored as a new version", pickProject: "Select a draft", pickProjectDesc: "View file version history, compare any two versions, or restore a version.", noFile: "No files available to compare", pickMarkdown: "Select a Markdown file to view its versions.", versionA: "Version A", versionB: "Version B", currentContent: "Current content", diffAria: "Unified diff", pickTwoVersions: "Select two versions to compare.", diffTruncated: "This diff is long. Only the first 600 lines are shown; view the complete versions in the file folder.", versions: "Version history", restoreAsNew: "Restore as a new version", empty: "Save a file or change its stage to create version history here."
  },
  release: { pickProjectDesc: "View this draft's full history of exports, publications, reviews, and stage changes.", searchPlaceholder: "Search by action, platform, status, or details", target: (t: string) => `Target: ${t}`, empty: "This draft has no publication or stage history yet." },
  analytics: {
    loading: "Summarizing creative activity", noData: "No data to analyze yet", noDataDesc: "Create a draft to see locally calculated metrics here.", title: "Local creative analytics", subtitle: "Shows metrics that can be calculated locally. External views and engagement are not connected.", totalProjects: "Total drafts", published: "Published", avgCycle: "Average completion time", avgCycleHint: "Time from creation to publication", avgCompletion: "Average completion", stageDistribution: "Stage distribution", stageDistributionHint: "Number of drafts in each stage", platformDistribution: "Platform distribution", platformDistributionHint: "Target platforms used by drafts", noPlatform: "No platforms recorded yet.", stageDuration: "Time in each stage", stageDurationHint: "Average hours spent in each stage"
  },
  stream: {
    recommendScore: (score: number) => ` · Score ${score}`, hasDraft: " · Draft exists", emptyAllTitle: "No creative content yet", emptyFilterTitle: "No content in this stage", emptyAllDesc: "Recommended topics and creative drafts will appear here.", emptyFilterDesc: "Try another stage.", funnelAria: "Creative pipeline", undated: "Undated", noPlatform: "No platform set", completion: (n: number) => `${n}% complete`, topicManagementFile: "Topic management file"
  },
  writingStats: { aria: "Writing statistics" },
  editor: {
    modeBar: "Editor mode", edit: "Edit", preview: "Preview", toolbar: "Markdown formatting", textareaAria: "Markdown draft editor", placeholder: "Start writing, or type / to insert headings, lists, quotes, code blocks, and images…",
    heading: "Heading", headingPlaceholder: "Subheading", bold: "Bold", boldPlaceholder: "Bold text", italic: "Italic", italicPlaceholder: "Italic text", list: "Bulleted list", listPlaceholder: "List item", orderedList: "Numbered list", quote: "Quote", quotePlaceholder: "Quote", code: "Code block", codePlaceholder: "Code", inlineCode: "Inline code", inlineCodePlaceholder: "Code", link: "Link", linkPlaceholder: "Link text", image: "Image", imagePlaceholder: "Image description",
    localFile: "Local file", localFileNotify: "Local file link inserted", addedContextNotify: "Added to AI context", previewEmptyTitle: "Nothing to preview yet", previewEmptyDesc: "Switch to edit mode and write some content to preview it here.", selectLeftTitle: "Select content on the left", selectLeftDesc: "Topics, drafts, content ready to publish, and published work are listed by stage on the left.", shortcutBold: "Bold (Ctrl+B)", shortcutItalic: "Italic (Ctrl+I)", shortcutLink: "Link (Ctrl+K)", shortcutCode: "Inline code (Ctrl+E)", loadingTopics: "Loading creative data",
    fileTruncatedWarn: "This file exceeds 512 KB, so only part of it is loaded. Autosave is disabled. Use an external editor to avoid losing data.", openDir: "Open folder", reexport: "Export again", openExportedFile: "Open exported file", exportNotRecorded: "Not recorded", publishedSummary: "Published", publishMetricsNote: "Platform views, likes, and engagement are not connected.", exportFileLabel: "Exported file",
    status: { editing: "Editing…", autoSaving: "Autosaving…", autoSaveFailed: "Autosave failed. Try saving again.", autoSaved: "Autosaved", saved: "Saved" }, savingVersion: "Saving", saveVersion: "Save version", copy: "Copy", archive: "Archive", enterStage: (stage: string) => `Move to ${stage}`,
    slash: {
      menu: "Markdown insert commands", heading: "Level-two heading", bullet: "Bulleted list", ordered: "Numbered list", todo: "Task list", todoPlaceholder: "To-do item", quote: "Block quote", code: "Code block", image: "Image", divider: "Divider",
      keywords: { heading: ["h2", "title", "heading"], bullet: ["list", "ul", "bullet"], ordered: ["ol", "number", "ordered"], todo: ["task", "check", "todo"], quote: ["quote", "blockquote"], code: ["code", "codeblock"], image: ["image", "img", "picture"], divider: ["hr", "line", "divider"] }
    }
  },
  topicFile: {
    switch: { title: "Switch topic files", body: "This topic file has unsaved changes. Discard them and switch files?", confirm: "Discard and switch" }, savedNotice: "Topic management file saved", badge: "Topic file", dirty: "Editing · Unsaved", saved: "Saved", viewMode: "View mode", preview: "Preview", edit: "Edit", saving: "Saving", save: "Save", open: "Open file", truncated: "This file is too large. Only the first 1 MB is shown, and it cannot be saved in the app.", editAria: "Edit topic management file"
  }
} satisfies TranslationOf<typeof zhCN>;
