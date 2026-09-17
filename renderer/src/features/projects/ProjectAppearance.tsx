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
  { id: "neutral", label: "黑色", value: "#202124" },
  { id: "gray", label: "灰色", value: "#97999f" },
  { id: "blue", label: "蓝色", value: "#0d7df2" },
  { id: "cyan", label: "青色", value: "#5accc7" },
  { id: "green", label: "绿色", value: "#20c844" },
  { id: "indigo", label: "靛蓝", value: "#5858cf" },
  { id: "purple", label: "紫色", value: "#9b51df" },
  { id: "pink", label: "粉色", value: "#e72898" },
  { id: "red", label: "红色", value: "#ef4a3e" },
  { id: "orange", label: "橙色", value: "#ff8a00" },
  { id: "yellow", label: "黄色", value: "#ffc400" },
  { id: "brown", label: "棕色", value: "#8d5815" }
];

export const PROJECT_ICON_OPTIONS: ProjectIconOption[] = [
  { id: "package-open", label: "包裹", icon: PackageOpen },
  { id: "calculator", label: "计算器", icon: Calculator },
  { id: "image", label: "图片", icon: Image },
  { id: "audio-lines", label: "音频", icon: AudioLines },
  { id: "clapperboard", label: "视频", icon: Clapperboard },
  { id: "book-open", label: "书籍", icon: BookOpen },
  { id: "link", label: "链接", icon: Link },
  { id: "layers", label: "图层", icon: Layers },
  { id: "traffic-cone", label: "路标", icon: TrafficCone },
  { id: "server", label: "服务器", icon: Server },
  { id: "compass", label: "指南针", icon: Compass },
  { id: "chart", label: "图表", icon: ChartNoAxesCombined },
  { id: "bot", label: "机器人", icon: Bot },
  { id: "message-circle", label: "对话", icon: MessageCircle },
  { id: "message-square", label: "消息", icon: MessageSquareText },
  { id: "clock", label: "时钟", icon: Clock3 },
  { id: "map-pin", label: "地点", icon: MapPin },
  { id: "bell", label: "提醒", icon: Bell },
  { id: "satellite", label: "卫星", icon: Satellite },
  { id: "key", label: "钥匙", icon: KeyRound },
  { id: "lock", label: "锁", icon: LockKeyhole },
  { id: "laptop", label: "笔记本电脑", icon: Laptop },
  { id: "monitor", label: "显示器", icon: Monitor },
  { id: "battery", label: "电池", icon: BatteryCharging },
  { id: "hammer", label: "工具", icon: Hammer },
  { id: "flag", label: "旗帜", icon: Flag },
  { id: "bookmark", label: "书签", icon: Bookmark },
  { id: "database", label: "数据库", icon: Database },
  { id: "code", label: "代码", icon: Code2 },
  { id: "terminal", label: "终端", icon: SquareTerminal },
  { id: "calendar", label: "日历", icon: CalendarDays },
  { id: "mail", label: "邮件", icon: Mail },
  { id: "folder", label: "文件夹", icon: Folder },
  { id: "archive", label: "归档盒", icon: Archive },
  { id: "graduation-cap", label: "教育", icon: GraduationCap },
  { id: "landmark", label: "机构", icon: Landmark },
  { id: "store", label: "商店", icon: Store },
  { id: "feather", label: "写作", icon: Feather },
  { id: "music-list", label: "音乐列表", icon: ListMusic },
  { id: "handbag", label: "手提包", icon: Handbag },
  { id: "map-pinned", label: "地图定位", icon: MapPinned },
  { id: "plane", label: "飞机", icon: Plane },
  { id: "car", label: "汽车", icon: Car },
  { id: "ship", label: "船", icon: Ship },
  { id: "dumbbell", label: "健身", icon: Dumbbell },
  { id: "gift", label: "礼物", icon: Gift },
  { id: "cake", label: "蛋糕", icon: CakeSlice },
  { id: "binoculars", label: "望远镜", icon: Binoculars },
  { id: "money", label: "财务", icon: CircleDollarSign },
  { id: "gem", label: "宝石", icon: Gem },
  { id: "users", label: "团队", icon: UsersRound },
  { id: "person", label: "人物", icon: PersonStanding },
  { id: "bike", label: "自行车", icon: Bike },
  { id: "utensils", label: "餐饮", icon: Utensils },
  { id: "coffee", label: "咖啡", icon: Coffee },
  { id: "glass", label: "饮品", icon: GlassWater },
  { id: "gamepad", label: "游戏", icon: Gamepad2 },
  { id: "glasses", label: "眼镜", icon: Glasses },
  { id: "camera", label: "相机", icon: Camera },
  { id: "film", label: "电影", icon: Film },
  { id: "briefcase", label: "工作", icon: BriefcaseBusiness },
  { id: "map", label: "地图", icon: MapIcon },
  { id: "music", label: "音乐", icon: Music2 },
  { id: "palette", label: "设计", icon: Palette }
];

const PROJECT_ICONS = new Map(PROJECT_ICON_OPTIONS.map((option) => [option.id, option.icon]));

export function projectColorValue(color?: ProjectColor): string {
  return PROJECT_COLOR_OPTIONS.find((option) => option.id === color)?.value || PROJECT_COLOR_OPTIONS[0].value;
}

export function ProjectIcon({ name, size = 18, className }: { name?: string; size?: number; className?: string }) {
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
        title="编辑项目"
        confirmLabel="更新"
        cancelLabel={null}
        busy={busy}
        className="project-dialog-compact"
        backdropClassName="project-dialog-backdrop-clear"
        onClose={onClose}
        onConfirm={() => onSave({ name: name.trim(), icon, color })}
      >
        <input
          ref={nameInputRef}
          className="project-edit-name"
          aria-label="项目名称"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <section className="project-appearance-card" aria-label="项目外观">
          <button
            ref={iconTriggerRef}
            type="button"
            className="project-icon-picker-trigger"
            data-motion="selection"
            aria-haspopup="dialog"
            aria-expanded={iconPickerOpen}
            onClick={() => setIconPickerOpen((current) => !current)}
          >
            <span>图标</span>
            <span className="project-icon-picker-current" style={{ color: colorValue } as CSSProperties}>
              <ProjectIcon name={icon} size={16} />
              <ChevronRight size={14} aria-hidden="true" />
            </span>
          </button>
          <div className="project-color-grid" role="group" aria-label="项目颜色">
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
          aria-label="选择项目图标"
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
