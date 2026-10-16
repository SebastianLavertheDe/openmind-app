import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { Input } from "../../design-system/components";
import { createPortal } from "react-dom";
import {
  Archive,
  AudioLines,
  BatteryCharging,
  Bell,
  Bike,
  Binoculars,
  BookOpen,
  Bot,
  Bookmark,
  BriefcaseBusiness,
  CakeSlice,
  Calculator,
  CalendarDays,
  Camera,
  Car,
  ChartNoAxesCombined,
  ChevronRight,
  CircleDollarSign,
  Clapperboard,
  Clock3,
  Code2,
  Coffee,
  Compass,
  Database,
  Dumbbell,
  Feather,
  Film,
  Flag,
  Folder,
  Gamepad2,
  Gem,
  Gift,
  Glasses,
  GlassWater,
  GraduationCap,
  Hammer,
  Handbag,
  Image,
  KeyRound,
  Landmark,
  Laptop,
  Layers,
  Link,
  ListMusic,
  LockKeyhole,
  Mail,
  Map as MapIcon,
  MapPin,
  MapPinned,
  MessageCircle,
  MessageSquareText,
  Monitor,
  Music2,
  PackageOpen,
  Palette,
  PersonStanding,
  Plane,
  Satellite,
  Server,
  Ship,
  SquareTerminal,
  Store,
  TrafficCone,
  UsersRound,
  Utensils,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useAnchoredPopover } from "../../design-system/use-anchored-popover";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { useMotionTokens } from "../../design-system/motion-tokens";
import { useModalFocusScope } from "../../design-system/use-modal-focus-scope";
import { ProjectDialog } from "./ProjectDialog";
import type { ProjectColor, ProjectSummary } from "./types";

type ProjectIconOption = { id: string; label: string; icon: LucideIcon };

export const PROJECT_COLOR_OPTIONS: Array<{ id: ProjectColor; label: string; value: string }> = [
  { id: "neutral", get label() { return messages.projectUi.black; }, value: "#202124" },
  { id: "gray", get label() { return messages.projectUi.gray; }, value: "#97999f" },
  { id: "blue", get label() { return messages.projectUi.blue; }, value: "#0d7df2" },
  { id: "cyan", get label() { return messages.projectUi.cyan; }, value: "#5accc7" },
  { id: "green", get label() { return messages.projectUi.green; }, value: "#20c844" },
  { id: "indigo", get label() { return messages.projectUi.indigo; }, value: "#5858cf" },
  { id: "purple", get label() { return messages.projectUi.purple; }, value: "#9b51df" },
  { id: "pink", get label() { return messages.projectUi.pink; }, value: "#e72898" },
  { id: "red", get label() { return messages.projectUi.red; }, value: "#ef4a3e" },
  { id: "orange", get label() { return messages.projectUi.orange; }, value: "#ff8a00" },
  { id: "yellow", get label() { return messages.projectUi.yellow; }, value: "#ffc400" },
  { id: "brown", get label() { return messages.projectUi.brown; }, value: "#8d5815" }
];

export const PROJECT_ICON_OPTIONS: ProjectIconOption[] = [
  { id: "package-open", get label() { return messages.projectUi.package; }, icon: PackageOpen },
  { id: "calculator", get label() { return messages.projectUi.calculator; }, icon: Calculator },
  { id: "image", get label() { return messages.projectUi.image; }, icon: Image },
  { id: "audio-lines", get label() { return messages.projectUi.audio; }, icon: AudioLines },
  { id: "clapperboard", get label() { return messages.projectUi.video; }, icon: Clapperboard },
  { id: "book-open", get label() { return messages.projectUi.books; }, icon: BookOpen },
  { id: "link", get label() { return messages.projectUi.link; }, icon: Link },
  { id: "layers", get label() { return messages.projectUi.layers; }, icon: Layers },
  { id: "traffic-cone", get label() { return messages.projectUi.signpost; }, icon: TrafficCone },
  { id: "server", get label() { return messages.projectUi.server; }, icon: Server },
  { id: "compass", get label() { return messages.projectUi.compass; }, icon: Compass },
  { id: "chart", get label() { return messages.projectUi.chart; }, icon: ChartNoAxesCombined },
  { id: "bot", get label() { return messages.projectUi.robot; }, icon: Bot },
  { id: "message-circle", get label() { return messages.projectUi.conversation; }, icon: MessageCircle },
  { id: "message-square", get label() { return messages.projectUi.message; }, icon: MessageSquareText },
  { id: "clock", get label() { return messages.projectUi.clock; }, icon: Clock3 },
  { id: "map-pin", get label() { return messages.projectUi.location; }, icon: MapPin },
  { id: "bell", get label() { return messages.projectUi.notification; }, icon: Bell },
  { id: "satellite", get label() { return messages.projectUi.satellite; }, icon: Satellite },
  { id: "key", get label() { return messages.projectUi.key; }, icon: KeyRound },
  { id: "lock", get label() { return messages.projectUi.lock; }, icon: LockKeyhole },
  { id: "laptop", get label() { return messages.projectUi.laptop; }, icon: Laptop },
  { id: "monitor", get label() { return messages.projectUi.monitor; }, icon: Monitor },
  { id: "battery", get label() { return messages.projectUi.battery; }, icon: BatteryCharging },
  { id: "hammer", get label() { return messages.projectUi.tools; }, icon: Hammer },
  { id: "flag", get label() { return messages.projectUi.flag; }, icon: Flag },
  { id: "bookmark", get label() { return messages.projectUi.bookmark; }, icon: Bookmark },
  { id: "database", get label() { return messages.projectUi.database; }, icon: Database },
  { id: "code", get label() { return messages.projectUi.code; }, icon: Code2 },
  { id: "terminal", get label() { return messages.projectUi.terminal; }, icon: SquareTerminal },
  { id: "calendar", get label() { return messages.projectUi.calendar; }, icon: CalendarDays },
  { id: "mail", get label() { return messages.projectUi.email; }, icon: Mail },
  { id: "folder", get label() { return messages.projectUi.folder; }, icon: Folder },
  { id: "archive", get label() { return messages.projectUi.archiveBox; }, icon: Archive },
  { id: "graduation-cap", get label() { return messages.projectUi.education; }, icon: GraduationCap },
  { id: "landmark", get label() { return messages.projectUi.institution; }, icon: Landmark },
  { id: "store", get label() { return messages.projectUi.shop; }, icon: Store },
  { id: "feather", get label() { return messages.projectUi.writing; }, icon: Feather },
  { id: "music-list", get label() { return messages.projectUi.playlist; }, icon: ListMusic },
  { id: "handbag", get label() { return messages.projectUi.handbag; }, icon: Handbag },
  { id: "map-pinned", get label() { return messages.projectUi.mapLocation; }, icon: MapPinned },
  { id: "plane", get label() { return messages.projectUi.airplane; }, icon: Plane },
  { id: "car", get label() { return messages.projectUi.car; }, icon: Car },
  { id: "ship", get label() { return messages.projectUi.boat; }, icon: Ship },
  { id: "dumbbell", get label() { return messages.projectUi.fitness; }, icon: Dumbbell },
  { id: "gift", get label() { return messages.projectUi.gift; }, icon: Gift },
  { id: "cake", get label() { return messages.projectUi.cake; }, icon: CakeSlice },
  { id: "binoculars", get label() { return messages.projectUi.binoculars; }, icon: Binoculars },
  { id: "money", get label() { return messages.projectUi.finance; }, icon: CircleDollarSign },
  { id: "gem", get label() { return messages.projectUi.gem; }, icon: Gem },
  { id: "users", get label() { return messages.projectUi.team; }, icon: UsersRound },
  { id: "person", get label() { return messages.projectUi.person; }, icon: PersonStanding },
  { id: "bike", get label() { return messages.projectUi.bicycle; }, icon: Bike },
  { id: "utensils", get label() { return messages.projectUi.dining; }, icon: Utensils },
  { id: "coffee", get label() { return messages.projectUi.coffee; }, icon: Coffee },
  { id: "glass", get label() { return messages.projectUi.drink; }, icon: GlassWater },
  { id: "gamepad", get label() { return messages.projectUi.gaming; }, icon: Gamepad2 },
  { id: "glasses", get label() { return messages.projectUi.glasses; }, icon: Glasses },
  { id: "camera", get label() { return messages.projectUi.camera; }, icon: Camera },
  { id: "film", get label() { return messages.projectUi.film; }, icon: Film },
  { id: "briefcase", get label() { return messages.projectUi.work; }, icon: BriefcaseBusiness },
  { id: "map", get label() { return messages.projectUi.map; }, icon: MapIcon },
  { id: "music", get label() { return messages.projectUi.music; }, icon: Music2 },
  { id: "palette", get label() { return messages.projectUi.design; }, icon: Palette }
];

const PROJECT_ICONS = new Map(PROJECT_ICON_OPTIONS.map((option) => [option.id, option.icon]));

export function projectColorValue(color?: ProjectColor): string {
  return PROJECT_COLOR_OPTIONS.find((option) => option.id === color)?.value || PROJECT_COLOR_OPTIONS[0].value;
}

export function ProjectIcon({ name, size = 18, className }: { name?: string; size?: number; className?: string }) {
  useLocale();
  const Icon = PROJECT_ICONS.get(name || "") || Database;
  return <Icon className={className} size={size} strokeWidth={2.25} aria-hidden="true" />;
}

export function ProjectEditDialog({
  project,
  busy,
  onClose,
  onSave
}: {
  project: ProjectSummary | null;
  busy: boolean;
  onClose(): void;
  onSave(input: { name: string; icon: string; color: ProjectColor }): void | Promise<void>;
}) {
  const locale = useLocale();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("database");
  const [color, setColor] = useState<ProjectColor>("neutral");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const iconTriggerRef = useRef<HTMLButtonElement>(null);
  const iconPickerRef = useRef<HTMLDivElement>(null);
  const tokens = useMotionTokens();
  const pickerOpen = Boolean(project) && iconPickerOpen;
  const pickerPresence = useExitPresence(pickerOpen, tokens.exitMs);
  const closePicker = useCallback(() => setIconPickerOpen(false), []);
  useModalFocusScope({ open: pickerOpen, containerRef: iconPickerRef, triggerRef: iconTriggerRef, onDismiss: closePicker, layer: "global" });
  const popover = useAnchoredPopover({
    open: pickerPresence.visible,
    anchorRef: iconTriggerRef,
    floatingRef: iconPickerRef,
    preferredSide: "bottom",
    align: "end",
    gap: 8,
    viewportPadding: 16
  });

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setIcon(project.icon || "database");
    setColor(project.color || "neutral");
    setIconPickerOpen(false);
    const frame = requestAnimationFrame(() => nameInputRef.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [project]);

  useEffect(() => {
    if (!iconPickerOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (iconTriggerRef.current?.contains(target) || iconPickerRef.current?.contains(target)) return;
      setIconPickerOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [iconPickerOpen]);

  const colorValue = projectColorValue(color);
  return (
    <>
      <ProjectDialog
        open={Boolean(project)}
        title={messages.projectUi.editProject}
        confirmLabel={messages.projectUi.update}
        cancelLabel={null}
        busy={busy}
        className="project-dialog-compact"
        backdropClassName="project-dialog-backdrop-clear"
        onClose={onClose}
        onConfirm={() => onSave({ name: name.trim(), icon, color })}
      >
        <Input variant="inline"
          ref={nameInputRef}
          className="project-edit-name"
          aria-label={messages.projectUi.projectName}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <section className="project-appearance-card" aria-label={messages.projectUi.projectAppearance}>
          <button
            ref={iconTriggerRef}
            type="button"
            className="project-icon-picker-trigger"
            data-motion="selection"
            aria-haspopup="dialog"
            aria-expanded={iconPickerOpen}
            onClick={() => setIconPickerOpen((current) => !current)}
          >
            <span>{messages.projectUi.icon}</span>
            <span className="project-icon-picker-current" style={{ color: colorValue } as CSSProperties}>
              <ProjectIcon name={icon} size={16} />
              <ChevronRight size={14} aria-hidden="true" />
            </span>
          </button>
          <div className="project-color-grid" role="group" aria-label={messages.projectUi.projectColor}>
            {PROJECT_COLOR_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={color === option.id ? "selected" : ""}
                data-motion="selection"
                aria-label={option.label}
                aria-pressed={color === option.id}
                title={option.label}
                onClick={() => setColor(option.id)}
              >
                <span style={{ background: option.value }} />
              </button>
            ))}
          </div>
        </section>
      </ProjectDialog>
      {pickerPresence.visible && typeof document !== "undefined" ? createPortal(
        <div
          ref={iconPickerRef}
          className="project-icon-picker"
          role="dialog"
          aria-modal={pickerOpen || undefined}
          aria-hidden={!pickerOpen || undefined}
          inert={!pickerOpen}
          data-leaving={pickerPresence.leaving || undefined}
          aria-label={messages.projectUi.chooseProjectIcon}
          data-side={popover.side}
          style={popover.style}
        >
          {PROJECT_ICON_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                className={icon === option.id ? "selected" : ""}
                data-motion="selection"
                aria-label={option.label}
                aria-pressed={icon === option.id}
                title={option.label}
                onClick={() => {
                  setIcon(option.id);
                  setIconPickerOpen(false);
                }}
              >
                  <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
              </button>
            );
          })}
        </div>,
        document.body
      ) : null}
    </>
  );
}
