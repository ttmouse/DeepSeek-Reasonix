import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";
import type { CSSProperties } from "react";

const iconResolver = createFileTreeIconResolver("complete");
const iconSpriteSheet = getBuiltInSpriteSheet("complete");

const palette = {
  blue: "light-dark(#1a85d4, #69b1ff)",
  cyan: "light-dark(#1ca1c7, #68cdf2)",
  gray: "light-dark(#84848a, #adadb1)",
  green: "light-dark(#199f43, #5ecc71)",
  indigo: "light-dark(#693acf, #9d6afb)",
  mauve: "light-dark(#594c5b, #79697b)",
  orange: "light-dark(#d47628, #ffa359)",
  pink: "light-dark(#d32a61, #ff678d)",
  purple: "light-dark(#a631be, #d568ea)",
  red: "light-dark(#d52c36, #ff6762)",
  teal: "light-dark(#17a5af, #64d1db)",
  vermilion: "light-dark(#ff8c5b, #d5512f)",
  yellow: "light-dark(#d5a910, #ffd452)",
} as const;

const colorByToken: Record<string, string> = {
  astro: palette.purple,
  babel: palette.yellow,
  bash: palette.green,
  biome: palette.blue,
  bootstrap: palette.indigo,
  browserslist: palette.yellow,
  bun: palette.mauve,
  c: palette.blue,
  claude: palette.orange,
  cpp: palette.blue,
  css: palette.indigo,
  database: palette.purple,
  default: palette.gray,
  docker: palette.blue,
  eslint: palette.indigo,
  git: palette.vermilion,
  go: palette.cyan,
  graphql: palette.pink,
  html: palette.orange,
  image: palette.pink,
  javascript: palette.yellow,
  json: palette.orange,
  markdown: palette.green,
  mcp: palette.teal,
  nextjs: palette.gray,
  npm: palette.red,
  oxc: palette.cyan,
  postcss: palette.red,
  prettier: palette.teal,
  python: palette.blue,
  react: palette.cyan,
  ruby: palette.red,
  rust: palette.orange,
  sass: palette.pink,
  stylelint: palette.indigo,
  svelte: palette.red,
  svg: palette.orange,
  svgo: palette.green,
  swift: palette.orange,
  table: palette.teal,
  tailwind: palette.cyan,
  terraform: palette.indigo,
  text: palette.gray,
  typescript: palette.blue,
  vite: palette.purple,
  vscode: palette.blue,
  vue: palette.green,
  wasm: palette.indigo,
  webpack: palette.blue,
  yml: palette.red,
  zig: palette.orange,
  zip: palette.orange,
};

export function workspaceFileIcon(fileName: string) {
  const resolved = iconResolver.resolveIcon("file-tree-icon-file", fileName);
  const token = resolved.token ?? "default";
  return {
    color: colorByToken[token] ?? palette.gray,
    name: resolved.name,
    token,
    viewBox: resolved.viewBox ?? "0 0 16 16",
  };
}

export function WorkspaceFileIconSprite() {
  return (
    <span
      aria-hidden="true"
      className="workspace-file-icon-sprite"
      dangerouslySetInnerHTML={{ __html: iconSpriteSheet }}
    />
  );
}

export function WorkspaceFileIcon({ fileName, className = "" }: { fileName: string; className?: string }) {
  const icon = workspaceFileIcon(fileName);
  const style = {
    "--workspace-file-icon-color": icon.color,
  } as CSSProperties;
  return (
    <svg
      aria-hidden="true"
      className={`workspace-file-icon${className ? ` ${className}` : ""}`}
      data-icon-name={icon.name}
      data-icon-token={icon.token}
      style={style}
      viewBox={icon.viewBox}
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}
