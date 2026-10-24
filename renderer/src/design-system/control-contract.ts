/** Public UI variants. Fixtures and static checks consume this same contract. */
export const CONTROL_SIZES = ["sm", "md", "lg"] as const;
export type ControlSize = typeof CONTROL_SIZES[number];
export const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "text"] as const;
export type ButtonVariant = typeof BUTTON_VARIANTS[number];
export const BUTTON_GEOMETRY = { primary: "fixed", secondary: "fixed", ghost: "fixed", text: "content" } as const satisfies Record<ButtonVariant, "fixed" | "content">;
export const ICON_BUTTON_SHAPES = ["rect", "circle"] as const;
export type IconButtonShape = typeof ICON_BUTTON_SHAPES[number];
export const IMAGE_THUMBNAIL_VARIANTS = ["default", "attachment", "tool"] as const;
export type ImageThumbnailVariant = typeof IMAGE_THUMBNAIL_VARIANTS[number];
export const DISCLOSURE_VARIANTS = ["default", "inline"] as const;
export type DisclosureVariant = typeof DISCLOSURE_VARIANTS[number];
export const CONTROL_TONES = ["neutral", "danger", "warning"] as const;
export type ControlTone = typeof CONTROL_TONES[number];
export const DIALOG_SIZES = ["sm", "md", "lg", "wide"] as const;
export type DialogSize = typeof DIALOG_SIZES[number];
export const INPUT_VARIANTS = ["default", "inline"] as const;
export type InputVariant = typeof INPUT_VARIANTS[number];
export const TEXTAREA_VARIANTS = ["default", "inline", "composer", "code"] as const;
export type TextareaVariant = typeof TEXTAREA_VARIANTS[number];
export const SEARCH_VARIANTS = ["quiet", "outlined"] as const;
export type SearchVariant = typeof SEARCH_VARIANTS[number];
export const SELECT_SHAPES = ["pill", "rect"] as const;
export type SelectShape = typeof SELECT_SHAPES[number];
export const SELECT_VARIANTS = ["default", "quiet"] as const;
export type SelectVariant = typeof SELECT_VARIANTS[number];
export const SELECT_ITEM_VARIANTS = ["option", "group", "detail"] as const;
export type SelectItemVariant = typeof SELECT_ITEM_VARIANTS[number];
export type SelectTone = "neutral" | "warning";
export type SelectSelection<T extends string> =
  | { multiple: true; value: T[]; onChange(value: T[]): void }
  | { multiple?: false; value: T | ""; onChange(value: T): void };

export const TAB_VARIANTS = ["default", "pill", "underline", "bordered", "editor"] as const;
export type TabVariant = typeof TAB_VARIANTS[number];
export const SEGMENTED_VARIANTS = ["default", "compact"] as const;
export type SegmentedVariant = typeof SEGMENTED_VARIANTS[number];
