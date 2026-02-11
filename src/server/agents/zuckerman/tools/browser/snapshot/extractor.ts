/**
 * Browser snapshot extraction logic
 * Extracts meaningful content and generates refs for elements
 */

export interface SnapshotOptions {
  selector: string | null;
  frame?: string | null;
  interactiveOnly: boolean;
  compact: boolean;
  maxChars: number;
  depth?: number;
}

export interface SnapshotElement {
  ref: number;
  ariaRef?: string;
  role: string;
  tag: string;
  text?: string;
  label?: string;
  type?: string;
  value?: string;
  href?: string;
  checked?: boolean;
  selected?: boolean;
  placeholder?: string;
  visible: boolean;
}

export interface SnapshotResult {
  snapshot: string;
  elements: SnapshotElement[];
  refs: Record<string, { role: string; name?: string; nth?: number }>;
  stats: {
    total: number;
    interactive: number;
  };
}

export interface SnapshotError {
  error: string;
}

/**
 * JavaScript code that runs in browser context to extract meaningful content
 */
export const extractSnapshotCode = `
(options) => {
  const { selector, frame, interactiveOnly, compact, maxChars, depth } = options;
  
  // Get root element (scoped or full page)
  let root = selector ? document.querySelector(selector) : document.body;
  
  // Handle frame selector
  if (frame && !selector) {
    const frameEl = document.querySelector(frame);
    if (frameEl && frameEl.contentDocument) {
      root = frameEl.contentDocument.body;
    } else {
      return { error: \`Frame "\${frame}" not found or not accessible\` };
    }
  }
  
  if (!root) {
    return { error: \`Selector "\${selector}" not found\` };
  }

  const elements = [];
  const refs = {};
  let refCounter = 0;
  let interactiveCount = 0;
  let currentDepth = 0;
  const maxDepth = depth || 100;

  // Helper to check if element is visible
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // Helper to get meaningful text content
  const getTextContent = (el, maxLength) => {
    let text = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || "";
      }
    }
    text = text.trim();
    
    if (!text) {
      text = el.getAttribute("aria-label") || el.getAttribute("title") || "";
    }
    
    const tag = el.tagName.toLowerCase();
    if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "label"].includes(tag)) {
      text = el.textContent?.trim() || text;
    }
    
    if (!text) return undefined;
    return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
  };

  // Helper to check if element is interactive
  const isInteractive = (el) => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    
    if (["button", "input", "select", "textarea", "a"].includes(tag)) {
      return true;
    }
    
    if (role && ["button", "link", "checkbox", "radio", "textbox", "combobox", "menuitem", "tab"].includes(role)) {
      return true;
    }
    
    if (el.hasAttribute("onclick") || el.hasAttribute("tabindex")) {
      return true;
    }
    
    return false;
  };

  // Recursive walk function with depth control
  const walkElement = (el, depth) => {
    if (depth > maxDepth) return;
    
    // Skip script, style, meta, etc.
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "meta", "link", "noscript"].includes(tag)) {
      return;
    }
    
    if (!isVisible(el)) {
      return;
    }
    
    const role = el.getAttribute("role") || tag;
    const text = getTextContent(el, maxChars);
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || undefined;
    const isElInteractive = isInteractive(el);
    
    // Skip if interactive only and not interactive
    if (interactiveOnly && !isElInteractive && !text && !label) {
      // Continue walking children
      for (const child of Array.from(el.children)) {
        walkElement(child, depth + 1);
      }
      return;
    }
    
    // Only include elements with meaningful content or interactive elements
    if (!text && !label && !isElInteractive) {
      // Continue walking children
      for (const child of Array.from(el.children)) {
        walkElement(child, depth + 1);
      }
      return;
    }
    
    // Skip empty divs/spans unless they're interactive
    if ((tag === "div" || tag === "span") && !text && !label && !isElInteractive) {
      for (const child of Array.from(el.children)) {
        walkElement(child, depth + 1);
      }
      return;
    }

    if (isElInteractive) {
      interactiveCount++;
    }

    const ref = refCounter++;
    const ariaRef = \`aria-ref:\${ref}\`;
    const refKey = \`e\${ref}\`;
    
    // Set aria-ref attribute for later reference
    el.setAttribute("aria-ref", ariaRef);
    
    const element = {
      ref,
      ariaRef,
      role,
      tag,
      visible: true,
    };

    if (text) element.text = text;
    if (label) element.label = label;

    // Add interactive element properties
    if (tag === "a") {
      element.href = el.href || undefined;
    }
    if (tag === "input") {
      element.type = el.type;
      element.value = el.value || undefined;
      element.placeholder = el.placeholder || undefined;
      if (el.type === "checkbox" || el.type === "radio") {
        element.checked = el.checked;
      }
    }
    if (tag === "select") {
      element.selected = el.selectedIndex !== -1;
      if (el.selectedIndex >= 0) {
        element.value = el.options[el.selectedIndex].text;
      }
    }
    if (tag === "textarea") {
      element.value = el.value || undefined;
      element.placeholder = el.placeholder || undefined;
    }

    elements.push(element);
    
    // Build refs map
    const name = label || text || tag;
    refs[refKey] = {
      role,
      name: name?.substring(0, 100),
    };

    // Continue walking children
    for (const child of Array.from(el.children)) {
      walkElement(child, depth + 1);
    }
  };

  // Start walking from root
  walkElement(root, 0);

  // Build compact text representation
  const lines = [];
  for (const el of elements) {
    let line = compact 
      ? \`[\${el.ref}]\`
      : \`[\${el.ref}] <\${el.tag}>\`;
      
    if (!compact && el.role !== el.tag) {
      line += \` role="\${el.role}"\`;
    }
    if (el.label) {
      line += \` label="\${el.label}"\`;
    }
    if (el.text) {
      line += \` "\${el.text}"\`;
    }
    if (el.href) {
      line += \` href="\${el.href}"\`;
    }
    if (el.type) {
      line += \` type="\${el.type}"\`;
    }
    if (el.value !== undefined) {
      line += \` value="\${String(el.value).substring(0, 50)}"\`;
    }
    if (el.checked !== undefined) {
      line += \` checked=\${el.checked}\`;
    }
    if (el.selected !== undefined) {
      line += \` selected=\${el.selected}\`;
    }
    lines.push(line);
  }

  return {
    snapshot: lines.join("\\n"),
    elements,
    refs,
    stats: {
      total: elements.length,
      interactive: interactiveCount,
    },
  };
}
`;
