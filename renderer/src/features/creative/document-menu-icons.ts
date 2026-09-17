// Static outline SVGs are shared by React menus and Crepe's icon-HTML adapter.
// All geometry uses a 24px viewBox, currentColor and the same stroke weight.
const paths: Record<string, string> = {
  text: '<path d="M4 4h16M12 4v16M8 20h8"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  strike: '<path d="M16 4H9a4 4 0 0 0-4 4c0 2 1 3 3 4M4 12h16M16 12a4 4 0 0 1-1 8H6"/>',
  inlineCode: '<path d="m16 6 6 6-6 6M8 6l-6 6 6 6"/>',
  code: '<path d="m18 6 4 6-4 6M6 6l-4 6 4 6m8.5-14-5 16"/>',
  "bullet-list": '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  "ordered-list": '<path d="M10 6h11M10 12h11M10 18h11M4 4h1v5M4 9h2M3 15a2 2 0 0 1 4 0c0 2-4 2-4 5h4"/>',
  "task-list": '<path d="m3 6 2 2 4-4M13 6h8m-18 6 2 2 4-4M13 12h8M13 18h8"/><rect x="3" y="17" width="6" height="4" rx="1"/>',
  quote: '<path d="M3 21c3 0 7-4 7-10V3H2v8h5c0 4-1 6-4 7M15 21c3 0 7-4 7-10V3h-8v8h5c0 4-1 6-4 7"/>',
  divider: '<path d="M4 12h16"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
  math: '<path d="M18 4H6l6 8-6 8h12"/>',
  undo: '<path d="M3 7v6h6M3 13a8 8 0 1 1 2 6"/>',
  redo: '<path d="M21 7v6h-6M21 13a8 8 0 1 0-2 6"/>',
  file: '<path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2M3 7h18l-2 13H5L3 7Z"/>'
};
const aliases: Record<string, string> = { bullet: "bullet-list", ordered: "ordered-list", todo: "task-list" };
export const documentMenuHints: Record<string, string> = {
  h1: "#", h2: "##", h3: "###", h4: "####", h5: "#####", h6: "######",
  bullet: "-", "bullet-list": "-", ordered: "1.", "ordered-list": "1.", todo: "[]", "task-list": "[]",
  quote: ">", divider: "---", code: "```", inlineCode: "`", italic: "_", strike: "~~", link: "[]()"
};
export function documentMenuIconHtml(key: string): string {
  if (/^h[1-6]$/.test(key)) return `<span class="document-menu-heading">H<sub>${key.slice(1)}</sub></span>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[aliases[key] ?? key] ?? ""}</svg>`;
}
