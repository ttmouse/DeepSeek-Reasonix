import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkMathPolicy } from "./remarkMathPolicy";
import { remarkLocalPathLinks } from "../lib/localPathLinks";
import { remarkChatPathLinks, type ChatPathLinkifyContext } from "../lib/chatPathLinkify";

// One shared parser policy keeps live Markdown and session exports identical.
// `ctx` (workspace roots) enables chat path linkification; undefined disables
// it (surfaces without a workspace context render plain text, unchanged).
export function createReasonixRemarkPlugins(ctx?: ChatPathLinkifyContext) {
  const plugins = [remarkGfm, remarkMath, remarkMathPolicy, remarkLocalPathLinks];
  if (ctx) {
    // `remarkChatPathLinks` is a parameterized factory; wrap it so unified
    // receives a plugin (invoked for its transformer), like remarkLocalPathLinks.
    plugins.push(() => remarkChatPathLinks(ctx));
  }
  return plugins;
}

/** Backward-compatible default: no chat-path context (no linkification). */
export const reasonixRemarkPlugins = createReasonixRemarkPlugins();
export { reasonixRehypePlugins } from "./rehypeReasonixKatex";
