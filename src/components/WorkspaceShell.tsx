import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clampPanelWidth, defaultSidebarWidth, sidebarWidthBounds } from "../panelWidths";
import { usePanelWidth } from "../usePanelWidth";
import { WidthResizeHandle } from "./WidthResizeHandle";

export function WorkspaceShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const main = useRef<HTMLElement>(null);
  const [containerWidth, setContainerWidth] = useState(() => typeof window === "undefined" ? 1440 : window.innerWidth);
  const layout = usePanelWidth("sidebar");
  const bounds = sidebarWidthBounds(containerWidth);
  const width = clampPanelWidth(layout.width ?? defaultSidebarWidth(containerWidth), bounds);
  useEffect(() => {
    const node = main.current;
    if (!node) return;
    const measure = () => setContainerWidth(node.clientWidth);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node); window.addEventListener("resize", measure); measure();
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return <main ref={main} className="workspace" style={{ "--sidebar-width": `${width}px` } as CSSProperties}>
    {sidebar}
    <WidthResizeHandle className="sidebar-width-resizer" label="프로젝트 설정 너비 조절" value={width} {...bounds}
      onChange={layout.change} onCommit={layout.commit} onCancel={layout.cancel} onReset={layout.reset}/>
    {children}
  </main>;
}
