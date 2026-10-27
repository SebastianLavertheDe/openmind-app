import type { TranslationOf } from "../types";
import type { aiMessages as zhCN } from "../zh-CN/ai";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : noun.endsWith("ch") ? "es" : "s"}`;

/** AI conversations, tools, permissions, and activity. */
export const aiMessages = {
  session: {
    new: "New conversation", recent: "Recent conversations", list: "AI conversations", empty: "No conversations yet", unpin: "Unpin", pin: "Pin", archiveTask: "Archive task",
    archiveNamed: (title: string) => `Archive conversation: ${title}`, archived: "Conversation archived", archiveFailed: "Could not archive conversation", updateFailed: "Could not update conversation",
    unarchived: "Conversation unarchived", pinned: "Conversation pinned", unpinned: "Conversation unpinned", moreActions: "More actions"
  },
  workbench: {
    draftStatus: "Not created yet", unsavedTitle: "Discard unsaved changes", unsavedConfirm: "This file has unsaved changes. Discard them?", unsavedConfirmText: "Discard changes",
    filePreviewWidth: "File preview width", filePreview: "File preview", viewMode: "File view mode", preview: "Preview", edit: "Edit", fileTooLargePreviewOnly: "This file is too large; only a partial preview is available",
    editFile: "Edit file", fileTooLargeCannotSave: "This file is too large; the partial content cannot be saved directly", saveFile: "Save file", noUnsavedChanges: "No unsaved changes", saving: "Saving", save: "Save",
    closeFilePreview: "Close file preview", loadingFile: "Loading file…", fileMissing: "The file does not exist or has been deleted",
    fileTruncatedWarning: "This file exceeds the preview limit. Only the first 5 MB are shown in read-only mode to prevent overwriting the remaining content.",
    editFileContent: "Edit file content", saved: "Saved", discardDirtyTitle: "Switch to preview", discardDirtyConfirm: "This file has unsaved changes. Switching to preview will discard them. Continue?", discardDirtyConfirmText: "Discard and preview"
  },
  chat: {
    loadingHistory: "Loading…", loadMoreEvents: (n: number) => `Load ${count(n, "earlier event")}`, loadOlderTurns: "Load earlier turns", transcriptLabel: "Conversation messages", jumpToBottom: "Jump to bottom", currentProject: "Current workspace",
    newTaskTitle: "What can I help you with?",
    emptyTitle: "Turn your sources into content with AI", emptyBody: "Describe your goal. AI reads the current workspace to organize sources, create content, and run workflows within your permissions.",
    emptyHint: "Ctrl/⌘ + K to search tasks · Ctrl/⌘ + Enter to send", processing: "Processing", processed: "Processed", finalMissing: "Final reply missing",
    finalMissingDetail: "The provider finished without returning a final reply. This run was not marked as successful.",
    emptyPrompts: [
      { title: "Organize the library", body: "Group new sources, extract key points, and keep references", prompt: "Review the content added to the library today, group it by topic, extract the key information, and keep a source link for each item." },
      { title: "Create a daily brief", body: "Summarize today's highlights, trends, and next steps", prompt: "Create a daily brief from today's new sources, organizing highlights, trends, and suggested next steps by topic." },
      { title: "Start creating content", body: "Choose a topic, build an outline, and write a first draft", prompt: "Choose a topic from the library that is worth developing, explain why you chose it, and create an outline and first draft." },
      { title: "Check automations", body: "Review recent runs and issues that need attention", prompt: "Check recent runs of automations such as RSS collection and daily summaries. Summarize successes, failures, and suggested fixes." }
    ],
    newEventsBadge: (n: number) => `${n}`
  },
  permission: { label: "Permissions", readOnly: "Read only", edit: "Edit", auto: "Run automatically", autoShort: "Auto" },
  mode: { label: "Mode", default: "Execute", plan: "Plan", planActive: "Plan mode" },
  composer: {
    queuedMessage: (n: number) => `Queued message ${n}`,
    removeQueuedMessage: (n: number) => `Remove queued message ${n}`,
    viewQueuedMessage: (n: number) => `View queued message ${n}`,
    closeError: "Dismiss error", queuedSummary: (n: number) => `${count(n, "message")} queued`, cancelQueued: "Cancel queued messages", messageInput: "AI message", placeholderContinue: (title: string) => `Continue ${title}`,
    placeholderNew: "Describe a task or ask anything", addAttachment: "Add attachment", stop: "Stop", stopping: "Stopping", enqueue: "Add to queue", send: "Send", charCount: (n: number) => count(n, "character"), sendShortcut: "⌘↵ Send",
    provider: "Provider", openWorkspace: "Open current project", projectTargetHint: (name: string) => `New conversations are automatically created as tasks in “${name}”`, moreActions: "More actions",
    imageTooLarge: (size: string) => `This image is too large (${size} MB). The limit is 2 MB.`, imageReadFailed: "Could not read the image.", imagePreview: "Image preview", closePreview: "Close preview", previousImage: "Previous image", nextImage: "Next image"
  },
  context: {
    count: (n: number) => count(n, "context item"), clear: "Clear", inline: "Inline context", chars: (n: number) => ` · ${count(n, "character")}`, moveUp: "Move up", moveDown: "Move down", remove: "Remove",
    detail: (label: string) => `${label} details`, selection: "Quoted content", removeNamed: (label: string) => `Remove reference: ${label}`, removeImage: (label: string) => `Remove image: ${label}`, removeThis: "Remove this reference"
  },
  suggestions: {
    mentionAria: "Reference a file", mentionTitle: "Reference an openmind file", searchQuery: (q: string) => `Search “${q}”`, enterFilename: "Enter a filename or path", filterSkill: (q: string) => `Filter “/${q}”`,
    pickWorkflow: "Choose a registered workflow to run", searchingFiles: "Searching files", startTyping: "Enter a filename to search",
    mentionHelp: "Search by filename, folder, or partial match within openmind/. Sensitive credentials are excluded from autocomplete.", noOpenmindMatch: "No matching files in openmind",
    tryAnotherKeyword: "Try another keyword, or choose Browse files to select one manually.", noSkillMatch: "No matching Skills", skillRetryHint: "Remove some characters and try again, or type / to see all registered Skills.",
    kbdSelect: "Select", kbdConfirm: "or Enter to confirm", kbdClose: "Close", browseOpenmind: "Browse openmind", indexTruncatedTitle: "The openmind file count exceeds the index limit; results may be incomplete",
    indexedCount: (n: number, truncated: boolean) => `${count(n, "file")} indexed${truncated ? " · Limit reached" : ""}`
  },
  message: {
    showMore: "Show more", showLess: "Show less",
    you: "You", quote: "Quote", quoteMessage: "Quote message", editResend: "Edit and resend", branchFromMessage: "Start a new conversation from this message", rerun: "Rerun with the original context", quoteReply: "Quote reply",
    branchFromReply: "Start a new conversation from this reply", copied: "Copied", copy: "Copy", artifactLabel: "Artifact · Markdown", artifactDocument: "Document", artifactStreaming: "Generating", artifactComplete: "Complete",
    artifactIncomplete: "Incomplete", artifactIncompleteDetail: "The artifact format was not completed. The current text has been preserved.", copyArtifact: "Copy text", contextsUsed: (n: number) => `${count(n, "context item")} used`,
    imageAttachment: "Image attachment", previewFile: (path: string) => `Preview ${path}`, viewImage: (alt: string, src: string) => `View image: ${alt || src}`, userLabel: "User message", assistantLabel: "AI reply"
  },
  tool: {
    fallbackName: "Tool", call: "Tool call", runFailed: "Run failed", ran: "Ran", running: "Running",
    commandGroupRan: (n: number) => `Ran ${count(n, "command")}`, commandGroupRunning: (n: number) => `Running ${count(n, "command")}`,
    commandGroupCancelled: (n: number) => `Commands cancelled · ${n} total`, commandGroupFailedTitle: (n: number) => `Commands failed · ${n} total`, commandGroupConflicted: (n: number) => `Command conflicts · ${n} total`,
    commandGroupIncomplete: (n: number) => `Incomplete command results · ${n} total`, commandGroupFailed: (n: number) => `${n} failed`, commandGroupCancelledCount: (n: number) => `${n} cancelled`, commandGroupIncompleteCount: (n: number) => `${n} incomplete`,
    toolGroupRan: (n: number) => `Ran ${count(n, "tool")}`, toolGroupRunning: (n: number) => `Running ${count(n, "tool")}`, toolGroupCancelled: (n: number) => `Tools cancelled · ${n} total`, toolGroupFailedTitle: (n: number) => `Tools failed · ${n} total`,
    toolGroupConflicted: (n: number) => `Tool conflicts · ${n} total`, toolGroupIncomplete: (n: number) => `Incomplete tool results · ${n} total`, toolGroupFailed: (n: number) => `${n} failed`, toolGroupCancelledCount: (n: number) => `${n} cancelled`, toolGroupIncompleteCount: (n: number) => `${n} incomplete`,
    commandRunning: (elapsed: string) => `Running command · ${elapsed} elapsed`, commandRan: (elapsed: string) => `Command ran · ${elapsed} elapsed`, commandFailed: "Command failed", commandCancelled: "Command cancelled", commandIncomplete: "Incomplete command result", incomplete: "Incomplete result",
    detail: "Call details", outputCount: (n: number) => count(n, "output item"), noOutput: "No output yet", searchIO: "Search tool inputs and outputs", searchPlaceholder: "Search inputs and outputs", saveOutput: "Save output", request: "Request", errorResult: "Error result", result: "Result", output: "Output",
    query: "Query", scope: "Scope", currentProject: "Current project", matches: "Matches", matchCount: (n: number) => count(n, "match"), path: "Path", fullRange: "Full text or default range", encoding: "Encoding", auto: "Auto", preview: "Preview", command: "Command", viewRequestDetail: "View request details",
    cwd: "Directory", exitCode: "Exit code", file: "File", readFile: (name: string) => `Read file ${name}`, viewedImages: (n: number) => `Viewed ${count(n, "image")}`, operation: "Operation", writeEdit: "Write/Edit", outcome: "Outcome", recorded: "Recorded", context: "Context", eventCount: (n: number) => count(n, "event"), input: "Input", structuredParams: "Structured parameters", rawParams: "Raw parameters",
    loadMoreOutput: "Load more output", loadMoreOutputProgress: (shown: number, total: number) => `Load more (${shown} of ${total} characters shown)`, expandAllOutput: "Expand all", viewCommandDetail: "View command details", viewSearchDetail: "View search details", viewFileDetail: "View file details", viewNetworkDetail: "View network request details", viewCallDetail: "View call details",
    category: { command: "Command", search: "Search", read: "Read", write: "Write", network: "Network", skill: "Skill", tool: "Tool" }
  },
  file: { open: "Open file", revealFolder: "Show in folder" },
  status: {
    failed: "Failed", cancelled: "Cancelled", running: "Running", completed: "Complete", success: "Succeeded",
    run: { queued: "Queued", running: "Running", waitingApproval: "Awaiting approval", completed: "Completed", failed: "Failed", cancelled: "Cancelled", applying: "Applying", conflicted: "Conflicts found" },
    session: { idle: "Idle", running: "Running", waitingApproval: "Awaiting approval", failed: "Failed" }
  },
  approval: {
    banner: "Actions awaiting approval", alreadyHandled: "This approval has already been handled by another action.", required: "Your approval is required", pending: "Pending", requestDetail: "Request details", affectedPaths: "Affected paths",
    sessionHint: "Allow for this conversation remembers only the same category and command. It does not allow deletion, privilege elevation, or access outside the project.", decline: "Decline", acceptSession: "Allow for this conversation", allow: "Allow", executeAsk: "Execute", details: "Details",
    category: { command: "Command", fileChange: "File change", delete: "Delete", outsideWorkspace: "Access outside project", network: "Network", elevation: "Privilege elevation", tool: "Tool" },
    decisionLine: { declined: (subject: string) => `Declined ${subject}`, ran: (subject: string) => `Ran ${subject}` }, decision: { declined: "Declined", processed: "Processed" },
    declinedToast: (subject: string) => `Declined: ${subject}`, undo: "Undo", undoExpired: "The undo window has expired", batchSummary: (n: number) => `${count(n, "action")} awaiting approval`, allowAll: "Allow all", declineAll: "Decline all"
  },
  diff: {
    editedFiles: (n: number) => `Edited ${count(n, "file")}`, editedFile: "Edited file", showMoreFiles: (n: number) => `Show ${count(n, "more file")}`, showFewerFiles: "Show fewer", changesUpdated: "Changes updated",
    providerReported: "The provider reported file changes. View the detailed diff in conversation details on the right.", status: { created: "Created", modified: "Modified", deleted: "Deleted", renamed: "Renamed" }
  },
  events: {
    riskTitle: "Risk notice", systemTitle: "System event", runFailed: "Run failed", runDetail: "Run details", runDetailSubtitle: "Initialization, status, and lifecycle events", system: "System", status: "Status", systemEvent: "System event", statusUpdate: "Status update",
    completed: "Run completed", cancelled: "Run cancelled", contextCompacted: "Context compacted automatically", systemWarning: "System warning", subtaskFallback: "Subtask", subtaskStarted: "Started", subtaskUpdated: "Running", subtaskCompleted: "Completed", subtaskFailed: "Failed", subtaskCancelled: "Cancelled", subtaskAgents: (n: number) => count(n, "agent")
  },
  activity: {
    waitingApproval: "Awaiting your approval", waitingApprovalDetail: "AI is paused and will resume here once the approval is handled.", applyingChanges: "Applying file changes", applyingChangesDetail: "Updating the current project folder. Please wait.", executingTool: (tool: string) => `Running ${tool}`,
    continuing: "Continuing to the next step", continuingDetail: "The tool call finished. AI is deciding whether to continue or return a final reply.", decidingNext: "Deciding the next step", decidingNextDetail: "Reasoning is complete. Preparing a reply or the next action.",
    ready: "Local AI is ready", readyDetail: "Reading project context and analyzing your request.", stillWaiting: "Still waiting for a response", stillWaitingDetail: "No new events have arrived for a while. You can view diagnostics or stop the run.",
    longRunning: "Local AI is still running. You can keep typing; additional messages will be queued.", firstBoot: "The first start may need to load local configuration, Skills, and project context.", starting: "Starting the local process and creating a conversation.", startingProvider: (provider: string) => `Starting ${provider}`
  },
  trace: {
    reasoningCount: (n: number) => count(n, "reasoning step"), toolCount: (n: number) => count(n, "tool"), filesChanged: (n: number) => `${count(n, "file")} changed`, fileOps: (n: number) => count(n, "file operation"), approvals: (n: number) => count(n, "approval"), failures: (n: number) => count(n, "failure"), noTools: "No tool calls"
  },
  thought: { thinking: "Thinking", codexSummary: "Reasoning summary", process: "Reasoning", streaming: "Thinking", thinkingFor: (elapsed: string) => `Thinking · ${elapsed}` },
  reasoningPanel: { virtualHint: "Virtual scrolling is enabled for this long content" },
  overflow: {
    expandAll: "Expand full text", collapse: "Collapse", expandLines: (n: number) => `Expand all ${count(n, "line")}`, searchPlaceholder: "Search…", searchCount: (active: number, total: number) => `${active + 1} / ${total}`,
    searchNoMatch: "No matches", searchPrev: "Previous", searchNext: "Next", searchClose: "Close search", longOutputHint: "Long output: use ⌘F to search or download the full log"
  },
  plan: {
    aria: "Execution plan", liveAria: "Live task progress", stepProgress: (current: number, total: number) => `Step ${current} of ${total}`, historyTitle: "Plans and tasks", expand: "Expand", collapse: "Collapse", title: "Plan", todoTitle: "Task progress", sourceCodex: "Codex CLI", sourceClaude: "Claude Code SDK", completed: "Completed", inProgress: "In progress", pending: "Pending"
  },
  risk: { detected: "Potentially risky content detected" },
  sidebar: {
    dialogLabel: "AI assistant", close: "Close AI assistant", expand: "Expand AI sidebar", providerSelect: "AI provider", width: "AI sidebar width", viewInWorkbench: "View conversation in workbench", pendingContexts: (n: number) => `${count(n, "context item")} ready to send`,
    switchSession: "Switch AI conversation", newDraft: "New conversation draft", toggleWide: "Toggle wide view", fullscreen: "Full screen", exitFullscreen: "Exit full screen", collapse: "Collapse", openWorkbench: "Open in AI workbench"
  },
  providerChange: {
    title: "AI provider changed", body: (id: string) => `The configuration for this conversation's provider, “${id}”, has changed since the conversation was created. Continuing sends future messages to the service using its current configuration and updates the saved configuration fingerprint.`, confirm: "Continue", cancel: "Cancel"
  },
  error: {
    workerExit: (code?: number | null) => `The AI scheduler exited unexpectedly${code != null ? ` with code ${code}.` : "."}`, loadOlderFailed: (err: string) => `Could not load earlier messages: ${err}`, loadSessionFailed: (err: string) => `Could not load conversation: ${err}`,
    sessionNotFound: "The conversation to update was not found.", sendingInProgress: "A message is being sent. Please wait.", noProvider: "No available Claude Code or Codex installation was detected.", rerunNotFound: "The task to rerun was not found."
  },
  recovery: {
    skill: "View details in the automation or source run logs, then retry or rerun.", provider: "Open the AI workbench to check run logs, permissions, and approval records, then retry.", index: "Refresh this page. If the issue persists, rebuild the content index in Settings.",
    file: "Check the project folder boundary and file permissions, then try this action again.", default: "Try this action again. If it still fails, check the relevant page logs or system logs for details."
  },
  time: { unknown: "Unknown duration", milliseconds: (n: number) => `${n} ms`, seconds: (n: number) => count(n, "second"), secondsDecimal: (s: string) => `${s} second${Number(s) === 1 ? "" : "s"}`, minutesSeconds: (m: number, s: number) => `${m} min ${s} sec` },
  common: { notRecorded: "Not recorded", chars: (n: number) => count(n, "character") }
} satisfies TranslationOf<typeof zhCN>;
