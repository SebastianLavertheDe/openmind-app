import type { TranslationOf } from "../types";
import type { appMessages as zhCN } from "../zh-CN/app";

export const appMessages = {
  app: {
    fatalTitle: "OpenMind could not start",
    preloadMissing: "Electron preload did not load. The desktop app cannot use browser preview data as a fallback. Restart the packaged app or check that preload.js exists.",
    splashStarting: "Starting your workspace…", routeLoading: "Opening page…"
  },
  shell: {
    navExpand: "Expand navigation", navCollapse: "Collapse navigation", navMenu: "Open navigation menu", navMain: "Main navigation", moreActions: "More global actions",
    searchPlaceholder: "Search the library, drafts, and conversations", searchShort: "Search", openProject: (name: string) => `Open project folder: ${name}`,
    statusPreview: "Preview data", statusConnected: "Local data connected", notifications: "View notifications", notificationsShort: "Notifications", help: "Open help", helpShort: "Help",
    recentTasksAria: "Recent tasks", recentOpen: "Open task"
  },
  search: {
    dialogLabel: "Command palette", inputAria: "Describe a task or search the library, drafts, conversations, and automations", placeholder: "Describe a task, or search the library, drafts, and conversations…",
    loading: "Searching", resultsAria: "Search and actions",
    hintShort: "Describe a task for AI, such as “Summarize today's 3 articles”, or enter keywords to search the library, drafts, conversations, and automations.",
    hintEmpty: "No matching local content, drafts, conversations, or Skills. Press Enter to ask AI to handle this request.",
    actionSection: "AI actions", runningSuffix: "· Running",
    groups: { content: "Library", project: "Projects", "creative-project": "Drafts", session: "AI conversations", skill: "Automation" },
    actions: {
      summarize: { badge: "Read only · Summarize", title: "Summarize today's content", why: (date: string) => `Matches a summary request · Read today's (${date}) inbox and article content and return key points in English` },
      createDraft: { badge: "Create · Edit", title: "Write a content draft", why: "Matches a writing request · Run with edit permissions and return a draft" },
      compare: { badge: "Read only · Analyze", title: "Compare related content", why: "Matches a comparison request · Analyze similarities and differences across two or more sources in read-only mode" }
    },
    intentPatterns: {
      summarize: /总结|摘要|归纳|要点|概览|梳理|summari[sz]e|summary/i,
      createDraft: /小红书|公众号|推文|开头|写一|起草|改写|续写|草稿|改个|润色|重写|draft|rewrite|write/i,
      compare: /对比|比较|区别|异同|\bvs\.?\b|compare|difference/i
    },
    prompts: {
      summarize: (date: string, userText: string) => `Read today's (${date}) content in openmind/article and inbox, select the most relevant items, and return key points in English with a source filename for each point. ${userText}`,
      createDraft: (text: string, userText: string) => `${text}. Follow openmind's “Kill the AI Tone” writing guidelines: state ideas directly, use concrete situations and examples, and avoid “not X, but Y” framing. Return Markdown. ${userText}`,
      compare: (userText: string) => `Read the relevant sources without modifying them, and compare their similarities and differences in a table or bullet points. ${userText}`
    },
    userPrefix: (text: string) => `User's original request: “${text}”`
  }
} satisfies TranslationOf<typeof zhCN>;
