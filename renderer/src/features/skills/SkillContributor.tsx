import { useEffect, useState, type MouseEvent } from "react";
import { UserRound } from "lucide-react";
import { SkillContributorProfileUrlSchema, type SkillContributorView } from "@shared/skill-contributor";
import { useFeedback } from "../../feedback-context";

export function SkillContributor({ contributor, size = "sm" }: { contributor: SkillContributorView; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const feedback = useFeedback();
  const profile = SkillContributorProfileUrlSchema.safeParse(contributor.profileUrl);
  const profileUrl = profile.success ? profile.data : undefined;
  const openProfile = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (profileUrl) void window.openmind.openExternal(profileUrl).catch(cause => feedback.notify(cause instanceof Error ? cause.message : String(cause), "error"));
  };
  useEffect(() => setFailed(false), [contributor.avatarUrl]);
  return <div className={size === "md" ? "skill-contributor skill-contributor-md" : "skill-contributor"}>
    <span className="skill-contributor-avatar" aria-hidden="true">
      {contributor.avatarUrl && !failed ? <img src={contributor.avatarUrl} alt="" onError={() => setFailed(true)} /> : <UserRound aria-hidden="true" />}
    </span>
    {contributor.nick ? profileUrl ? <a className="skill-contributor-nick" href={profileUrl} target="_blank" rel="noopener noreferrer" title={profileUrl} onClick={openProfile} onAuxClick={event => { if (event.button === 1) openProfile(event); }}>@{contributor.nick}</a>
      : <span className="skill-contributor-nick" title={`@${contributor.nick}`}>@{contributor.nick}</span> : null}
  </div>;
}
