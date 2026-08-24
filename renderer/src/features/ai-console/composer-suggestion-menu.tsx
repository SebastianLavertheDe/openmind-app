import {
  FileSearch,
  FileText,
  FolderOpen,
  LoaderCircle,
  Package,
  Search
} from "lucide-react";
import type { ReactNode } from "react";
import type { PermissionProfile, ProjectFileMatch, SkillDefinition } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { fileIcon } from "./file-icon";

export type SuggestionMenuProps =
  | {
    kind: "mention";
    query: string;
    files: ProjectFileMatch[];
    loading: boolean;
    activeIndex: number;
    indexedCount: number;
    truncated: boolean;
    onActiveIndex(index: number): void;
    onChooseFile(file: ProjectFileMatch): void;
    onBrowse(): void;
  }
  | {
    kind: "skill";
    query: string;
    skills: SkillDefinition[];
    activeIndex: number;
    onActiveIndex(index: number): void;
    onChooseSkill(skill: SkillDefinition): void;
  };

export function ComposerSuggestionMenu(props: SuggestionMenuProps) {
  // P2-INT-3: active item 滚出视口时键盘选不到——scrollIntoView({block:'nearest'})
  const activeItemRef = (el: HTMLElement | null) => {
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  };
  return (
    <section className="composer-suggestion-menu" aria-label={props.kind === "mention" ? m.ai.suggestions.mentionAria : "Skills"}>
      <header>
        <span>{props.kind === "mention" ? <FileSearch size={14} /> : <Package size={14} />}</span>
        <div>
          <strong>{props.kind === "mention" ? m.ai.suggestions.mentionTitle : "Skills"}</strong>
          <small>
            {props.kind === "mention"
              ? props.query ? m.ai.suggestions.searchQuery(props.query) : m.ai.suggestions.enterFilename
              : props.query ? m.ai.suggestions.filterSkill(props.query) : m.ai.suggestions.pickWorkflow}
          </small>
        </div>
        {props.kind === "mention" && props.loading ? <LoaderCircle className="spin" size={14} aria-label={m.ai.suggestions.searchingFiles} /> : null}
      </header>
      <div className="composer-suggestion-list" id="composer-suggestions" role="listbox">
        {props.kind === "mention" ? (
          <>
            {!props.query ? (
              <SuggestionEmpty
                icon={<FileText size={18} />}
                title={m.ai.suggestions.startTyping}
                detail={m.ai.suggestions.mentionHelp}
              />
            ) : null}
            {props.query && !props.loading && !props.files.length ? (
              <SuggestionEmpty
                icon={<Search size={18} />}
                title={m.ai.suggestions.noOpenmindMatch}
                detail={m.ai.suggestions.tryAnotherKeyword}
              />
            ) : null}
            {props.files.map((file, index) => (
              <button
                id={`composer-suggestion-${index}`}
                key={file.path}
                type="button"
                role="option"
                aria-selected={props.activeIndex === index}
                className={props.activeIndex === index ? "active" : ""}
                ref={props.activeIndex === index ? activeItemRef : undefined}
                onMouseEnter={() => props.onActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => props.onChooseFile(file)}
              >
                <span className="suggestion-icon">{fileIcon(file.extension)}</span>
                <span className="suggestion-copy">
                  <strong>{file.name}</strong>
                  <small>{file.directory || "openmind"}</small>
                </span>
                {file.extension ? <code>{file.extension}</code> : null}
              </button>
            ))}
          </>
        ) : (
          <>
            {!props.skills.length ? (
              <SuggestionEmpty
                icon={<Package size={18} />}
                title={m.ai.suggestions.noSkillMatch}
                detail={m.ai.suggestions.skillRetryHint}
              />
            ) : null}
            {props.skills.map((skill, index) => (
              <button
                id={`composer-suggestion-${index}`}
                key={skill.id}
                title={`/${skill.id} [YYYYMMDD]`}
                type="button"
                role="option"
                aria-selected={props.activeIndex === index}
                className={props.activeIndex === index ? "active" : ""}
                ref={props.activeIndex === index ? activeItemRef : undefined}
                onMouseEnter={() => props.onActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => props.onChooseSkill(skill)}
              >
                <span className="suggestion-icon skill"><Package size={15} /></span>
                <span className="suggestion-copy">
                  <strong>{skill.id}<em>{skill.title}</em></strong>
                  <small>{skill.description}</small>
                </span>
                <span className={`permission-badge ${skill.permission || "edit"}`}>{permissionLabel(skill.permission || "edit")}</span>
              </button>
            ))}
          </>
        )}
      </div>
      <footer>
        <span><kbd>↑</kbd><kbd>↓</kbd>{m.ai.suggestions.kbdSelect}</span>
        <span><kbd>Enter</kbd>{m.ai.suggestions.kbdConfirm}</span>
        <span><kbd>Esc</kbd>{m.ai.suggestions.kbdClose}</span>
        {props.kind === "mention" ? (
          <button data-motion="icon" type="button" onMouseDown={(event) => event.preventDefault()} onClick={props.onBrowse}>
            <FolderOpen size={12} />{m.ai.suggestions.browseOpenmind}
          </button>
        ) : null}
        {props.kind === "mention" && props.indexedCount ? (
          <small title={props.truncated ? m.ai.suggestions.indexTruncatedTitle : undefined}>
            {m.ai.suggestions.indexedCount(props.indexedCount, props.truncated)}
          </small>
        ) : null}
      </footer>
    </section>
  );
}

function SuggestionEmpty({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="composer-suggestion-empty">
      {icon}
      <div><strong>{title}</strong><small>{detail}</small></div>
    </div>
  );
}

function permissionLabel(profile: PermissionProfile): string {
  if (profile === "read-only") return m.ai.permission.readOnly;
  if (profile === "auto") return m.ai.permission.autoShort;
  return m.ai.permission.edit;
}
