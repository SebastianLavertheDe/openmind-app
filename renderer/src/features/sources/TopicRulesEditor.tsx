import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { topicPromptContext, type DailyBriefPreferences, type TopicPlatform } from "@shared/daily-brief-preferences";
import { messages as m } from "@shared/messages";
import { AnimatedDisclosure, Button, FormField, IconButton, Input, Textarea } from "../../design-system/components";

type TopicDraft = { topicPrompt: string; topicPlatforms: TopicPlatform[]; text: string };
export function TopicRulesEditor({ value, disabled, onChange }: {
  value: TopicDraft; disabled: boolean; onChange(patch: Partial<DailyBriefPreferences>): void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const editPlatform = (id: string, patch: Partial<TopicPlatform>) => onChange({ topicPlatforms: value.topicPlatforms.map(platform => platform.id === id ? { ...platform, ...patch } : platform) });
  return <div className="topic-rules-editor">
    <FormField label={m.rss.topicPrompt} hint={m.rss.topicPromptHint}>
      <Textarea value={value.topicPrompt} onChange={event => onChange({ topicPrompt: event.target.value })} rows={6} maxLength={20000} disabled={disabled} placeholder={m.rss.topicPromptPlaceholder} />
    </FormField>
    <div className="topic-platform-heading"><strong>{m.rss.platformRules}</strong><Button size="sm" disabled={disabled || value.topicPlatforms.length >= 12} onClick={() => onChange({ topicPlatforms: [...value.topicPlatforms, { id: crypto.randomUUID(), name: "", prompt: "" }] })}><Plus size={14} />{m.rss.addPlatform}</Button></div>
    <p className="rss-muted">{m.rss.platformRulesHint}</p>
    {value.topicPlatforms.map((platform, index) => {
      const name = platform.name.trim().normalize("NFKC").toLowerCase();
      const duplicate = name && value.topicPlatforms.some(other => other.id !== platform.id && other.name.trim().normalize("NFKC").toLowerCase() === name);
      return <section key={platform.id} className="topic-platform-editor" aria-label={platform.name || m.rss.platformNumber(index + 1)}>
        <div className="topic-platform-heading">
          <FormField className="topic-platform-name" label={m.rss.platformName} error={!name ? m.rss.platformNameRequired : duplicate ? m.rss.platformNameDuplicate : undefined}>
            <Input value={platform.name} onChange={event => editPlatform(platform.id, { name: event.target.value })} maxLength={80} disabled={disabled} placeholder={m.rss.platformNamePlaceholder} />
          </FormField>
          <IconButton label={m.rss.removePlatform(platform.name || m.rss.platformNumber(index + 1))} disabled={disabled} onClick={() => onChange({ topicPlatforms: value.topicPlatforms.filter(other => other.id !== platform.id) })}><Trash2 size={16} /></IconButton>
        </div>
        <FormField label={m.rss.platformPrompt}>
          <Textarea value={platform.prompt} onChange={event => editPlatform(platform.id, { prompt: event.target.value })} rows={5} maxLength={12000} disabled={disabled} placeholder={m.rss.platformPromptPlaceholder} />
        </FormField>
      </section>;
    })}
    {!value.topicPlatforms.length ? <p className="rss-muted">{m.rss.noPlatformRules}</p> : null}
    <p className="rss-muted">{m.rss.topicOutputHint}</p>
    <AnimatedDisclosure variant="inline" open={previewOpen} onOpenChange={setPreviewOpen} summary={m.rss.previewTopicRules}>
      <FormField label={m.rss.assembledTopicRules}><Textarea readOnly variant="code" rows={12} value={topicPromptContext({ schemaVersion: 1, revision: 0, updatedAt: null, ...value })} /></FormField>
    </AnimatedDisclosure>
  </div>;
}
