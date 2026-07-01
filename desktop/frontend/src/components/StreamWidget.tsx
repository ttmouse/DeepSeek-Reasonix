import { memo, useEffect, useMemo, useRef } from "react";

const CSS_VAR_MAP: Record<string, string> = {
  "--bg": "--background",
  "--fg": "--foreground",
  "--bg-dim": "--muted",
  "--fg-dim": "--muted-foreground",
  "--accent": "--primary",
  "--accent-fg": "--primary-foreground",
  "--border": "--border",
  "--bg-elev": "--card",
  "--bg-elev-2": "--secondary",
  "--fg-faint": "--secondary-foreground",
  "--radius": "--radius",
  "--font-ui": "--font-sans",
  "--font-mono": "--font-mono",
};

function pushTheme(doc: Document) {
  const cs = getComputedStyle(document.documentElement);
  const root = doc.documentElement;
  for (const [host, widget] of Object.entries(CSS_VAR_MAP)) {
    const val = cs.getPropertyValue(host).trim();
    if (val) root.style.setProperty(widget, val);
  }
}

function buildShell(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{overflow:hidden}
body{font-family:var(--font-sans);color:var(--foreground);background:transparent;line-height:1.5;padding:0}
</style>
</head>
<body>
<script>
(function(){
  var h=-1,t=null;
  function r(){var s=document.body.scrollHeight;if(s===h)return;h=s;parent.postMessage({type:"ws",height:s},"*");}
  function q(){if(!t)t=requestAnimationFrame(function(){t=null;r();});}
  if(window.ResizeObserver)new ResizeObserver(q).observe(document.body);
  window.addEventListener("load",q);
  window.sendPrompt=function(t){parent.postMessage({type:"wp",text:String(t)},"*");};
})();
</script>`;
}

export const StreamWidget = memo(function StreamWidget({ value }: { value: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const writtenRef = useRef(0);
  const closedRef = useRef(false);
  const shell = useMemo(() => buildShell(), []);

  // Write new content to the open document stream. Runs on every render.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    // First call: open stream, write shell, push theme, write initial content
    if (writtenRef.current === 0 && value) {
      doc.open();
      doc.write(shell);
      pushTheme(doc);
    }

    // Push theme on every render (catches host theme switches)
    if (writtenRef.current > 0 || value) {
      pushTheme(doc);
    }

    // Write only new content
    if (value) {
      const newText = value.slice(writtenRef.current);
      if (newText) {
        doc.write(newText);
        writtenRef.current = value.length;
      }
    }
  });

  // Close detection: 200ms after content stops growing, finalise
  useEffect(() => {
    if (closedRef.current) return;
    const doc = iframeRef.current?.contentDocument;
    const timer = setTimeout(() => {
      if (!closedRef.current && doc && writtenRef.current > 0) {
        doc.write("</body></html>");
        doc.close();
        closedRef.current = true;
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [value]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!closedRef.current) {
        const doc = iframeRef.current?.contentDocument;
        if (doc) { try { doc.write("</body></html>"); doc.close(); } catch {} }
        closedRef.current = true;
      }
    };
  }, []);

  // Resize + prompt messages
  useEffect(() => {
    let timer = 0;
    let current = 0;
    function onMsg(e: MessageEvent) {
      const iframe = iframeRef.current;
      if (!iframe || e.source !== iframe.contentWindow) return;
      if (e.data?.type === "ws" && typeof e.data.height === "number") {
        const h = Math.min(Math.max(e.data.height, 50), 2000);
        if (h === current) return;
        current = h;
        clearTimeout(timer);
        timer = window.setTimeout(() => { iframe.style.height = h + "px"; }, 30);
      }
      if (e.data?.type === "wp" && typeof e.data.text === "string") {
        window.dispatchEvent(new CustomEvent("widget-send-prompt", { detail: { text: e.data.text } }));
      }
    }
    window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(timer); };
  }, []);

  function handleDownload() {
    try {
      const cs = getComputedStyle(document.documentElement);
      const fallbacks: Record<string, string> = {
        "--bg": "#ffffff", "--fg": "#1a1a2e", "--border": "#d3d1c7",
        "--accent": "#7F77DD", "--bg-elev": "#ffffff", "--radius": "6px",
      };
      const vars = Object.entries(CSS_VAR_MAP).map(([h, w]) => {
        const val = cs.getPropertyValue(h).trim();
        return `  ${w}: ${val || fallbacks[h] || "inherit"};`;
      }).join("\n");
      const full = `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<style>:root{${vars}}*{box-sizing:border-box;margin:0;padding:0}\nbody{font-family:var(--font-sans);color:var(--foreground);background:var(--background);line-height:1.5;padding:24px;max-width:720px;margin:0 auto}\n</style></head>\n<body>${value}</body></html>`;
      const blob = new Blob([full], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "widget.html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("widget download failed", e);
    }
  }

  return (
    <div className="widget-stream">
      {value && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
          <button
            onClick={handleDownload}
            title="Download as standalone HTML file"
            style={{
              fontSize: 10, padding: "1px 8px", borderRadius: 4,
              border: "0.5px solid var(--border)", background: "var(--card)",
              color: "var(--fg-dim)", cursor: "pointer", fontFamily: "var(--font-ui)",
            }}
          >↓ download</button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts allow-same-origin"
        title="widget"
        style={{ width: "100%", height: "100px", border: "none", display: "block", overflow: "hidden" }}
      />
    </div>
  );
});
